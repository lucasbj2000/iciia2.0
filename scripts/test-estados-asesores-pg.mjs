/** Tiempos por estado de los asesores y salida sin marcar (motivo al día siguiente).
 * PostgreSQL real con base temporal. Nunca usa producción. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (!process.env.TEST_DATABASE_URL) throw new Error('Requiere TEST_DATABASE_URL de pruebas. Nunca usar producción.');
const nombreBase = 'impar_est_' + randomUUID().replaceAll('-', '').slice(0, 16);
const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = '/' + nombreBase;
process.env.DATABASE_URL = url.toString();
process.env.ADMIN_PASS ||= 'Prueba.Impar.2026';
const { calcularTiempos } = await import('../src/estados-asesores-impar.mjs');

/* ---------- Cálculo puro (hora de Paraguay, UTC-3) ---------- */
const L = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`).toISOString();
const ahora = new Date('2026-11-16T10:00:00-03:00');
const marcas = [
  // Viernes 13: jornada completa con almuerzo
  { usuario_id: 'a', estado: 'disponible', ts: L('2026-11-13', '08:00') },
  { usuario_id: 'a', estado: 'almuerzo', ts: L('2026-11-13', '12:00') },
  { usuario_id: 'a', estado: 'ocupado', ts: L('2026-11-13', '13:00') },
  { usuario_id: 'a', estado: 'salida', ts: L('2026-11-13', '17:00') },
  // Sábado 14: no marcó la salida (no debe sumar la noche)
  { usuario_id: 'a', estado: 'disponible', ts: L('2026-11-14', '08:00') },
  // Lunes 16: empezó hoy
  { usuario_id: 'a', estado: 'disponible', ts: L('2026-11-16', '08:30') },
  // Asesor b: olvidó la salida el viernes y la cargó con motivo
  { usuario_id: 'b', estado: 'permiso', ts: L('2026-11-13', '09:00') },
  { usuario_id: 'b', estado: 'salida', ts: L('2026-11-13', '11:00'), origen: 'olvido', motivo: 'Me olvidé de marcar la salida' }
];
const r = calcularTiempos(marcas, { ini: new Date('2026-11-13T00:00:00-03:00'), fin: new Date('2026-11-17T00:00:00-03:00'), ahora });
const h = s => s / 3600;
assert.equal(h(r.a.segundos.disponible), 4 + 16 + 1.5, 'viernes 4 h + sábado hasta medianoche 16 h + hoy 1,5 h hasta ahora');
assert.equal(h(r.a.segundos.almuerzo), 1);
assert.equal(h(r.a.segundos.ocupado), 4);
assert.equal(r.a.dias, 3);
assert.equal(r.a.sinSalida, 1, 'el sábado quedó sin salida');
assert.equal(r.a.sinJustificar, 1);
assert.equal(h(r.b.segundos.permiso), 2);
assert.equal(r.b.sinSalida, 1); assert.equal(r.b.sinJustificar, 0);
assert.equal(r.b.motivos[0].motivo, 'Me olvidé de marcar la salida');
// Un período que empieza después: no arrastra estados de días anteriores
const r2 = calcularTiempos(marcas, { ini: new Date('2026-11-15T00:00:00-03:00'), fin: new Date('2026-11-17T00:00:00-03:00'), ahora });
assert.equal(h(r2.a.segundos.disponible), 1.5);
assert.equal(r2.a.sinSalida, 0);
console.log('✔ cálculo de tiempos por estado, corte al final del día y salidas sin marcar');

/* ---------- Con PostgreSQL ---------- */
const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await control.connect();
await control.query('CREATE DATABASE ' + nombreBase);
const db = await import('../src/db.mjs');
let fallo = null;
try {
  await db.migrar(); await db.seed();
  const { q } = db;
  const E = await import('../src/estados-asesores-impar.mjs');
  const emp = (await q("SELECT id FROM empresas WHERE codigo='impar'")).rows[0].id;
  const u = (await q("INSERT INTO usuarios (empresa_id,nombre,usuario,pass_hash,rol) VALUES ($1,'Asesora','asesora_est','x','agente') RETURNING *", [emp])).rows[0];
  const marca = (estado, ts) => q('INSERT INTO marcaciones (empresa_id,usuario_id,estado,ts) VALUES ($1,$2,$3,$4)', [emp, u.id, estado, ts]);
  const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
  await q("INSERT INTO horarios_empresa (empresa_id,dia,activo,entrada,salida) VALUES ($1,$2,true,'08:00','17:30') ON CONFLICT (empresa_id,dia) DO UPDATE SET activo=true,salida='17:30'",
    [emp, new Date(ayer + 'T12:00:00Z').getUTCDay()]);

  assert.equal(await E.salidaPendiente(u.id), null, 'sin marcaciones no hay nada pendiente');
  await marca('disponible', L(ayer, '08:05'));
  const p = await E.salidaPendiente(u.id);
  assert.deepEqual([p.estado, p.dia, p.sugerida], ['disponible', ayer, '17:30'], 'propone la salida de su turno');

  await assert.rejects(() => E.registrarOlvido(emp, u.id, { hora: '07:00', motivo: 'olvido' }), /posterior/);
  await assert.rejects(() => E.registrarOlvido(emp, u.id, { hora: '17:00', motivo: 'xx' }), /motivo/);
  await assert.rejects(() => E.registrarOlvido(emp, u.id, { hora: '17:00', motivo: 'otro', detalle: '' }), /brevemente/);
  const ok = await E.registrarOlvido(emp, u.id, { hora: '17:10', motivo: 'corte', detalle: 'sin luz desde las 17' });
  assert.equal(ok.motivo, 'Se cortó la luz o internet: sin luz desde las 17');
  const g = (await q("SELECT estado,origen,motivo,ts FROM marcaciones WHERE usuario_id=$1 AND origen='olvido'", [u.id])).rows[0];
  assert.equal(g.estado, 'salida');
  assert.equal(new Date(g.ts).toISOString(), L(ayer, '17:10'));
  assert.equal(await E.salidaPendiente(u.id), null, 'ya no queda pendiente');
  await assert.rejects(() => E.registrarOlvido(emp, u.id, { hora: '17:10', motivo: 'olvido' }), e => e.status === 409, 'no se carga dos veces');

  // Hoy vuelve a iniciar
  await marca('disponible', new Date().toISOString());
  const { rangoDesdeConsulta } = await import('../src/tiempos-respuesta-impar.mjs');
  const t = await E.tiemposAsesores(emp, [u.id], rangoDesdeConsulta({ dias: 7 }));
  assert.equal(Math.round(t[u.id].segundos.disponible / 60) >= 9 * 60 + 5, true, 'ayer 08:05 a 17:10 cuenta como disponible');
  assert.equal(t[u.id].sinSalida, 1); assert.equal(t[u.id].sinJustificar, 0);
  assert.match(t[u.id].motivos[0].motivo, /luz/);
  console.log('✔ salida pendiente, hora propuesta, motivo y vuelta a iniciar con PostgreSQL');
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
