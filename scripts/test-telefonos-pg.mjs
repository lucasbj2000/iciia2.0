/** Prueba de la migración 018 en PostgreSQL real y esquema aislado.
 * Nunca usa la base de producción; requiere TEST_DATABASE_URL explícita.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(!process.env.TEST_DATABASE_URL)throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});
const schema='impar_tel_'+randomUUID().replaceAll('-','');
const sql=readFileSync(new URL('../src/migrations/018_telefonos_contactos_impar.sql',import.meta.url),'utf8');
const E='11111111-1111-4111-8111-111111111111';
const ONE='22222222-2222-4222-8222-222222222222';
const TWO='33333333-3333-4333-8333-333333333333';
const THREE='44444444-4444-4444-8444-444444444444';
await client.connect();
try{
  await client.query('CREATE SCHEMA "'+schema+'"');
  await client.query('SET search_path TO "'+schema+'",public');
  await client.query('CREATE TABLE empresas(id uuid PRIMARY KEY)');
  await client.query('CREATE TABLE contactos(id uuid PRIMARY KEY,empresa_id uuid REFERENCES empresas(id),tel text,tel_norm text)');
  await client.query('CREATE TABLE negociaciones(id uuid PRIMARY KEY)');
  await client.query('INSERT INTO empresas(id) VALUES($1)',[E]);
  await client.query(
    'INSERT INTO contactos(id,empresa_id,tel,tel_norm) VALUES '+
    "($1,$4,'595981111111','81111111'),"+
    "($2,$4,'595982222222','82222222'),"+
    "($3,$4,'595982222222','82222222')",
    [ONE,TWO,THREE,E]);
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  const x=await client.query('SELECT contacto_id,numero,tel_norm,etiqueta FROM contacto_telefonos');
  assert.equal(x.rowCount,1,'El backfill ignora números duplicados en la base anterior');
  assert.equal(x.rows[0].contacto_id,ONE,'Solo agrega el contacto inequívoco');
  const col=await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='negociaciones' AND column_name='telefono_destino'",
    [schema]);
  assert.equal(col.rowCount,1);
  await client.query(sql);
  const after=await client.query('SELECT count(*)::int AS n FROM contacto_telefonos');
  assert.equal(after.rows[0].n,1,'La migración puede ejecutarse otra vez sin duplicar datos');
  await client.query("INSERT INTO contacto_telefonos(empresa_id,contacto_id,numero,tel_norm) VALUES($1,$2,'595983333333','83333333')",[E,ONE]);
  await assert.rejects(
    ()=>client.query("INSERT INTO contacto_telefonos(empresa_id,contacto_id,numero,tel_norm) VALUES($1,$2,'595983333333','83333333')",[E,TWO]),
    e=>e.code==='23505','Unique index impide registrar número en dos clientes');
  console.log('✔ PostgreSQL: migración 018 atómica, backfill seguro y anti-duplicación.');
}finally{
  await client.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
  await client.end();
}
