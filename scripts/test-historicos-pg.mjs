/** IMPAR: migración 023 y orden histórico en PostgreSQL real, sólo datos sintéticos. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(!process.env.TEST_DATABASE_URL)throw Error('TEST_DATABASE_URL requerido; no ejecutar en producción.');
const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});
const schema='impar_hist_'+randomUUID().replaceAll('-','');
await client.connect();
try{
  await client.query('CREATE SCHEMA "'+schema+'"');
  await client.query('SET search_path TO "'+schema+'",public');
  await client.query('CREATE TABLE usuarios(id uuid PRIMARY KEY)');
  await client.query('CREATE TABLE mensajes('+
    'id bigserial PRIMARY KEY, empresa_id uuid NOT NULL, negociacion_id uuid NOT NULL,'+
    "dir text NOT NULL,txt text NOT NULL DEFAULT '',ts timestamptz NOT NULL DEFAULT now())");
  await client.query(readFileSync(new URL('../src/migrations/023_carga_historica_mensajes.sql',import.meta.url),'utf8'));
  await client.query(readFileSync(new URL('../src/migrations/023_carga_historica_mensajes.sql',import.meta.url),'utf8'));
  const admin=randomUUID(),neg=randomUUID(),empresa=randomUUID();
  await client.query('INSERT INTO usuarios(id) VALUES($1)',[admin]);
  const p={emp:empresa,neg,admin};
  for(const [ms,txt] of [['2026-10-19T15:00:00.123456Z','antes'],['2026-10-19T15:00:00.123458Z','despues']]){
    await client.query("INSERT INTO mensajes(empresa_id,negociacion_id,dir,txt,ts) VALUES($1,$2,'in',$3,$4)",
      [empresa,neg,txt,ms]);
  }
  await client.query("INSERT INTO mensajes(empresa_id,negociacion_id,dir,txt,ts,carga_historica,carga_por,carga_registrada) "+
    "VALUES($1,$2,'out','medio','2026-10-19T15:00:00.123457Z',TRUE,$3,now())",
    [empresa,neg,admin]);
  const {rows}=await client.query('SELECT txt,carga_historica,carga_por,carga_registrada,'+
    'to_char(ts AT TIME ZONE \'UTC\',\'HH24:MI:SS.US\') AS preciso FROM mensajes ORDER BY ts,id');
  assert.deepEqual(rows.map(r=>r.txt),['antes','medio','despues']);
  assert.equal(rows[0].carga_historica,false);
  assert.equal(rows[1].carga_historica,true);
  assert.equal(rows[1].carga_por,admin);
  assert.ok(rows[1].preciso.endsWith('.123457'));
  assert.equal(rows[2].carga_registrada,null);
  console.log('✔ IMPAR PostgreSQL: migración idempotente, cronología microsegundos y auditoría.');
}finally{
  await client.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
  await client.end();
}
