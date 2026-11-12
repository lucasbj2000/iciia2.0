/** Llamadas de WhatsApp en prueba: solo el administrador probador las ve; los mensajes no cambian.
 * PostgreSQL real con base temporal y Meta simulado (no sale a internet). Nunca usa producción. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (!process.env.TEST_DATABASE_URL) throw new Error('Requiere TEST_DATABASE_URL de pruebas. Nunca usar producción.');
const nombreBase = 'impar_llam_' + randomUUID().replaceAll('-', '').slice(0, 16);
const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await control.connect();
await control.query('CREATE DATABASE ' + nombreBase);
const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = '/' + nombreBase;
process.env.DATABASE_URL = url.toString();
process.env.ADMIN_PASS ||= 'Prueba.Impar.2026';

// Meta simulado: registra cada pedido y responde como la Graph API.
const pedidos = [];
globalThis.fetch = async (u, op = {}) => {
  const body = op.body ? JSON.parse(op.body) : null;
  pedidos.push({ url: String(u), method: op.method || 'GET', body });
  let j = { success: true };
  if (body?.action === 'connect') j = { messaging_product: 'whatsapp', calls: [{ id: 'wacid.SALIENTE01' }] };
  if (String(u).includes('/call_permissions')) j = { permission: { status: 'temporary', expiration_time: 1900000000 }, actions: [{ action_name: 'start_call', can_perform_action: true }] };
  return { ok: true, status: 200, json: async () => j };
};

const db = await import('../src/db.mjs');
let fallo = null;
try {
  await db.migrar();
  await db.seed();
  const { q } = db;
  const L = await import('../src/llamadas-wa-impar.mjs');
  const { sseHandler } = await import('../src/realtime.mjs');
  const meta = await import('../src/channels/meta.mjs');
  const [emp] = (await q("SELECT * FROM empresas WHERE codigo='impar'")).rows;
  const E = emp.id;
  const usuario = async (u, rol) => (await q("INSERT INTO usuarios (empresa_id,nombre,usuario,pass_hash,rol) VALUES ($1,$2,$2,'x',$3) RETURNING *", [E, u, rol])).rows[0];
  const yo = await usuario('lucas_prueba', 'admin');
  const otroAdmin = await usuario('otro_admin', 'admin');
  const vendedor = await usuario('vendedora', 'vendedor');
  const canal = (await q("INSERT INTO canales (empresa_id,tipo,nombre,config,activo) VALUES ($1,'whatsapp_api','Línea API',$2,true) RETURNING *",
    [E, JSON.stringify({ phone_number_id: '999', token: 'EAA-solo-prueba' })])).rows[0];

  // Clientes SSE simulados: qué recibe cada usuario.
  const recibido = {};
  for (const u of [yo, otroAdmin, vendedor]) {
    recibido[u.id] = [];
    sseHandler({ empresaId: E, user: { id: u.id }, on() {} }, { writeHead() {}, write(s) { if (s.startsWith('event: llamada')) recibido[u.id].push(JSON.parse(s.split('data: ')[1])); } });
  }
  const webhook = value => meta.procesarWebhookGuardado('whatsapp_business_account',
    { entry: [{ id: 'waba', changes: [{ field: value.calls ? 'calls' : 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '999' }, ...value } }] }] });
  const oferta = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

  /* 1) Visibilidad: antes de activar, solo administradores; vendedores nunca. */
  let cfg = await L.configLlamadas(E);
  assert.equal(cfg.activo, false);
  assert.equal(L.puedeConfigurar(cfg, yo), true);
  assert.equal(L.puedeConfigurar(cfg, vendedor), false);

  /* 2) Una llamada entrante sin pruebas activas no se registra ni se avisa a nadie. */
  await webhook({ calls: [{ id: 'wacid.ANTES', from: '595981000111', to: '595210000', event: 'connect', session: { sdp_type: 'offer', sdp: oferta } }] });
  assert.equal(Number((await q('SELECT count(*) n FROM llamadas_wa_impar')).rows[0].n), 0);
  assert.equal(Object.values(recibido).flat().length, 0);

  /* 3) Activar en Meta: siempre con el ícono oculto a los clientes. */
  await L.activarEnMeta(await L.canalLlamadas(E));
  const ajuste = pedidos.find(p => p.url.endsWith('/999/settings') && p.method === 'POST');
  assert.deepEqual(ajuste.body, { calling: { status: 'ENABLED', call_icon_visibility: 'DISABLE_ALL' } });
  await q('INSERT INTO llamadas_wa_config_impar(empresa_id,activo,probadores,canal_id) VALUES($1,true,$2,$3)', [E, [yo.id], canal.id]);
  cfg = await L.configLlamadas(E);
  assert.equal(L.esProbador(cfg, yo), true);
  assert.equal(L.puedeConfigurar(cfg, otroAdmin), false, 'Otro administrador ya no ve el panel');

  /* 4) Entrante con pruebas activas: queda registrada y SOLO el probador recibe el aviso. */
  await webhook({ calls: [{ id: 'wacid.ENTRA01', from: '595981000222', to: '595210000', event: 'connect', session: { sdp_type: 'offer', sdp: oferta } }] });
  assert.equal((await q("SELECT estado FROM llamadas_wa_impar WHERE call_id='wacid.ENTRA01'")).rows[0].estado, 'sonando');
  assert.equal(recibido[yo.id].at(-1).tipo, 'entrante');
  assert.equal(recibido[otroAdmin.id].length + recibido[vendedor.id].length, 0, 'Nadie más recibe la llamada');

  /* 5) Atender: otro administrador no puede; el probador hace pre_accept y accept con la misma respuesta. */
  await assert.rejects(() => L.atenderLlamada(E, otroAdmin, 'wacid.ENTRA01', oferta), e => e.status === 403);
  pedidos.length = 0;
  await L.atenderLlamada(E, yo, 'wacid.ENTRA01', oferta);
  assert.deepEqual(pedidos.map(p => p.body.action), ['pre_accept', 'accept']);
  assert.ok(pedidos.every(p => p.url.endsWith('/999/calls') && p.body.session.sdp_type === 'answer'));
  assert.equal((await q("SELECT estado FROM llamadas_wa_impar WHERE call_id='wacid.ENTRA01'")).rows[0].estado, 'en_curso');
  await webhook({ calls: [{ id: 'wacid.ENTRA01', event: 'terminate', status: 'COMPLETED', duration: 42 }] });
  const fin = (await q("SELECT estado,duracion FROM llamadas_wa_impar WHERE call_id='wacid.ENTRA01'")).rows[0];
  assert.deepEqual(fin, { estado: 'finalizada', duracion: 42 });

  /* 6) Saliente: se envía la oferta y la respuesta de Meta llega solo a quien llamó. */
  pedidos.length = 0;
  const r = await L.iniciarLlamada(E, yo, { tel: '+595 981 000 333', sdp: oferta });
  assert.equal(r.call_id, 'wacid.SALIENTE01');
  assert.deepEqual({ ...pedidos[0].body, session: undefined }, { messaging_product: 'whatsapp', to: '595981000333', action: 'connect', session: undefined });
  await webhook({ statuses: [{ id: 'wacid.SALIENTE01', type: 'call', status: 'RINGING', recipient_id: '595981000333' }] });
  await webhook({ calls: [{ id: 'wacid.SALIENTE01', event: 'connect', direction: 'BUSINESS_INITIATED', session: { sdp_type: 'answer', sdp: oferta } }] });
  assert.equal(recibido[yo.id].at(-1).tipo, 'respuesta');
  assert.equal(Number((await q("SELECT count(*) n FROM wa_entregas_impar WHERE wa_id='wacid.SALIENTE01'")).rows[0].n), 0, 'El estado de llamada no se mezcla con los acuses de mensajes');
  await assert.rejects(() => L.iniciarLlamada(E, otroAdmin, { tel: '595981000333', sdp: oferta }), e => e.status === 403);

  /* 7) Respuesta de permiso: avisa al probador y no entra al chat como mensaje. */
  await webhook({ messages: [{ id: 'wamid.PERM1', from: '595981000333', timestamp: '1700000000', type: 'interactive', interactive: { type: 'call_permission_reply', call_permission_reply: { response: 'accept', is_permanent: false } } }] });
  assert.equal(recibido[yo.id].at(-1).tipo, 'permiso');
  assert.equal(Number((await q("SELECT count(*) n FROM inbox WHERE ext_id='wamid.PERM1'")).rows[0].n), 0);

  /* 8) Los mensajes comunes siguen entrando exactamente igual. */
  await webhook({ contacts: [{ wa_id: '595981000444', profile: { name: 'Cliente' } }], messages: [{ id: 'wamid.TXT1', from: '595981000444', timestamp: '1700000001', type: 'text', text: { body: 'Hola' } }] });
  assert.equal(Number((await q("SELECT count(*) n FROM inbox WHERE ext_id='wamid.TXT1'")).rows[0].n), 1);
  assert.equal(recibido[otroAdmin.id].length + recibido[vendedor.id].length, 0);
  console.log('✔ Llamadas de WhatsApp: solo el probador, ícono oculto, entrante/saliente y mensajes intactos');
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
