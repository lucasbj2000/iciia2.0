/** Línea verificada y ventana de 24 h en PostgreSQL real: fuera de plazo sale por la línea normal principal. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const schema = 'impar_24h_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await admin.connect();
await admin.query(`CREATE SCHEMA "${schema}"`);
Object.assign(process.env, { DATABASE_URL: process.env.TEST_DATABASE_URL, PGOPTIONS: `-c search_path=${schema},public` });
const E = randomUUID(), SUC = randomUUID(), QR = randomUUID(), API = randomUUID(), CT = randomUUID(), N1 = randomUUID(), N2 = randomUUID();
let pool;
try {
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`CREATE TABLE sucursales(id uuid PRIMARY KEY, empresa_id uuid, nombre text);
    CREATE TABLE canales(id uuid PRIMARY KEY, empresa_id uuid, sucursal_id uuid, nombre text, linea text, tipo text, activo boolean, config jsonb DEFAULT '{}', creado timestamptz DEFAULT now());
    CREATE TABLE negociaciones(id uuid PRIMARY KEY, empresa_id uuid, contacto_id uuid, canal_id uuid);
    CREATE TABLE mensajes(id bigserial PRIMARY KEY, empresa_id uuid, negociacion_id uuid, dir text, canal_id uuid, ts timestamptz DEFAULT now());`);
  await admin.query("INSERT INTO sucursales VALUES ($1,$2,'Central')", [SUC, E]);
  await admin.query(`INSERT INTO canales(id,empresa_id,sucursal_id,nombre,tipo,activo,config,creado) VALUES
    ($1,$3,$4,'Principal','whatsapp_qr',true,'{"principal_global":true}',now()-interval '1 day'),
    ($2,$3,$4,'WhatsApp API Impar Papeles','whatsapp_api',true,'{}',now())`, [QR, API, E, SUC]);
  await admin.query('INSERT INTO negociaciones VALUES ($1,$3,$4,$5),($2,$3,$4,$6)', [N1, N2, E, CT, API, QR]);

  const V = await import('../src/ventana-24h-impar.mjs');
  ({ pool } = await import('../src/db.mjs'));
  const ruta = () => V.rutaDeEnvio({ empresaId: E, contactoId: CT, canalId: API });

  // El cliente escribió por la verificada hace 2 días (como Ari): sale por la normal.
  await admin.query("INSERT INTO mensajes(empresa_id,negociacion_id,dir,canal_id,ts) VALUES ($1,$2,'in',$3,now()-interval '2 days')", [E, N1, API]);
  // Un mensaje reciente por OTRA línea no abre la ventana de la verificada.
  await admin.query("INSERT INTO mensajes(empresa_id,negociacion_id,dir,canal_id,ts) VALUES ($1,$2,'in',$3,now()-interval '1 hour')", [E, N2, QR]);
  assert.deepEqual(await ruta(), { canalId: QR, cambio: { de: 'WhatsApp API Impar Papeles', a: 'Principal' } });

  // Escribió por la verificada hace 3 h: se responde por la verificada.
  await admin.query("INSERT INTO mensajes(empresa_id,negociacion_id,dir,canal_id,ts) VALUES ($1,$2,'in',$3,now()-interval '3 hours')", [E, N1, API]);
  assert.deepEqual(await ruta(), { canalId: API, cambio: null });
  // Mensajes viejos sin canal guardado: cuenta la línea de su conversación.
  await admin.query("DELETE FROM mensajes WHERE canal_id=$1", [API]);
  await admin.query("INSERT INTO mensajes(empresa_id,negociacion_id,dir,canal_id,ts) VALUES ($1,$2,'in',NULL,now()-interval '30 minutes')", [E, N1]);
  assert.equal((await ruta()).cambio, null);

  // Al borde: 23 h 58 min ya se considera cerrada (margen de seguridad).
  await admin.query("DELETE FROM mensajes WHERE negociacion_id=$1", [N1]);
  await admin.query("INSERT INTO mensajes(empresa_id,negociacion_id,dir,canal_id,ts) VALUES ($1,$2,'in',$3,now()-interval '23 hours 58 minutes')", [E, N1, API]);
  assert.equal((await ruta()).canalId, QR);

  // La línea normal no se toca, y sin línea normal se avisa en vez de enviar algo que Meta rechazaría.
  assert.deepEqual(await V.rutaDeEnvio({ empresaId: E, contactoId: CT, canalId: QR }), { canalId: QR, cambio: null });
  // Sin principal marcada pero con una sola línea normal activa: esa.
  await admin.query("UPDATE canales SET config='{}' WHERE id=$1", [QR]);
  await admin.query("INSERT INTO canales(id,empresa_id,nombre,tipo,activo) VALUES ($1,$2,'Otra API','whatsapp_api',true)", [randomUUID(), E]);
  assert.equal((await ruta()).canalId, QR);
  await admin.query('UPDATE canales SET activo=false WHERE id=$1', [QR]);
  await assert.rejects(ruta(), e => e.status === 409 && /más de 24 horas/.test(e.message));
  assert.match(V.motivoMeta(131047), /24 h/);
  assert.equal(V.motivoMeta(''), '');
  console.log('✔ Ventana de 24 h: la verificada fuera de plazo sale por la línea normal; nunca se envía algo que Meta rechace.');
} finally {
  await pool?.end().catch(() => {});
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await admin.end();
}
