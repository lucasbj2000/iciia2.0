/** Flujo real con PostgreSQL y datos ficticios en un esquema aislado. No envía mensajes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import pg from 'pg';
import { normalizar, sucursalDe } from '../src/geografia-impar.mjs';

if (!process.env.TEST_DATABASE_URL) throw new Error('Requiere TEST_DATABASE_URL de pruebas. Nunca usar producción.');
const schema='impar_recepcion_'+randomUUID().replaceAll('-','');
const control=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});
const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema},public`});
const q=(...a)=>pool.query(...a);
const tx=async fn=>{
  const c=await pool.connect();
  try { await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r; }
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
};
const fuente=readFileSync(new URL('../src/recepcion-impar.mjs',import.meta.url),'utf8')
  .replace(/^import .*\n/gm,'').replace(/^export /gm,'');
const bot=vm.runInNewContext(fuente+';({responderRecepcionImpar,derivarRecepcionesVencidas})',
  {q,tx,emitir:()=>{},normalizar,sucursalDe,Date});
const EMP=randomUUID(),OTRA=randomUUID(),CANAL=randomUUID(),CDE=randomUUID(),MATRIZ=randomUUID(),CENTRAL=randomUUID();
const A=randomUUID(),B=randomUUID(),M=randomUUID(),ADMIN=randomUUID();
async function alta({elegible=true,responsable=null,agente=null}={}){
  const c=randomUUID(),n=randomUUID();
  await q("INSERT INTO contactos(id,empresa_id,nombre,tel,externos,responsable_id) VALUES($1,$2,'Cliente ficticio','595981000001','{}',$3)",[c,EMP,responsable]);
  await q(`INSERT INTO negociaciones(id,empresa_id,contacto_id,canal_id,agente_id,bot_recepcion)
    VALUES($1,$2,$3,$4,$5,$6)`,[n,EMP,c,CANAL,agente,elegible?{elegible:true,version:2}:{}]);
  await entrada(n,'Hola');
  return n;
}
const entrada=(n,txt)=>q("INSERT INTO mensajes(empresa_id,negociacion_id,dir,txt,bot) VALUES($1,$2,'in',$3,false)",[EMP,n,txt]);
const estado=async n=>(await q(`SELECT n.*,c.responsable_id FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id WHERE n.id=$1`,[n])).rows[0];
const cantidad=async n=>Number((await q('SELECT count(*) AS n FROM outbox WHERE negociacion_id=$1',[n])).rows[0].n);
const responder=n=>bot.responderRecepcionImpar(EMP,n);
await control.connect();
try {
  await control.query('CREATE SCHEMA '+schema);
  await q(`CREATE TABLE empresas(id uuid PRIMARY KEY,codigo text,activa boolean,flags jsonb,bot jsonb);
    CREATE TABLE sucursales(id uuid PRIMARY KEY,empresa_id uuid,nombre text,activa boolean DEFAULT true);
    CREATE TABLE usuarios(id uuid PRIMARY KEY,empresa_id uuid,nombre text,sucursal text,rol text,activo boolean DEFAULT true,oculto boolean DEFAULT false);
    CREATE TABLE contactos(id uuid PRIMARY KEY,empresa_id uuid,nombre text,tel text,externos jsonb,responsable_id uuid,sucursal text);
    CREATE TABLE canales(id uuid PRIMARY KEY,empresa_id uuid,tipo text,activo boolean,bot_activo boolean);
    CREATE TABLE negociaciones(id uuid PRIMARY KEY,empresa_id uuid,contacto_id uuid,canal_id uuid,agente_id uuid,sucursal text,
      etapa text DEFAULT 'nuevo',bot_activo boolean DEFAULT true,bot_recepcion jsonb DEFAULT '{}',creado timestamptz DEFAULT now(),actualizado timestamptz DEFAULT now(),telefono_destino text);
    CREATE TABLE mensajes(id bigserial PRIMARY KEY,empresa_id uuid,negociacion_id uuid,dir text,txt text,bot boolean,estado text,carga_historica boolean NOT NULL DEFAULT false,ts timestamptz DEFAULT now());
    CREATE TABLE outbox(id bigserial PRIMARY KEY,empresa_id uuid,canal_id uuid,negociacion_id uuid,destino text,txt text,automatico boolean,estado text DEFAULT 'pendiente',error text);
    CREATE TABLE historial(id bigserial PRIMARY KEY,empresa_id uuid,negociacion_id uuid,txt text,por text);
    CREATE TABLE notificaciones(id bigserial PRIMARY KEY,empresa_id uuid,usuario_id uuid,tipo text,titulo text,msg text,tono text,ref uuid);`);
  await q("INSERT INTO empresas VALUES($1,'impar',true,'{\"bot\":false}','{\"activo\":false}'),($2,'otra',true,'{\"bot\":false}','{\"activo\":false}')",[EMP,OTRA]);
  const m19=readFileSync(new URL('../src/migrations/019_recepcion_sucursales_impar.sql',import.meta.url),'utf8');
  await tx(db=>db.query(m19));
  await tx(db=>db.query(m19));
  const es=(await q('SELECT * FROM empresas ORDER BY codigo')).rows;
  assert.equal(es.find(e=>e.codigo==='impar').bot.activo,true);
  assert.equal(es.find(e=>e.codigo==='otra').bot.activo,false);
  await q("INSERT INTO sucursales(id,empresa_id,nombre) VALUES($1,$4,'Ciudad del Este'),($2,$4,'Matriz'),($3,$4,'Central')",[CDE,MATRIZ,CENTRAL,EMP]);
  await q("INSERT INTO usuarios(id,empresa_id,nombre,sucursal,rol) VALUES($1,$5,'Ana','Ciudad del Este','agente'),($2,$5,'Beto','Ciudad del Este','agente'),($3,$5,'Marta','Matriz','agente'),($4,$5,'Admin','Central','admin')",[A,B,M,ADMIN,EMP]);
  await q("INSERT INTO canales VALUES($1,$2,'whatsapp_qr',true,true)",[CANAL,EMP]);
  const n=await alta();
  await Promise.all([responder(n),responder(n)]);
  assert.equal(await cantidad(n),1,'Dos workers concurrentes no duplican la bienvenida');
  let e=await estado(n);
  assert.equal(e.agente_id,null);assert.equal(e.responsable_id,null);
  assert.ok(Math.abs(e.recepcion_vence.getTime()-Date.now()-7200000)<5000);
  const bienvenida=(await q('SELECT txt FROM outbox WHERE negociacion_id=$1',[n])).rows[0].txt;
  assert.match(bienvenida,/Papelerías IMPAR/);assert.doesNotMatch(bienvenida,/Central/);
  assert.equal(e.bot_recepcion.opciones.length,2);
  const plazo=e.recepcion_vence.getTime();
  await entrada(n,'Necesito cartulina');await responder(n);
  assert.equal((await estado(n)).recepcion_vence.getTime(),plazo);
  assert.equal(await cantidad(n),1);
  await entrada(n,'CDE');await responder(n);
  e=await estado(n);assert.ok([A,B].includes(e.agente_id));assert.equal(e.responsable_id,e.agente_id);
  assert.equal(e.sucursal,'Ciudad del Este');assert.equal(e.bot_activo,false);assert.equal(e.recepcion_vence,null);
  console.log('✓ SQL real: bienvenida concurrente única, espera de 2 horas y asignación por sucursal');

  const nuevos=await Promise.all([alta(),alta()]);
  for(const id of nuevos){await responder(id);await entrada(id,'Ciudad del Este');}
  await Promise.all(nuevos.map(responder));
  const reparto=await Promise.all(nuevos.map(estado));
  assert.notEqual(reparto[0].agente_id,reparto[1].agente_id,'Reparto equitativo serializado entre clientes');
  console.log('✓ PostgreSQL serializa el reparto equitativo de clientes concurrentes');

  for(const caso of [{elegible:false},{responsable:A},{agente:A}]){
    const id=await alta(caso);await responder(id);assert.equal(await cantidad(id),0);
    const v=await estado(id);assert.equal(v.responsable_id,caso.responsable||null);assert.equal(v.bot_activo,false);
  }
  const manual=await alta();
  await q("INSERT INTO mensajes(empresa_id,negociacion_id,dir,txt,bot) VALUES($1,$2,'out','Atención humana',false)",[EMP,manual]);
  await responder(manual);assert.equal(await cantidad(manual),0);assert.equal((await estado(manual)).bot_activo,false);
  console.log('✓ Fichas previas, responsables existentes e intervención manual no reciben bot');

  const vencido=await alta();await responder(vencido);
  await q("UPDATE negociaciones SET recepcion_vence=now()-interval '1 second' WHERE id=$1",[vencido]);
  await bot.derivarRecepcionesVencidas();
  assert.equal((await estado(vencido)).agente_id,M);
  const pendiente=await alta();await responder(pendiente);
  assert.equal((await estado(pendiente)).agente_id,null);
  await q("UPDATE negociaciones SET recepcion_vence=now()-interval '1 second' WHERE id=$1",[pendiente]);
  await q('UPDATE usuarios SET activo=false WHERE id=$1',[M]);
  await bot.derivarRecepcionesVencidas();assert.equal((await estado(pendiente)).agente_id,null);
  const avisos=Number((await q("SELECT count(*) AS n FROM notificaciones WHERE ref=$1 AND titulo='Recepción pendiente en Matriz'",[pendiente])).rows[0].n);
  assert.equal(avisos,1);
  await bot.derivarRecepcionesVencidas();
  assert.equal(Number((await q("SELECT count(*) AS n FROM notificaciones WHERE ref=$1 AND titulo='Recepción pendiente en Matriz'",[pendiente])).rows[0].n),1);
  await q('UPDATE usuarios SET activo=true WHERE id=$1',[M]);await bot.derivarRecepcionesVencidas();
  assert.equal((await estado(pendiente)).agente_id,M);
  console.log('✓ Vencimiento persistente, Matriz exclusiva, alerta única y reintento al recuperar agentes');
} finally {
  await pool.end();
  await control.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  await control.end();
}
console.log('✔ Recepción IMPAR validada contra PostgreSQL real en esquema aislado.');
