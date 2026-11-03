/** Sala de control: la foto del día en PostgreSQL real, en un esquema aislado.
 * Nunca usa la base de producción; requiere TEST_DATABASE_URL explícita. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const { fotoSala, nombreCorto } = await import('../src/sala-control-impar.mjs');
const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const schema = 'impar_sala_' + randomUUID().replaceAll('-', '');
const E = randomUUID(), OTRA = randomUUID(), A1 = randomUUID(), A2 = randomUUID(), C1 = randomUUID(), C2 = randomUUID();
await client.connect();
try {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}",public`);
  await client.query(`CREATE TABLE sucursales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, nombre text, ciudad text DEFAULT '',
      lat double precision, lon double precision, activa boolean DEFAULT true);
    CREATE TABLE usuarios(id uuid PRIMARY KEY, empresa_id uuid, nombre text, foto text, disponibilidad text, sucursal text, rol text,
      activo boolean DEFAULT true, oculto boolean DEFAULT false);
    CREATE TABLE contactos(id uuid PRIMARY KEY, empresa_id uuid, nombre text, ciudad text DEFAULT '', lat double precision, lon double precision);
    CREATE TABLE ubicaciones(id bigserial PRIMARY KEY, contacto_id uuid, lat double precision, lon double precision, ts timestamptz DEFAULT now());
    CREATE TABLE negociaciones(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, contacto_id uuid, agente_id uuid, etapa text,
      sucursal text, valor numeric DEFAULT 0, monto_cierre numeric DEFAULT 0, creado timestamptz DEFAULT now(), actualizado timestamptz DEFAULT now(),
      entrada_etapa timestamptz DEFAULT now());
    CREATE TABLE mensajes(id bigserial PRIMARY KEY, empresa_id uuid, negociacion_id uuid, dir text, bot boolean DEFAULT false,
      carga_historica boolean DEFAULT false, autor_id uuid, ts timestamptz DEFAULT now());`);
  await client.query(`INSERT INTO sucursales(empresa_id,nombre) VALUES ($1,'Asunción'),($1,'Encarnación'),($2,'Ajena')`, [E, OTRA]);
  await client.query(`INSERT INTO usuarios VALUES ($2,$1,'Andrea Recalde',NULL,'disponible','Asunción','agente'),($3,$1,'Tomás Acosta',NULL,'almuerzo','Encarnación','agente')`, [E, A1, A2]);
  await client.query(`INSERT INTO contactos(id,empresa_id,nombre,ciudad) VALUES ($2,$1,'María Elena González','Encarnación'),($3,$1,'Librería Sol','')`, [E, C1, C2]);
  await client.query(`INSERT INTO ubicaciones(contacto_id,lat,lon) VALUES ($1,-25.2871,-57.6411)`, [C2]);
  const n1 = randomUUID(), n2 = randomUUID(), n3 = randomUUID();
  await client.query(`INSERT INTO negociaciones(id,empresa_id,contacto_id,agente_id,etapa,sucursal,entrada_etapa) VALUES
      ($2,$1,$5,$6,'espera','Asunción',now()-interval '20 minutes'),
      ($3,$1,$7,$8,'ganado','IMPAR Encarnación',now()),
      ($4,$9,$5,NULL,'espera','Ajena',now())`, [E, n1, n2, n3, C1, A1, C2, A2, OTRA]);
  await client.query(`UPDATE negociaciones SET monto_cierre=1500000 WHERE id=$1`, [n2]);
  await client.query(`INSERT INTO mensajes(empresa_id,negociacion_id,dir,ts) VALUES ($1,$2,'in',now()-interval '10 minutes')`, [E, n1]);
  await client.query(`INSERT INTO mensajes(empresa_id,negociacion_id,dir,autor_id,ts) VALUES ($1,$2,'out',$3,now()-interval '6 minutes')`, [E, n1, A1]);
  await client.query(`INSERT INTO mensajes(empresa_id,negociacion_id,dir,bot,ts) VALUES ($1,$2,'out',true,now()-interval '9 minutes')`, [E, n1]);
  await client.query(`INSERT INTO mensajes(empresa_id,negociacion_id,dir,carga_historica,ts) VALUES ($1,$2,'in',true,now())`, [E, n1]);

  const req = { empresaId: E, user: { id: randomUUID(), rol: 'gerente' } };
  // fotoSala consulta en paralelo: un pool chico, todas sus conexiones dentro del esquema aislado.
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 6, options: `-c search_path=${schema},public` });
  const d = await fotoSala(req, (sql, p) => pool.query(sql, p)).finally(() => pool.end());
  assert.deepEqual(d.sucursales.map(s => s.nombre).sort(), ['Asunción', 'Encarnación'], 'Solo sucursales de la empresa');
  assert.ok(d.sucursales.every(s => s.lat != null && s.lon != null), 'Sucursales sin coordenadas toman la ubicación conocida de IMPAR');
  assert.equal(d.cola.length, 1, 'La cola no mezcla otras empresas');
  assert.equal(d.cola[0].cliente, 'María G.', 'En pantalla compartida solo nombre e inicial');
  assert.ok(!JSON.stringify(d).includes('González'), 'Nunca el apellido completo del cliente');
  assert.equal(d.primeraRespuesta.n, 1);
  assert.equal(d.primeraRespuesta.total, 1, 'Tasa de respuesta: 1 de 1 conversaciones de hoy');
  assert.equal(d.calor.ubicados, 2, 'Un cliente por ciudad informada y otro por ubicación');
  assert.ok(d.calor.zonas.some(z => z.lat === -25.3 && z.lon === -57.6), 'Ubicación redondeada a celdas de 0,1°');
  assert.ok(!JSON.stringify(d.calor).includes('-25.2871'), 'Nunca la ubicación exacta');
  assert.ok(d.equipo.every(u => u.enLinea === false), 'Sin pestañas abiertas nadie figura en línea');
  assert.ok(Math.abs(d.primeraRespuesta.mediana - 240) < 5, 'La respuesta del bot no cuenta como primera respuesta');
  const asu = d.porSucursal.find(x => x.sucursal === 'Asunción'), enc = d.porSucursal.find(x => x.sucursal === 'IMPAR Encarnación');
  assert.equal(asu.espera, 1); assert.equal(enc.ventas, 1); assert.equal(enc.monto, 1500000);
  assert.equal(d.ritmo.reduce((a, h) => a + h.entran, 0), 1, 'La carga histórica no cuenta en el ritmo del día');
  assert.deepEqual(d.equipo.map(u => [u.nombre, u.respuestas]), [['Andrea Recalde', 1], ['Tomás Acosta', 0]]);
  assert.equal(nombreCorto(''), 'Cliente');
  console.log('✔ Sala de control: foto del día correcta, aislada por empresa y sin datos completos de clientes.');
} finally {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await client.end();
}
