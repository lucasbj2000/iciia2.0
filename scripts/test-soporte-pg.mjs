/** Prueba de la migración 029 (soporte) en PostgreSQL real y esquema aislado.
 * Nunca usa la base de producción; requiere TEST_DATABASE_URL explícita. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const schema = 'impar_sop_' + randomUUID().replaceAll('-', '');
const sql = readFileSync(new URL('../src/migrations/029_soporte_impar.sql', import.meta.url), 'utf8');
const E = '11111111-1111-4111-8111-111111111111', U = '22222222-2222-4222-8222-222222222222';
await client.connect();
try {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}",public`);
  await client.query('CREATE TABLE empresas(id uuid PRIMARY KEY)');
  await client.query('CREATE TABLE usuarios(id uuid PRIMARY KEY, empresa_id uuid)');
  await client.query('INSERT INTO empresas VALUES ($1)', [E]);
  await client.query('INSERT INTO usuarios VALUES ($1,$2)', [U, E]);
  for (let i = 0; i < 2; i++) await client.query(sql); // idempotente
  const s = await client.query(`INSERT INTO soporte_solicitudes (empresa_id,autor_id,tipo,titulo) VALUES ($1,$2,'falla','Prueba') RETURNING *`, [E, U]);
  assert.equal(s.rows[0].estado, 'gerencia', 'estado inicial por defecto');
  assert.ok(Number(s.rows[0].numero) >= 1, 'numeración automática');
  await assert.rejects(client.query(`INSERT INTO soporte_solicitudes (empresa_id,tipo,titulo) VALUES ($1,'otro','x')`, [E]), /check/i, 'tipo validado');
  await assert.rejects(client.query(`UPDATE soporte_solicitudes SET estado='inventado'`), /check/i, 'estado validado');
  await client.query("INSERT INTO soporte_eventos (solicitud_id,usuario_id,tipo) VALUES ($1,$2,'creada')", [s.rows[0].id, U]);
  await client.query('INSERT INTO soporte_config (empresa_id,aprobadores) VALUES ($1,$2)', [E, [U]]);
  await client.query('DELETE FROM usuarios WHERE id=$1', [U]);
  const tras = await client.query('SELECT autor_id FROM soporte_solicitudes');
  assert.equal(tras.rows[0].autor_id, null, 'borrar un usuario conserva sus solicitudes');
  await client.query('DELETE FROM soporte_solicitudes');
  assert.equal((await client.query('SELECT COUNT(*) FROM soporte_eventos')).rows[0].count, '0', 'eventos se borran con la solicitud');
  console.log('✔ Migración 029 de soporte validada en PostgreSQL real.');
} finally {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await client.end();
}
