/** Datos ficticios: ejecuta el flujo real de recepción sin enviar mensajes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizar, sucursalDe } from '../src/geografia-impar.mjs';

const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const fuente=leer('src/recepcion-impar.mjs').replace(/^import .*\n/gm,'').replace(/^export /gm,'');
const sucursales=[{id:'cde',nombre:'Ciudad del Este'},{id:'matriz',nombre:'Matriz'},{id:'central',nombre:'Central'}];
function escenario(cambios={}) {
  const n={id:'neg',empresa_id:'impar',contacto_id:'contacto',cliente:'Cliente de prueba',tel:'595981000001',
    canal_id:'canal',canal_activo:true,canal_tipo:'whatsapp_qr',canal_bot:true,codigo:'impar',
    empresa_bot:{activo:true},flags:{bot:true},bot_activo:true,etapa:'nuevo',
    bot_recepcion:{elegible:true,version:2},agente_id:null,responsable_id:null,recepcion_vence:null,...cambios};
  const consultas=[],mensajes=[],eventos=[];
  const entorno={n,opciones:[...sucursales],humano:false,hist:[{id:1,dir:'in',txt:'Hola'}],agente:true};
  const query=async(sql,p=[])=>{
    consultas.push({sql,p});
    if(sql.startsWith('SELECT n.*,c.nombre'))return {rows:[structuredClone(n)]};
    if(sql.startsWith('SELECT 1 FROM mensajes'))return {rows:entorno.humano?[{}]:[]};
    if(sql.startsWith('SELECT s.id,s.nombre'))return {rows:entorno.opciones};
    if(sql.startsWith('SELECT id,dir,txt,bot'))return {rows:entorno.hist};
    if(sql.startsWith('SELECT u.id,u.nombre')){
      const s=entorno.opciones.find(s=>s.id===p[1]);
      return {rows:entorno.agente&&s?[{id:'agente-'+s.id,nombre:'Asesor de prueba',sucursal:s.nombre}]:[]};
    }
    if(sql.startsWith('SELECT n.id,n.empresa_id'))return {rows:n.recepcion_vence&&n.bot_activo?[{id:n.id,empresa_id:n.empresa_id}]:[]};
    if(sql.startsWith('UPDATE contactos SET responsable_id')){n.responsable_id=p[2];n.sucursal=p[3];}
    if(sql.startsWith('UPDATE negociaciones SET agente_id')){
      n.agente_id=p[2];n.sucursal=p[3];n.bot_activo=false;n.recepcion_vence=null;n.bot_recepcion=JSON.parse(p[4]);
    }
    if(sql.startsWith('UPDATE negociaciones SET bot_recepcion')){
      n.bot_recepcion=JSON.parse(p[2]);
      if(sql.includes("interval '2 hours'"))n.recepcion_vence=new Date(Date.now()+7200000);
    }
    if(sql.startsWith('UPDATE negociaciones SET bot_activo=FALSE')){n.bot_activo=false;n.recepcion_vence=null;}
    if(sql.startsWith('INSERT INTO outbox'))mensajes.push(p[4]);
    return {rows:[],rowCount:1};
  };
  const f=vm.runInNewContext(fuente+';({responderRecepcionImpar,derivarRecepcionesVencidas,elegirSucursal})',
    {q:query,tx:fn=>fn({query}),emitir:(...a)=>eventos.push(a),normalizar,sucursalDe,Date});
  return {...entorno,entorno,n,f,consultas,mensajes,eventos,responder:()=>f.responderRecepcionImpar('impar','neg')};
}
// El orden comercial debe permanecer estable aun cuando SQL lo devuelva alfabético.
const completo=escenario();
completo.entorno.opciones=[
  {id:'cde',nombre:'Ciudad del Este'},{id:'enc',nombre:'Encarnación'},
  {id:'pjc',nombre:'Pedro Juan Caballero'},{id:'fm',nombre:'Fernando de la Mora'},
  {id:'lam',nombre:'Lambaré'},{id:'matriz',nombre:'Matriz'},
  {id:'central',nombre:'Central'}];
await completo.responder();
const menuDeseado=['1 - Matriz - Asunción','2 - Lambaré','3 - Fernando de la Mora',
 '4 - Ciudad del Este','5 - Encarnación','6 - Pedro Juan Caballero'].join('\n');
assert.ok(completo.mensajes[0].includes(menuDeseado), 'Menú exactamente en el orden comercial');
assert.doesNotMatch(completo.mensajes[0],/7 - Central/);
assert.deepEqual(Array.from(completo.n.bot_recepcion.opciones,s=>s.id),
 ['matriz','lam','fm','cde','enc','pjc'], 'Índices deben coincidir con asignación');
completo.entorno.hist=[{id:2,dir:'in',txt:'3'}];
await completo.responder();
assert.equal(completo.n.agente_id,'agente-fm', 'Selección numérica 3 dirige a Fernando');
const menuAnterior=escenario({bot_recepcion:{elegible:true,version:2,fase:'sucursal',
 opciones:[{id:'cde',nombre:'Ciudad del Este'},{id:'matriz',nombre:'Matriz'}],ultimo:1},
 recepcion_vence:new Date(Date.now()+60000)});
menuAnterior.entorno.hist=[{id:2,dir:'in',txt:'1'}];
await menuAnterior.responder();
assert.equal(menuAnterior.n.agente_id,'agente-cde','Menú ya enviado conserva índices originales');

const nuevo=escenario();
await nuevo.responder();
assert.equal(nuevo.mensajes.length,1);
assert.match(nuevo.mensajes[0],/bienvenida a Papelerías IMPAR/);
assert.match(nuevo.mensajes[0],/1 - Matriz - Asunción\n2 - Ciudad del Este/);
assert.doesNotMatch(nuevo.mensajes[0],/Central|ciudad vivís|llamás/);
assert.equal(nuevo.n.agente_id,null);
assert.equal(nuevo.n.responsable_id,null);
assert.ok(Math.abs(new Date(nuevo.n.recepcion_vence).getTime()-Date.now()-7200000)<1000);
const plazo=nuevo.n.recepcion_vence;
await nuevo.responder();
assert.equal(nuevo.mensajes.length,1,'No saluda dos veces al procesar el mismo mensaje');
nuevo.entorno.hist=[{id:3,dir:'in',txt:'Necesito papel'}];
await nuevo.responder();
assert.equal(nuevo.n.recepcion_vence,plazo,'Un mensaje sin selección no reinicia las 2 horas');
assert.equal(nuevo.n.agente_id,null);
assert.equal(nuevo.mensajes.length,1,'No molesta repitiendo el menú');
nuevo.entorno.hist=[{id:4,dir:'in',txt:'2'}];
await nuevo.responder();
assert.equal(nuevo.n.agente_id,'agente-cde');
assert.equal(nuevo.n.responsable_id,'agente-cde');
assert.equal(nuevo.n.sucursal,'Ciudad del Este');
assert.equal(nuevo.n.bot_activo,false);
assert.equal(nuevo.n.recepcion_vence,null);
assert.ok(nuevo.consultas.some(x=>x.sql.includes('pg_advisory_xact_lock')));
assert.ok(nuevo.consultas.some(x=>x.sql.includes('s.id=$2')&&x.sql.includes('ORDER BY carga')));
console.log('✓ Bienvenida única, menú sin Central, espera sin responsable y selección por número');

for(const texto of ['CDE','Quiero hablar con Ciudad del Este','ciudad del éste']){
  assert.equal(nuevo.f.elegirSucursal(texto,sucursales).id,'cde');
}
assert.equal(nuevo.f.elegirSucursal('Matriz',sucursales).id,'matriz');
for(const texto of ['Central','casa central','CDE o Matriz','0','99'])assert.equal(nuevo.f.elegirSucursal(texto,sucursales),null);
console.log('✓ Selección por nombre y alias; entradas ambiguas o Central no asignan');

for(const cambios of [{bot_recepcion:{}},{responsable_id:'existente'},{agente_id:'existente'},
  {bot_recepcion:{elegible:true,version:2,fase:'finalizado'}}]){
  const e=escenario(cambios);await e.responder();
  assert.equal(e.mensajes.length,0);assert.equal(e.n.bot_activo,false);
  assert.ok(!e.consultas.some(x=>x.sql.startsWith('UPDATE contactos')),'Nunca limpia ni cambia el responsable existente');
}
const manual=escenario();manual.entorno.humano=true;await manual.responder();
assert.equal(manual.mensajes.length,0);assert.equal(manual.n.bot_activo,false);
for(const cambios of [{flags:{bot:false}},{empresa_bot:{activo:false}},{canal_bot:false},{bot_activo:false},
  {empresa_bot:{activo:true,recepcionImpar:false}},{etapa:'cerrado'},{canal_activo:false}]){
  const e=escenario(cambios);await e.responder();assert.equal(e.mensajes.length,0);assert.equal(e.n.agente_id,null);
}
console.log('✓ Clientes previos, asignados, intervención humana, pausas y canales inactivos protegidos');

const vencido=()=>escenario({recepcion_vence:new Date(Date.now()-1000),
  bot_recepcion:{elegible:true,version:2,fase:'sucursal',opciones:sucursales,ultimo:1}});
const espera=escenario({recepcion_vence:new Date(Date.now()+60000),bot_recepcion:{elegible:true,version:2,fase:'sucursal',ultimo:1}});
await espera.f.derivarRecepcionesVencidas();assert.equal(espera.n.agente_id,null);
const recuperada=vencido();await recuperada.f.derivarRecepcionesVencidas();
assert.equal(recuperada.n.agente_id,'agente-matriz');assert.equal(recuperada.n.bot_activo,false);
assert.equal(recuperada.mensajes.length,0,'El vencimiento deriva en silencio');
console.log('✓ Antes de 2 horas no asigna; vencida deriva a Matriz sin nuevo mensaje ni temporizador en memoria');
const oportuna=vencido();
oportuna.entorno.hist=[{id:2,dir:'in',txt:'CDE',ts:new Date(Date.now()-2000)}];
await oportuna.f.derivarRecepcionesVencidas();assert.equal(oportuna.n.agente_id,'agente-cde');
const tardia=vencido();
tardia.entorno.hist=[{id:2,dir:'in',txt:'CDE',ts:new Date()}];
await tardia.f.derivarRecepcionesVencidas();assert.equal(tardia.n.agente_id,'agente-matriz');
console.log('✓ Respeta la hora de recepción de la elección cuando el worker procesa después del vencimiento');
const sinMatriz=vencido();sinMatriz.entorno.opciones=sucursales.filter(s=>s.id!=='matriz');
await sinMatriz.f.derivarRecepcionesVencidas();
assert.equal(sinMatriz.n.agente_id,null);assert.equal(sinMatriz.mensajes.length,0);
assert.ok(sinMatriz.n.bot_recepcion.avisoMatriz);
await sinMatriz.f.derivarRecepcionesVencidas();
assert.equal(sinMatriz.consultas.filter(x=>x.sql.startsWith('INSERT INTO historial')).length,1,'Alerta una vez');
sinMatriz.entorno.opciones=sucursales;
await sinMatriz.f.derivarRecepcionesVencidas();assert.equal(sinMatriz.n.agente_id,'agente-matriz');
const deshabilitada=escenario();await deshabilitada.responder();
deshabilitada.entorno.opciones=sucursales.filter(s=>s.id!=='cde');
deshabilitada.entorno.hist=[{id:2,dir:'in',txt:'2'}];await deshabilitada.responder();
assert.equal(deshabilitada.n.agente_id,null,'No cambia el significado de un número si se desactiva una sucursal');
console.log('✓ Sin Matriz alerta y reintenta; menú estable ante sucursales deshabilitadas');

// Ejecutar también la ingesta real para proteger la condición de alta nueva.
const core=leer('src/core.mjs');
const ingesta=core.slice(core.indexOf('export async function ingresarMensaje'),core.indexOf('\nasync function guardarUbicacion'))
  .replace('export ','');
async function ingresar({previo=false,responsable=null,concurrente=false,pausado=false}={}){
  const consultas=[];
  const contacto={id:'contacto',nombre:'Cliente',tel:'595981000001',externos:{whatsapp:'595981000001'},responsable_id:responsable};
  const empresa={id:'impar',codigo:'impar',flags:{bot:!pausado},bot:{activo:!pausado}};
  const query=async(sql,p)=>{
    consultas.push({sql,p});
    if(sql.startsWith('SELECT id,sucursal FROM usuarios'))return {rows:responsable?[{id:responsable}]:[]};
    if(sql.startsWith('SELECT sucursal FROM usuarios'))return {rows:[{sucursal:'Matriz'}]};
    if(sql.includes('INSERT INTO negociaciones'))return {rows:[{id:'neg'}]};
    return {rows:[],rowCount:1};
  };
  const fn=vm.runInNewContext(ingesta+';ingresarMensaje',{q:query,Date,
    buscarContacto:async()=>previo?contacto:null,
    crearContacto:async()=>({contacto,creado:!concurrente}),etiquetaAnonima:()=> 'Cliente',
    responsableUltimoCierre:async()=>null,asignarEquitativo:async()=> 'reparto',
    historial:async()=>{},notificar:async()=>{},emitir:()=>{},programarBot:()=>{}});
  await fn(empresa,{origen:'whatsapp',remitente:contacto.tel,texto:'Hola'});
  return consultas.find(x=>x.sql.includes('INSERT INTO negociaciones')).p;
}
const alta=await ingresar();assert.equal(alta[4],null);assert.equal(alta[8],true);assert.equal(JSON.parse(alta[11]).elegible,true);
for(const caso of [{previo:true},{previo:true,responsable:'dueno'},{concurrente:true},{pausado:true}]){
  const p=await ingresar(caso);assert.equal(p[8],false);assert.deepEqual(JSON.parse(p[11]),{});
  if(caso.responsable)assert.equal(p[4],caso.responsable);
}
console.log('✓ Ingesta real: solo altas nuevas elegibles; fichas previas, responsable previo y duplicado concurrente excluidos');
// Ejecutar el worker real: revalidar al enviar evita saludos tras una intervención manual.
const worker=leer('src/worker.mjs').replace(/^import .*\n/gm,'').replace(/^export /gm,'');
async function enviar({automatico=true,permitido=true,cambios={}}={}){
  let enviados=0,cancelados=0;
  const query=async(sql)=>{
    if(sql.includes('SELECT o.*'))return {rows:[{id:1,empresa_id:'impar',negociacion_id:'neg',canal_id:'canal',
      tipo:'whatsapp_qr',automatico,txt:'Bienvenida',intentos:0}]};
    if(sql.includes("SELECT flags->>'bot'"))return {rows:[{permitido:String(permitido),activo:String(permitido)}]};
    if(sql.includes('SELECT n.bot_activo,n.agente_id'))return {rows:[{codigo:'impar',bot_activo:true,
      canal_activo:true,canal_bot:true,bot_recepcion:{elegible:true,version:2},...cambios}]};
    if(sql.includes("UPDATE outbox SET estado='cancelado'"))cancelados++;
    return {rows:[]};
  };
  const fn=vm.runInNewContext(worker+';drenarOutbox',{q:query,emitir:()=>{},console,
    baileys:{enviar:async()=>enviados++},meta:{}});
  await fn();return {enviados,cancelados};
}
assert.equal((await enviar()).enviados,1);
for(const cambios of [{bot_recepcion:{}},{agente_id:'asesor'},{responsable_id:'asesor'},{atendida:true},
  {bot_activo:false},{canal_activo:false},{canal_bot:false}]){
  const r=await enviar({cambios});assert.equal(r.enviados,0);assert.equal(r.cancelados,1);
}
assert.equal((await enviar({permitido:false})).enviados,0);
assert.equal((await enviar({automatico:false,permitido:false,cambios:{atendida:true}})).enviados,1);
console.log('✓ Worker real: cancela saludos no elegibles al enviar y mantiene intactos los mensajes manuales');
console.log('✔ Recepción IMPAR por sucursal y plazo de 2 horas comprobados.');
