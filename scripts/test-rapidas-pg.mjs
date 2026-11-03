/** IMPAR · respuestas rápidas personales en PostgreSQL real: dos equipos a la vez sin pérdidas.
 * Nunca usa la base de producción; requiere TEST_DATABASE_URL explícita. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const schema = 'impar_rap_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await admin.connect();
let cerrar = async () => {};
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}",public`);
  await admin.query("CREATE TABLE usuarios(id uuid PRIMARY KEY, rapidas jsonb NOT NULL DEFAULT '[]')");
  const U = randomUUID();
  await admin.query(`INSERT INTO usuarios VALUES ($1,'[{"txt":"Antigua sin id"},{"id":"pviejo1","txt":"Con id"}]')`, [U]);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const db = await import('../src/db.mjs'); cerrar = () => db.pool.end();
  const r = await import('../src/rapidas-personales-impar.mjs');
  const lista = await r.listarPersonales(U);
  assert.equal(lista.length, 2); assert.ok(lista.every(e => /^p[0-9a-z]{4,40}$/i.test(e.id)), 'Ids asignados sin perder nada');
  await Promise.all([...Array(20)].map((_, i) => r.agregarPersonal(U, r.elementoRapida('Respuesta ' + i))));
  let todo = await r.listarPersonales(U);
  assert.equal(todo.length, 22, '20 altas simultáneas, ninguna perdida');
  const [a, b] = [todo[2].id, todo[3].id];
  await Promise.all([r.editarPersonal(U, a, { txt: 'Editada' }), r.borrarPersonal(U, b)]);
  todo = await r.listarPersonales(U);
  assert.equal(todo.length, 21); assert.equal(todo.find(e => e.id === a).txt, 'Editada');
  assert.equal(await r.editarPersonal(U, b, { txt: 'x' }), null, 'Editar una borrada no la revive');
  assert.equal(r.elementoRapida('   '), null);
  await r.borrarPersonal(U, 'pnoexiste'); assert.equal((await r.listarPersonales(U)).length, 21);
  for (const e of await r.listarPersonales(U)) await r.borrarPersonal(U, e.id);
  assert.deepEqual(await r.listarPersonales(U), [], 'Borrar todo deja lista vacía, no nula');
  console.log('✔ Respuestas rápidas personales atómicas validadas en PostgreSQL real.');
} finally {
  await cerrar().catch(() => {});
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await admin.end();
}
