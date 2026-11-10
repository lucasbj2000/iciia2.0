/** «Contactado» sin retorno en PostgreSQL real: a las 24 h corridas sin respuesta del cliente se cierra
 * como «Sin retorno»; un seguimiento del agente vuelve a dar el plazo; las acumuladas avisan una sola vez. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const schema = 'impar_sr_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await admin.connect();
await admin.query(`CREATE SCHEMA "${schema}"`);
Object.assign(process.env, { DATABASE_URL: process.env.TEST_DATABASE_URL, PGOPTIONS: `-c search_path=${schema},public` });
const E = randomUUID(), A1 = randomUUID(), A2 = randomUUID(), J = randomUUID();
try {
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`CREATE TABLE empresas(id uuid PRIMARY KEY, codigo text, activa boolean DEFAULT true, flags jsonb DEFAULT '{}', reglas jsonb DEFAULT '{}', notis jsonb DEFAULT '[]');
    CREATE TABLE usuarios(id uuid PRIMARY KEY, empresa_id uuid, rol text, activo boolean DEFAULT true);
    CREATE TABLE contactos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, nombre text);
    CREATE TABLE negociaciones(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, contacto_id uuid, agente_id uuid, etapa text,
      motivo text, entrada_etapa timestamptz, actualizado timestamptz DEFAULT now(), aviso_sla boolean DEFAULT false);
    CREATE TABLE mensajes(id bigserial PRIMARY KEY, empresa_id uuid, negociacion_id uuid, dir text, carga_historica boolean DEFAULT false, ts timestamptz DEFAULT now());
    CREATE TABLE historial(id bigserial PRIMARY KEY, empresa_id uuid, negociacion_id uuid, txt text, por text, ts timestamptz DEFAULT now());
    CREATE TABLE notificaciones(id bigserial PRIMARY KEY, empresa_id uuid, usuario_id uuid, tipo text, titulo text, msg text, tono text, ref uuid);`);
  await admin.query(`INSERT INTO empresas(id,codigo,flags,reglas,notis) VALUES ($1,'impar','{"notificaciones":true}','{"slaHoras":24}',
    '[{"k":"autocierre","t":"Cierre automático","msg":"{cliente} se cerró por falta de retorno","dest":"agente+jefe","v":true,"tono":"bad"},
      {"k":"sla","t":"SLA","msg":"{cliente} · {tiempo}","dest":"agente","v":true,"tono":"warn"}]')`, [E]);
  await admin.query(readFileSync(new URL('../src/migrations/037_cierre_sin_retorno_impar.sql', import.meta.url), 'utf8'));
  const { rows: [emp] } = await admin.query('SELECT flags,reglas FROM empresas');
  assert.equal(emp.flags.autoCierre, true, 'La migración activa el cierre automático');
  assert.equal(emp.reglas.sinRetornoHoras, 24); assert.equal(emp.reglas.slaHoras, 24, 'No toca las otras reglas');
  await admin.query("INSERT INTO usuarios VALUES ($1,$4,'agente'),($2,$4,'agente'),($3,$4,'jefe')", [A1, A2, J, E]);

  const neg = async (nombre, agente, etapa, horas, salida = null) => {
    const c = (await admin.query('INSERT INTO contactos(empresa_id,nombre) VALUES ($1,$2) RETURNING id', [E, nombre])).rows[0].id;
    const n = (await admin.query(`INSERT INTO negociaciones(empresa_id,contacto_id,agente_id,etapa,entrada_etapa) VALUES ($1,$2,$3,$4,now()-make_interval(hours=>$5)) RETURNING id`,
      [E, c, agente, etapa, horas])).rows[0].id;
    if (salida != null) await admin.query(`INSERT INTO mensajes(empresa_id,negociacion_id,dir,ts) VALUES ($1,$2,'out',now()-make_interval(hours=>$3))`, [E, n, salida]);
    return n;
  };
  const vencida = await neg('Ana', A1, 'contactado', 25, 26);       // 25 h corridas sin respuesta → se cierra
  const fresca = await neg('Beto', A1, 'contactado', 10);            // 10 h → sigue
  const seguida = await neg('Carla', A1, 'contactado', 40, 3);       // el agente le escribió hace 3 h → sigue
  const avisada = await neg('Dani', A1, 'contactado', 20);           // 20 h → aviso previo, no cierre
  const espera = await neg('Eva', A1, 'espera', 50);                 // otra etapa → no se toca
  const lote = [];
  for (let i = 0; i < 6; i++) lote.push(await neg('Lote ' + i, A2, 'contactado', 72));  // acumuladas de otro agente

  const { motorSLA } = await import('../src/core.mjs');
  await motorSLA();
  const etapa = async id => (await admin.query('SELECT etapa,motivo FROM negociaciones WHERE id=$1', [id])).rows[0];
  assert.deepEqual(await etapa(vencida), { etapa: 'cerrado', motivo: 'Sin retorno' }, 'A las 24 h corridas se cierra como Sin retorno');
  assert.equal((await etapa(fresca)).etapa, 'contactado');
  assert.equal((await etapa(seguida)).etapa, 'contactado', 'Un seguimiento del agente vuelve a dar el plazo');
  assert.equal((await etapa(avisada)).etapa, 'contactado');
  assert.equal((await etapa(espera)).etapa, 'espera', 'Solo afecta a «Contactado»');
  for (const id of lote) assert.equal((await etapa(id)).etapa, 'cerrado', 'Las acumuladas se cierran todas');
  const { rows: his } = await admin.query('SELECT txt FROM historial WHERE negociacion_id=$1', [vencida]);
  assert.ok(his[0].txt.includes('no respondió en 24 h'), 'Queda en el Historial');
  const { rows: notis } = await admin.query('SELECT usuario_id,tipo,msg FROM notificaciones ORDER BY id');
  const deA2 = notis.filter(n => n.tipo === 'autocierre' && n.usuario_id === A2);
  assert.equal(deA2.length, 1, 'Seis cierres juntos: un solo aviso al agente');
  assert.ok(deA2[0].msg.startsWith('Se cerraron 6 negociaciones'));
  assert.equal(notis.filter(n => n.tipo === 'autocierre' && n.usuario_id === J).length, 2, 'El jefe recibe un aviso por agente, no uno por cliente');
  assert.ok(notis.some(n => n.tipo === 'sla' && n.usuario_id === A1 && n.msg.startsWith('Dani')), 'Aviso previo antes del cierre');
  await motorSLA();
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM notificaciones WHERE tipo='sla'")).rows[0].n, 1, 'El aviso previo no se repite');

  // Sin el cierre automático activo no se cierra nada.
  const otra = await neg('Fabi', A1, 'contactado', 30);
  await admin.query(`UPDATE empresas SET flags=flags||'{"autoCierre":false}'`);
  await motorSLA();
  assert.equal((await etapa(otra)).etapa, 'contactado');
  console.log('✔ IMPAR: «Contactado» sin respuesta en 24 h se cierra como Sin retorno, con avisos agrupados.');
} finally {
  const { pool } = await import('../src/db.mjs').catch(() => ({}));
  await pool?.end?.().catch(() => {});
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {});
  await admin.end();
}
