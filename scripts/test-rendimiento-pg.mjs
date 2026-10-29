/** IMPAR: consultas y nuevos índices ejecutados contra PostgreSQL real sintético. */
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
if(!process.env.TEST_DATABASE_URL)throw Error('TEST_DATABASE_URL obligatorio (nunca producción).');
const c=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});
const schema='impar_perf_'+randomUUID().replaceAll('-','');
const raw=readFileSync(new URL('../src/routes/negociaciones.mjs',import.meta.url),'utf8');
const match=raw.match(/const SELECT_TABLERO = \`([\s\S]*?)\`;/);
assert.ok(match,'Se necesita el SELECT_TABLERO real');
await c.connect();
try{
 await c.query('CREATE SCHEMA "'+schema+'"');
 await c.query('SET search_path TO "'+schema+'",public');
 await c.query("CREATE TABLE empresas(id UUID PRIMARY KEY,codigo TEXT,activa BOOLEAN);");
 await c.query("CREATE TABLE usuarios(id UUID PRIMARY KEY,empresa_id UUID,usuario TEXT,activo BOOLEAN,rol TEXT,nombre TEXT);");
 await c.query("CREATE TABLE contactos(id UUID PRIMARY KEY,nombre TEXT,tel TEXT,frecuente BOOLEAN);");
 await c.query("CREATE TABLE canales(id UUID PRIMARY KEY,nombre TEXT,tipo TEXT);");
 await c.query("CREATE TABLE negociaciones(id UUID PRIMARY KEY,empresa_id UUID,contacto_id UUID,canal_id UUID,agente_id UUID,"+
   "titulo TEXT,etapa TEXT,origen TEXT,sucursal TEXT,linea TEXT,valor BIGINT,monto_cierre BIGINT,motivo TEXT,"+
   "marcadores JSONB,bot_activo BOOLEAN,aviso_sla BOOLEAN,creado timestamptz,actualizado timestamptz,"+
   "entrada_etapa timestamptz,telefono_destino TEXT);");
 await c.query("CREATE TABLE ubicaciones(id UUID PRIMARY KEY,negociacion_id UUID,empresa_id UUID);");
 const mig=readFileSync(new URL('../src/migrations/024_indices_rendimiento_impar.sql',import.meta.url),'utf8');
 await c.query(mig);await c.query(mig);
 const emp=randomUUID(),contacto=randomUUID(),neg=randomUUID(),user=randomUUID(),canal=randomUUID();
 await c.query("INSERT INTO empresas VALUES($1,'impar',true)",[emp]);
 await c.query("INSERT INTO usuarios VALUES($1,$2,'admin',true,'admin','Administración')",[user,emp]);
 await c.query("INSERT INTO contactos VALUES($1,'Cliente de prueba','595981111111',false)",[contacto]);
 await c.query("INSERT INTO canales VALUES($1,'Central','whatsapp_qr')",[canal]);
 await c.query("INSERT INTO negociaciones VALUES($1,$2,$3,$4,$5,'Prueba','espera','whatsapp','Matriz','Central',0,0,null,'[]',false,false,now(),now(),now(),'595981111111')",
    [neg,emp,contacto,canal,user]);
 const query=match[1]+' WHERE n.empresa_id=$1 ORDER BY n.actualizado DESC';
 let r=await c.query(query,[emp]);
 assert.equal(r.rows.length,1);
 assert.equal(r.rows[0].n_ubicaciones,0);
 assert.equal(r.rows[0].cliente,'Cliente de prueba');
 assert.equal(r.rows[0].bot_activo,false);
 assert.equal(Object.hasOwn(r.rows[0],'bot_recepcion'),false,'Sin JSON pesado por tarjeta');
 await c.query('INSERT INTO ubicaciones VALUES($1,$2,$3)',[randomUUID(),neg,emp]);
 r=await c.query(query,[emp]);assert.equal(r.rows[0].n_ubicaciones,1);
 const auth=await c.query(
  "SELECT u.*,row_to_json(e) AS _empresa FROM usuarios u JOIN empresas e ON e.id=u.empresa_id "+
  "AND e.codigo='impar' AND e.activa WHERE lower(u.usuario)=$1 AND u.activo LIMIT 1",['admin']);
 assert.equal(auth.rows[0]._empresa.id,emp);
 console.log('✔ IMPAR PostgreSQL: índices, login JOIN y tablero ligero ejecutados.');
}finally{
 await c.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
 await c.end();
}
