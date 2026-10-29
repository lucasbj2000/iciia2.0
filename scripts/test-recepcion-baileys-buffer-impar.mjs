/** IMPAR: prueba funcional de captura rápida de mensajes sin sesión WhatsApp real. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const leer=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const ba=leer('src/channels/baileys.mjs'),worker=leer('src/worker.mjs');
assert.ok(ba.includes('sock.ev?.isBuffering?.()')||ba.includes('sock.ev?.isBuffering?.(')||
  ba.includes('sock.ev?.isBuffering?.()')||ba.includes("sock.ev?.isBuffering?.()"),'Vigilancia de buffer');
assert.ok(ba.includes("sock.ev.flush()"),'Liberar eventos bloqueados sin perder sesión');
assert.ok(ba.includes('S.recuperacionesBuffer='),'Contador de rescatador');
assert.ok(ba.includes("!['notify','append'].includes(type)"),'Recibir en vivo y backfill');
assert.ok(ba.includes("const hayMedia=['imageMessage'"),'Reserva de archivos');
assert.ok(ba.includes("hayMedia?'capturando':'pendiente'"),'Media durable antes de descarga');
assert.ok(worker.includes("WHERE estado='capturando' AND ts<now()-interval '20 seconds'"),
  'Rescatar archivo estancado tras reinicio');
const inicio=ba.indexOf('// Máximo 3 descargas en paralelo:');
const fin=ba.indexOf('async function bajarMedia(',inicio);
if(inicio<0||fin<=inicio)throw Error('No se localizó el receptor nuevo');
let codigo=ba.slice(inicio,fin);
// El worker se simula, sin import dinámico o efectos de red.
codigo=codigo.replace(/const despertarWorker=\(\)=>import\('\.\.\/worker\.mjs'\)[\s\S]*?\.catch\(e=>console\.warn\('\[wa:recepcion\] Worker inmediato:',e\.name\)\);/,
  'const despertarWorker=()=>{despertados++};');
if(!codigo.includes('const despertarWorker=()=>{despertados++};'))throw Error('No se simuló el worker');
const filas=[],updates=[],sesiones=new Map([['test',{totalEntradas:0}]]);
const q=async(sql,args)=>{
 if(sql.startsWith('INSERT INTO inbox')){
  const id=filas.length+1;
  filas.push({id,remitente:args[3],txt:args[5],estado:args[8]});
  return {rows:[{id}]};
 }
 updates.push({sql,args});
 return {rows:[]};
};
const context=vm.createContext({q,console,sesiones,Promise,Date,Number,String,JSON,process,emitir:()=>{},
  setTimeout:()=>0,
  parejaDesdeEventoWA:()=>null,registrarParejaWA:async()=>true,
  bajarMedia:async()=>null,despertados:0});
vm.runInContext(codigo+';globalThis.testRecibir=recibir;',context);
const inbound=context.testRecibir;
const canal={id:'test',empresa_id:'empresa-sintetica',nombre:'Canal simulado'};
const mod={normalizeMessageContent:x=>x};
await inbound(mod,{key:{id:'WA-PRUEBA-1',remoteJid:'595981000001@s.whatsapp.net',
 fromMe:false},message:{conversation:'Mensaje del cliente'},messageTimestamp:1800000000},canal,'test');
assert.equal(filas[0].remitente,'595981000001');
assert.equal(filas[0].txt,'Mensaje del cliente');
assert.equal(filas[0].estado,'pendiente');
assert.equal(context.despertados,1);
await inbound(mod,{key:{id:'WA-PRUEBA-2',remoteJid:'123456789123@lid',
 fromMe:false},message:{imageMessage:{mimetype:'image/jpeg'}},messageTimestamp:1800000001},canal,'test');
assert.equal(filas[1].estado,'capturando');
assert.equal(filas[1].remitente,'123456789123@lid');
await Promise.resolve();await Promise.resolve();await Promise.resolve();await new Promise(setImmediate);
assert.ok(updates.some(x=>x.sql.includes("estado='pendiente' WHERE id=$1")),
  'Imagen queda marcada y después el worker la publica');
assert.equal(sesiones.get('test').totalEntradas,2);
assert.ok(!ba.includes('await resolverRemitenteWA(canal,m.key)'),
  'No bloquear mensajes antes del INSERT por consulta PN/LID');
const patch=leer('scripts/patch-baileys-recepcion.mjs');
assert.ok(patch.includes('node.attrs.offline ==='));
assert.ok(patch.includes("offline: attrs.offline === '1'"));
assert.ok(patch.includes('ICIIA_OFFLINE_ZERO_INBOUND'));
assert.ok(!patch.includes('rmSync(')&&!patch.includes('logout()'));
console.log('✔ IMPAR: mensajes y multimedia primero durables, buffer Baileys liberable, sin eliminar auth.');
