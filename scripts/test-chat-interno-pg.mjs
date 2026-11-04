/** Chat interno: las consultas funcionan en PostgreSQL real (un mismo parámetro no puede ser uuid y texto).
 * Esquema aislado; requiere TEST_DATABASE_URL explícita. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const fuente = readFileSync(new URL('../src/routes/varios.mjs', import.meta.url), 'utf8');
// Las tres sentencias INSERT INTO mensajes_internos tal como están en la ruta.
const inserts = [...fuente.matchAll(/q\(`(INSERT INTO mensajes_internos[\s\S]*?)`/g)].map(m => m[1]);
assert.equal(inserts.length, 3, 'Se encontraron los tres INSERT del chat interno');
// Toda consulta que toca «leido»: resumen, marcar como leído y envíos.
const conLeido = [...fuente.matchAll(/q\(\s*`([^`]*leido[^`]*)`/g)].map(m => m[1]);
assert.ok(conLeido.length >= 7, 'Se revisan resumen, lectura y envíos');
const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const schema = 'impar_chat_' + randomUUID().replaceAll('-', '');
const E = randomUUID(), U1 = randomUUID(), U2 = randomUUID(), G = randomUUID();
await client.connect();
try {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}",public`);
  await client.query(`CREATE TABLE mensajes_internos(id bigserial PRIMARY KEY, empresa_id uuid NOT NULL, grupo_id uuid, de_id uuid NOT NULL,
    para_id uuid, txt text NOT NULL, leido jsonb NOT NULL DEFAULT '[]', ts timestamptz NOT NULL DEFAULT now())`);
  await client.query(`CREATE TABLE usuarios(id uuid PRIMARY KEY, empresa_id uuid, nombre text, rol text, sucursal text, foto text,
    disponibilidad text, activo boolean DEFAULT true, oculto boolean DEFAULT false)`);
  await client.query(`CREATE TABLE grupos(id uuid PRIMARY KEY, empresa_id uuid, nombre text, miembros jsonb DEFAULT '[]', creado timestamptz DEFAULT now())`);
  for (const [i, sql] of conLeido.entries()) {
    assert.ok(!sql.includes('${'), 'Consulta sin interpolación');
    await client.query(`PREPARE chat_${i} AS ${sql}`);
  }
  const [grupo, directo, creado] = inserts;
  await client.query(grupo, [E, G, U1, 'Hola grupo', String(U1)]);
  await client.query(directo, [E, U1, U2, 'Hola Diego', String(U1)]);
  await client.query(creado, [E, G, U1, 'Grupo creado', String(U1)]);
  const { rows } = await client.query('SELECT txt, leido FROM mensajes_internos ORDER BY id');
  assert.deepEqual(rows.map(r => r.txt), ['Hola grupo', 'Hola Diego', 'Grupo creado']);
  assert.ok(rows.every(r => r.leido[0] === U1), 'El autor queda como leído');
  console.log(`✔ Chat interno: ${conLeido.length} consultas de lectura y envío válidas en PostgreSQL real; los mensajes se guardan.`);
} finally {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await client.end();
}
