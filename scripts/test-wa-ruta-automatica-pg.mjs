/** IMPAR · ruta WhatsApp automática (número/LID) contra PostgreSQL real, esquema aislado.
 * Nunca usa la base de producción; requiere TEST_DATABASE_URL explícita. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const schema = 'impar_ruta_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const leer = f => readFileSync(new URL('../src/migrations/' + f, import.meta.url), 'utf8');
const E = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222';
const pn = '595981000001@s.whatsapp.net', lid = '123456789012345@lid';
await admin.connect();
let cerrarPool = async () => {};
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}",public`);
  await admin.query('CREATE TABLE empresas(id uuid PRIMARY KEY)');
  await admin.query('CREATE TABLE canales(id uuid PRIMARY KEY)');
  await admin.query('CREATE TABLE mensajes(id bigserial PRIMARY KEY)');
  await admin.query('CREATE TABLE outbox(id bigserial PRIMARY KEY, empresa_id uuid, negociacion_id uuid)');
  await admin.query('INSERT INTO empresas VALUES ($1)', [E]);
  await admin.query('INSERT INTO canales VALUES ($1)', [C]);
  await admin.query(leer('020_wa_entregas_impar.sql'));
  await admin.query(leer('021_wa_identidades_impar.sql'));
  // Una elección LID manual previa debe conservarse al migrar.
  await admin.query('INSERT INTO wa_identidades_impar(empresa_id,canal_id,pn_jid,lid_jid,preferir_lid) VALUES($1,$2,$3,$4,true)',
    [E, C, '595981000009@s.whatsapp.net', '999999999999999@lid']);
  for (let i = 0; i < 2; i++) await admin.query(leer('030_wa_ruta_automatica_impar.sql')); // idempotente
  assert.equal((await admin.query("SELECT ruta FROM wa_identidades_impar WHERE pn_jid='595981000009@s.whatsapp.net'")).rows[0].ruta, 'lid');

  // El módulo usa el pool de db.mjs: apuntarlo al esquema aislado.
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const db = await import('../src/db.mjs');
  cerrarPool = () => db.pool.end();
  const id = await import('../src/wa-identidades-impar.mjs');
  const canal = { id: C, empresa_id: E };

  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, pn, 'Sin equivalencia: número');
  await id.registrarParejaWA(canal, { pn, lid }, 'mensaje_entrante', 'pn');
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, pn, 'El cliente escribe desde su número');
  await id.registrarModoEntranteWA(canal, { remoteJid: '123456789012345:7@lid' });
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, lid, 'El cliente pasó a escribir por LID');

  // Aviso de «no pude descifrar» de un mensaje enviado por LID → vuelve al número.
  await admin.query("INSERT INTO wa_entregas_impar(canal_id,empresa_id,wa_id,ack,jid_tipo) VALUES($1,$2,'MSG1',3,'lid')", [C, E]);
  const r = await id.registrarReintentoWA(canal, { from: '123456789012345:7@lid', id: 'MSG1', type: 'retry' });
  assert.equal(r.tipo, 'lid'); assert.equal(r.contacto, true);
  assert.equal((await admin.query("SELECT reintentos FROM wa_entregas_impar WHERE wa_id='MSG1'")).rows[0].reintentos, 1);
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, pn, 'Falló LID: próximos envíos al número');
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).motivo, 'fallo_lid');
  // Dos fallos del número (como en el caso real) → LID.
  await id.registrarReintentoWA(canal, { from: '595981000001:3@s.whatsapp.net', id: 'X', type: 'retry' });
  await id.registrarReintentoWA(canal, { from: '595981000001@s.whatsapp.net', id: 'Y', type: 'retry' });
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, lid, 'Falló el número más veces: LID');
  // Un mensaje leído por LID confirma esa ruta.
  assert.equal(await id.confirmarRutaWA(canal, lid), true);
  assert.equal((await admin.query('SELECT fallos_lid FROM wa_identidades_impar WHERE pn_jid=$1', [pn])).rows[0].fallos_lid, 0);

  // Elección fija del admin y regreso a automática.
  assert.equal(await id.elegirRutaWA(E, C, pn, 'pn'), true);
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, pn);
  const est = await id.estadoRutaWA(E, C, pn);
  assert.equal(est.ruta, 'pn'); assert.equal(est.motivo, 'manual');
  assert.equal(await id.elegirRutaWA(E, C, pn, 'auto'), true);
  assert.equal((await admin.query('SELECT fallos_pn FROM wa_identidades_impar WHERE pn_jid=$1', [pn])).rows[0].fallos_pn, 0, 'Volver a automática limpia fallos');

  // WhatsApp informa otro LID: vuelve a automática y olvida fallos y elecciones.
  await id.elegirRutaWA(E, C, pn, 'lid');
  await id.registrarParejaWA(canal, { pn, lid: '555555555555555@lid' }, 'mensaje_entrante', null);
  const f = (await admin.query('SELECT ruta,modo_entrante FROM wa_identidades_impar WHERE pn_jid=$1', [pn])).rows[0];
  assert.equal(f.ruta, 'auto'); assert.equal(f.modo_entrante, 'lid', 'Conserva el último modo conocido');
  // Aislamiento por canal.
  assert.equal((await id.rutaParaEnvioWA({ id: randomUUID(), empresa_id: E }, pn)).destino, pn);
  await assert.rejects(admin.query("UPDATE wa_identidades_impar SET ruta='otra'"), /check/i);
  console.log('✔ Ruta WhatsApp automática validada en PostgreSQL real.');
} finally {
  await cerrarPool().catch(() => {});
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await admin.end();
}
