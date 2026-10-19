/** Integration test: migrations 016 & 017 on real PostgreSQL with synthetic data.
 * Uses an isolated schema, never the production database.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL required; refuses to run against production.');
const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});
const schema='impar_test_'+randomUUID().replaceAll('-','');
const path=n=>readFileSync(new URL('../src/migrations/'+n,import.meta.url),'utf8');
const m16=path('016_canal_principal_impar.sql');
const m17=path('017_activar_whatsapp_unico_impar.sql');
assert.ok(!/\bmin\s*\(\s*(?:c\.)?id\s*\)/i.test(m16+m17),
  'Do not use MIN(uuid); PostgreSQL does not implement it');
const EMP='11111111-1111-4111-8111-111111111111';
const S1='22222222-2222-4222-8222-222222222222';
const S2='33333333-3333-4333-8333-333333333333';
const C1='44444444-4444-4444-8444-444444444444';
const C2='55555555-5555-4555-8555-555555555555';
const query=(...args)=>client.query(...args);
const reset=async()=>{
  await query('TRUNCATE TABLE canales,sucursales,empresas');
  await query("INSERT INTO empresas(id,codigo,activa) VALUES ($1,'impar',true)",[EMP]);
};
const sucursal=async(id,nombre)=>query(
  'INSERT INTO sucursales(id,empresa_id,nombre) VALUES($1,$2,$3)',[id,EMP,nombre]);
const canal=async(id,sucId,nombre,config={})=>query(
  "INSERT INTO canales(id,empresa_id,sucursal_id,nombre,tipo,activo,config) VALUES($1,$2,$3,$4,'whatsapp_qr',true,$5)",
  [id,EMP,sucId,nombre,config]);
const marcado=async id=>{
 const r=await query("SELECT config->>'principal_global' AS principal FROM canales WHERE id=$1",[id]);
 return r.rows[0]?.principal==='true';
};
await client.connect();
try{
  await query('CREATE SCHEMA "'+schema+'"');
  await query('SET search_path TO "'+schema+'",public');
  await query('CREATE TABLE empresas(id uuid PRIMARY KEY,codigo text,activa boolean)');
  await query('CREATE TABLE sucursales(id uuid PRIMARY KEY,empresa_id uuid,nombre text)');
  await query("CREATE TABLE canales(id uuid PRIMARY KEY,empresa_id uuid,sucursal_id uuid,nombre text,tipo text,activo boolean,config jsonb NOT NULL DEFAULT '{}'::jsonb)");
  await reset();await sucursal(S1,'Central');await canal(C1,S1,'principal');
  await query(m16);await query(m17);
  assert.equal(await marcado(C1),true,'016 marks exact principal Central');
  console.log('✓ 016 y 017 funcionan en PostgreSQL con UUID');
  await reset();await sucursal(S1,'Central');await canal(C1,S1,'WhatsApp de atención');
  await query(m16);
  assert.equal(await marcado(C1),false,'016 skips misnamed channel');
  await query(m17);
  assert.equal(await marcado(C1),true,'017 marks the only Central channel');
  console.log('✓ 017 activa la línea única aun sin nombre principal');
  await reset();await sucursal(S1,'Encarnación');await sucursal(S2,'Ciudad del Este');
  await canal(C1,S1,'WhatsApp 1');await canal(C2,S2,'WhatsApp 2');
  await query(m16);await query(m17);
  assert.equal(await marcado(C1),false);
  assert.equal(await marcado(C2),false);
  console.log('✓ Ante dos canales ambiguos no marca ninguno');
  await reset();await sucursal(S1,'Central');await sucursal(S2,'Ciudad del Este');
  await canal(C1,S1,'WhatsApp principal',{principal_global:true});
  await canal(C2,S2,'WhatsApp secundario');
  await query(m16);await query(m17);
  assert.equal(await marcado(C1),true);
  assert.equal(await marcado(C2),false);
  console.log('✓ Preserva la selección del administrador');
}finally{
  await query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
  await client.end();
}
console.log('✔ Migraciones IMPAR 016/017 comprobadas en PostgreSQL real.');
