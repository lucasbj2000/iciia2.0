/** Red de seguridad de 24 h en PostgreSQL real: si Meta rechaza (131047) un mensaje del agente por la línea
 * verificada, se reenvía una sola vez por la línea normal, sin borrar el intento y sin duplicados para el agente. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const schema = 'impar_r24_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await admin.connect();
await admin.query(`CREATE SCHEMA "${schema}"`);
Object.assign(process.env, { DATABASE_URL: process.env.TEST_DATABASE_URL, PGOPTIONS: `-c search_path=${schema},public` });
const E = randomUUID(), SUC = randomUUID(), QR = randomUUID(), API = randomUUID(), CT = randomUUID(), N = randomUUID(), AG = randomUUID();
let pool;
try {
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`CREATE TABLE empresas(id uuid PRIMARY KEY);
    CREATE TABLE sucursales(id uuid PRIMARY KEY, empresa_id uuid, nombre text);
    CREATE TABLE usuarios(id uuid PRIMARY KEY, empresa_id uuid, nombre text, sucursal text);
    CREATE TABLE canales(id uuid PRIMARY KEY, empresa_id uuid REFERENCES empresas(id), sucursal_id uuid, nombre text, linea text, tipo text, activo boolean, config jsonb DEFAULT '{}', creado timestamptz DEFAULT now());
    CREATE TABLE negociaciones(id uuid PRIMARY KEY, empresa_id uuid, contacto_id uuid, canal_id uuid, sucursal text);
    CREATE TABLE historial(id bigserial PRIMARY KEY, empresa_id uuid, negociacion_id uuid, txt text, por text, ts timestamptz DEFAULT now());
    CREATE TABLE mensajes(id bigserial PRIMARY KEY, empresa_id uuid, negociacion_id uuid, dir text, txt text, autor_id uuid, estado text,
      archivo_id uuid, media_url text, media_tipo text, media_nombre text, media_bytes int, canal_id uuid, ts timestamptz DEFAULT now());
    CREATE TABLE outbox(id bigserial PRIMARY KEY, empresa_id uuid, canal_id uuid, negociacion_id uuid, destino text, txt text, archivo_id uuid,
      media_url text, media_tipo text, media_nombre text, mensaje_id bigint, cita jsonb, automatico boolean NOT NULL DEFAULT false,
      reenvio_de bigint REFERENCES outbox(id));
    CREATE TABLE wa_entregas_impar(canal_id uuid REFERENCES canales(id), wa_id text, empresa_id uuid REFERENCES empresas(id), outbox_id bigint,
      ack smallint DEFAULT 2, estado_meta text, error_meta text, reenviado_ts timestamptz, rescate text, PRIMARY KEY(canal_id, wa_id));
    ALTER TABLE wa_entregas_impar ADD CONSTRAINT wa_entregas_impar_rescate_chk CHECK (rescate IS NULL OR rescate IN ('reenviado','sin_alternativa','agotado'));`);
  await admin.query(readFileSync(new URL('../src/migrations/035_reenvio_linea_normal_impar.sql', import.meta.url), 'utf8'));
  await admin.query('INSERT INTO empresas VALUES ($1)', [E]);
  await admin.query("INSERT INTO sucursales VALUES ($1,$2,'Central')", [SUC, E]);
  await admin.query("INSERT INTO usuarios VALUES ($1,$2,'Andrea','Central')", [AG, E]);
  await admin.query(`INSERT INTO canales(id,empresa_id,sucursal_id,nombre,tipo,activo,config) VALUES
    ($1,$3,$4,'principal','whatsapp_qr',true,'{"salida_nueva":true}'), ($2,$3,$4,'WhatsApp API Impar Papeles','whatsapp_api',true,'{"principal_global":true}')`, [QR, API, E, SUC]);
  await admin.query("INSERT INTO negociaciones VALUES ($1,$2,$3,$4,'Central')", [N, E, CT, API]);
  const enviar = async (txt, extra = {}) => {
    const m = (await admin.query("INSERT INTO mensajes(empresa_id,negociacion_id,dir,txt,autor_id,estado,canal_id) VALUES ($1,$2,'out',$3,$4,'ok',$5) RETURNING id",
      [E, N, txt, extra.autor === undefined ? AG : extra.autor, API])).rows[0].id;
    const o = (await admin.query('INSERT INTO outbox(empresa_id,canal_id,negociacion_id,destino,txt,mensaje_id,automatico) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [E, API, N, '595991584279', txt, m, !!extra.automatico])).rows[0].id;
    const wa = 'wamid.' + randomUUID();
    await admin.query("INSERT INTO wa_entregas_impar(canal_id,wa_id,empresa_id,outbox_id,ack,estado_meta,error_meta) VALUES ($1,$2,$3,$4,0,'failed',$5)", [API, wa, E, o, extra.codigo || '131047']);
    return { m, o, wa };
  };

  const R = await import('../src/reenvio-linea-normal-impar.mjs');
  ({ pool } = await import('../src/db.mjs'));

  // Caso real: «OLA SEÑOR» rechazado por 24 h → una copia por la línea normal.
  const a = await enviar('OLA SEÑOR');
  const r = await R.reenviarPorLineaNormal({ canalId: API, waId: a.wa, codigo: 131047 });
  assert.equal(r.hecho, true);
  assert.equal(r.canalId, QR);
  const original = (await admin.query('SELECT * FROM mensajes WHERE id=$1', [a.m])).rows[0];
  const copia = (await admin.query('SELECT * FROM mensajes WHERE id=$1', [r.mensajeId])).rows[0];
  assert.equal(String(original.reemplazado_por), String(copia.id), 'el intento rechazado queda enlazado (no se borra)');
  assert.equal(copia.txt, 'OLA SEÑOR');
  assert.equal(copia.autor_id, AG, 'mismo autor');
  assert.equal(copia.canal_id, QR, 'la copia queda registrada en la línea normal');
  assert.equal(copia.ts.getTime(), original.ts.getTime(), 'conserva la hora en que el agente lo escribió');
  const salida = (await admin.query('SELECT * FROM outbox WHERE mensaje_id=$1', [copia.id])).rows;
  assert.equal(salida.length, 1);
  assert.equal(salida[0].canal_id, QR);
  assert.equal(salida[0].destino, '595991584279', 'mismo número del cliente');
  assert.equal(salida[0].reenvio_de, null, 'el agente la ve como su mensaje (no como reenvío oculto)');
  assert.equal((await admin.query('SELECT canal_id FROM negociaciones WHERE id=$1', [N])).rows[0].canal_id, QR, 'lo próximo sale por la normal');
  assert.match((await admin.query('SELECT txt FROM historial WHERE negociacion_id=$1', [N])).rows[0].txt, /se reenvió solo por «principal»/);

  // Un segundo aviso de Meta del mismo mensaje no duplica.
  assert.equal((await R.reenviarPorLineaNormal({ canalId: API, waId: a.wa, codigo: 131047 })).hecho, false);
  assert.equal((await admin.query("SELECT count(*)::int n FROM mensajes WHERE txt='OLA SEÑOR'")).rows[0].n, 2);

  // No aplica: otro error, mensajes automáticos, sin autor (sistema) o la copia de una copia.
  await admin.query('UPDATE negociaciones SET canal_id=$2 WHERE id=$1', [N, API]);
  const b = await enviar('Número sin WhatsApp', { codigo: '131026' });
  assert.equal((await R.reenviarPorLineaNormal({ canalId: API, waId: b.wa, codigo: 131026 })).motivo, 'otro_error');
  const c = await enviar('Hola, soy el asistente', { automatico: true });
  assert.equal((await R.reenviarPorLineaNormal({ canalId: API, waId: c.wa, codigo: 131047 })).motivo, 'no_aplica');
  const d = await enviar('Aviso del sistema', { autor: null });
  assert.equal((await R.reenviarPorLineaNormal({ canalId: API, waId: d.wa, codigo: 131047 })).motivo, 'no_aplica');

  // Sin línea normal posible: no inventa una salida y lo deja marcado.
  await admin.query('UPDATE canales SET activo=false WHERE id=$1', [QR]);
  const e = await enviar('ANDREA SOY DE IMPAR');
  assert.equal((await R.reenviarPorLineaNormal({ canalId: API, waId: e.wa, codigo: 131047 })).motivo, 'sin_linea_normal');
  assert.equal((await admin.query('SELECT rescate FROM wa_entregas_impar WHERE wa_id=$1', [e.wa])).rows[0].rescate, 'sin_linea_normal');
  console.log('✔ Red de seguridad 24 h: un solo reenvío por la línea normal, intento guardado, sin duplicados para el agente.');
} finally {
  await pool?.end().catch(() => {});
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await admin.end();
}
