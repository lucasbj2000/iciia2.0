/** Pasarela telefónica: token, órdenes, llamadas entrantes y salientes, negociación con sello de teléfono
 * y avisos solo al probador. PostgreSQL real con base temporal; pasarela simulada. Nunca usa producción. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (!process.env.TEST_DATABASE_URL) throw new Error('Requiere TEST_DATABASE_URL de pruebas. Nunca usar producción.');
const nombreBase = 'impar_pas_' + randomUUID().replaceAll('-', '').slice(0, 16);
const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await control.connect();
await control.query('CREATE DATABASE ' + nombreBase);
const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = '/' + nombreBase;
process.env.DATABASE_URL = url.toString();
process.env.ADMIN_PASS ||= 'Prueba.Impar.2026';

const db = await import('../src/db.mjs');
let fallo = null;
try {
  await db.migrar();
  await db.seed();
  const { q } = db;
  const P = await import('../src/pasarela-tel-impar.mjs');
  const { sseHandler } = await import('../src/realtime.mjs');
  const E = (await q("SELECT id FROM empresas WHERE codigo='impar'")).rows[0].id;
  const usuario = async (u, rol) => (await q("INSERT INTO usuarios (empresa_id,nombre,usuario,pass_hash,rol) VALUES ($1,$2,$2,'x',$3) RETURNING *", [E, u, rol])).rows[0];
  const yo = await usuario('lucas_pas', 'admin');
  const otro = await usuario('vendedor_pas', 'vendedor');

  /* Números paraguayos */
  assert.equal(P.normalizarNumero('0981 123 456'), '595981123456');
  assert.equal(P.normalizarNumero('+595981123456'), '595981123456');
  assert.equal(P.normalizarNumero('00595981123456'), '595981123456');
  assert.equal(P.normalizarNumero('withheld'), '');
  assert.equal(P.numeroParaMarcar('0981123456'), '+595981123456');
  assert.equal(P.numeroParaMarcar('*611'), '611');

  // Avisos que recibe cada usuario por SSE
  const recibido = { [yo.id]: [], [otro.id]: [] };
  for (const u of [yo, otro]) sseHandler({ empresaId: E, user: { id: u.id }, on() {} },
    { writeHead() {}, write(s) { if (s.startsWith('event: llamada')) recibido[u.id].push(JSON.parse(s.split('data: ')[1])); } });

  /* Sin pruebas activas no se puede usar */
  await assert.rejects(() => P.llamarTel(E, yo, { tel: '0981000555' }), e => e.status === 403);
  await q('INSERT INTO llamadas_wa_config_impar(empresa_id,activo,probadores) VALUES($1,true,$2)', [E, [yo.id]]);

  /* Token: se guarda solo como hash; uno inválido no entra */
  const token = await P.generarToken(E, { nombre: 'Sucursal Matriz', sucursal: 'Matriz' });
  assert.match(token, /^pst_[\w-]{40,60}$/);
  assert.equal((await q('SELECT count(*) n FROM pasarelas_tel_impar WHERE token_hash=$1', [token])).rows[0].n, 0, 'nunca en claro');
  assert.equal(await P.pasarelaPorToken('pst_' + 'x'.repeat(43)), null);
  const pas = await P.pasarelaPorToken(token);
  assert.ok(pas);
  await assert.rejects(() => P.llamarTel(E, yo, { tel: '0981000555' }), e => e.status === 409, 'sin pasarela conectada');

  /* La pasarela se conecta y recibe órdenes por SSE */
  const ordenes = []; let cierre = null;
  P.conectarPasarela(pas, { on: (ev, fn) => { if (ev === 'close') cierre = fn; } },
    { writeHead() {}, write(s) { if (s.startsWith('event: cmd')) ordenes.push(JSON.parse(s.split('data: ')[1])); }, end() {} });
  await P.eventoPasarela(pas, { tipo: 'equipo', celular: true, version: '0.1.0' });
  assert.equal(P.estadoConexion(pas).celular, true);
  assert.equal(recibido[yo.id].at(-1).tipo, 'pasarela');

  /* 1) Entrante de un número nuevo: crea cliente y negociación con sello de teléfono, a nombre del probador */
  const r1 = await P.eventoPasarela(pas, { tipo: 'entrante', numero: '0981 000 111' });
  assert.match(r1.call_id, /^tel\.[0-9a-f-]{36}$/);
  const ll1 = (await q('SELECT * FROM llamadas_wa_impar WHERE call_id=$1', [r1.call_id])).rows[0];
  assert.equal(ll1.medio, 'telefono'); assert.equal(ll1.estado, 'sonando'); assert.equal(ll1.telefono, '595981000111');
  const neg1 = (await q('SELECT * FROM negociaciones WHERE id=$1', [ll1.negociacion_id])).rows[0];
  assert.equal(neg1.origen, 'telefonia'); assert.equal(neg1.etapa, 'nuevo'); assert.equal(neg1.agente_id, yo.id);
  assert.equal((await q("SELECT txt FROM mensajes WHERE negociacion_id=$1 AND dir='in'", [neg1.id])).rows[0].txt, '📞 Llamada telefónica entrante');
  assert.equal(recibido[yo.id].at(-1).tipo, 'entrante');
  assert.equal(recibido[otro.id].length, 0, 'el resto del equipo no recibe nada');

  /* 2) Atender: orden a la pasarela, oferta solo a quien atendió, respuesta de vuelta a la pasarela */
  await assert.rejects(() => P.atenderTel(E, otro, r1.call_id), e => e.status === 403);
  await P.atenderTel(E, yo, r1.call_id);
  assert.deepEqual(ordenes.at(-1), { accion: 'atender', call_id: r1.call_id });
  await assert.rejects(() => P.atenderTel(E, yo, r1.call_id), e => e.status === 409, 'no se atiende dos veces');
  const sdp = 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
  await P.eventoPasarela(pas, { tipo: 'oferta', call_id: r1.call_id, sdp });
  assert.equal(recibido[yo.id].at(-1).tipo, 'oferta');
  await P.respuestaTel(E, yo, r1.call_id, sdp);
  assert.equal(ordenes.at(-1).accion, 'respuesta');
  await P.eventoPasarela(pas, { tipo: 'estado', call_id: r1.call_id, estado: 'active' });
  assert.equal((await q('SELECT estado FROM llamadas_wa_impar WHERE call_id=$1', [r1.call_id])).rows[0].estado, 'en_curso');
  await P.eventoPasarela(pas, { tipo: 'fin', call_id: r1.call_id });
  assert.equal((await q('SELECT estado FROM llamadas_wa_impar WHERE call_id=$1', [r1.call_id])).rows[0].estado, 'finalizada');
  await new Promise(r => setTimeout(r, 100));
  assert.ok((await q('SELECT count(*) n FROM historial WHERE negociacion_id=$1', [neg1.id])).rows[0].n > 0, 'queda en el historial');

  /* 3) El mismo cliente vuelve a llamar: misma negociación abierta, sin duplicar */
  const r2 = await P.eventoPasarela(pas, { tipo: 'entrante', numero: '+595981000111' });
  const ll2 = (await q('SELECT * FROM llamadas_wa_impar WHERE call_id=$1', [r2.call_id])).rows[0];
  assert.equal(ll2.negociacion_id, neg1.id);
  assert.equal((await q("SELECT count(*) n FROM negociaciones WHERE origen='telefonia'")).rows[0].n, 1);
  await P.cortarTel(E, yo, r2.call_id, { rechazar: true });
  assert.equal(ordenes.at(-1).accion, 'rechazar');
  await P.eventoPasarela(pas, { tipo: 'fin', call_id: r2.call_id });
  assert.equal((await q('SELECT estado FROM llamadas_wa_impar WHERE call_id=$1', [r2.call_id])).rows[0].estado, 'rechazada');

  /* 4) Entrante sin atender: perdida. Número oculto: sin negociación */
  const r3 = await P.eventoPasarela(pas, { tipo: 'entrante', numero: 'withheld' });
  assert.equal((await q('SELECT negociacion_id FROM llamadas_wa_impar WHERE call_id=$1', [r3.call_id])).rows[0].negociacion_id, null);
  await P.eventoPasarela(pas, { tipo: 'fin', call_id: r3.call_id });
  assert.equal((await q('SELECT estado FROM llamadas_wa_impar WHERE call_id=$1', [r3.call_id])).rows[0].estado, 'perdida');

  /* 5) Sin «crear negociación», un número nuevo no crea nada */
  await P.ajustarPasarela(E, { crear_negociacion: false });
  const pas2 = await P.pasarelaPorToken(token);
  const r4 = await P.eventoPasarela(pas2, { tipo: 'entrante', numero: '0981 000 999' });
  assert.equal((await q('SELECT negociacion_id FROM llamadas_wa_impar WHERE call_id=$1', [r4.call_id])).rows[0].negociacion_id, null);
  assert.equal((await q("SELECT count(*) n FROM contactos WHERE tel_norm=right('595981000999',8)")).rows[0].n, 0);

  /* 6) Saliente: orden de marcar en formato internacional; la oferta va a quien llamó */
  const s1 = await P.llamarTel(E, yo, { tel: '0981 000 111' });
  assert.deepEqual(ordenes.at(-1), { accion: 'llamar', call_id: s1.call_id, numero: '+595981000111' });
  await P.eventoPasarela(pas, { tipo: 'estado', call_id: s1.call_id, estado: 'alerting' });
  assert.equal(recibido[yo.id].at(-1).estado, 'sonando_cliente');
  await P.eventoPasarela(pas, { tipo: 'fin', call_id: s1.call_id });
  assert.equal((await q('SELECT estado FROM llamadas_wa_impar WHERE call_id=$1', [s1.call_id])).rows[0].estado, 'sin_respuesta');
  await assert.rejects(() => P.llamarTel(E, yo, { tel: 'abc' }), e => e.status === 422);
  await assert.rejects(() => P.eventoPasarela(pas, { tipo: 'oferta', call_id: 'tel.' + randomUUID(), sdp }), e => e.status === 404, 'otra llamada no se acepta');

  /* 7) Cambiar el token desconecta la pasarela y el viejo deja de valer */
  await P.generarToken(E, {});
  assert.equal(await P.pasarelaPorToken(token), null);
  assert.equal(recibido[otro.id].length, 0);
  void cierre;
  console.log('✔ Pasarela telefónica: token, entrante/saliente, negociación con sello de teléfono y avisos solo al probador');
} catch (e) { fallo = e; }
finally {
  process.on('uncaughtException', e => { if (e?.code !== '57P01') { console.error(e); process.exit(1); } });
  await new Promise(r => setTimeout(r, 300));
  await db.pool.end().catch(() => {});
  await control.query('DROP DATABASE IF EXISTS ' + nombreBase + ' WITH (FORCE)').catch(() => {});
  await control.end();
}
if (fallo) { console.error(fallo); process.exit(1); }
process.exit(0);
