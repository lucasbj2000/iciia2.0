/** Ejecuta funciones del Baileys instalado con transporte simulado, sin cuenta real. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {crearCacheContadorReintentos} from '../src/wa-cache-reintentos.mjs';
import {parchearRecepcion} from './patch-baileys-recepcion.mjs';

const archivo=process.env.IMPAR_TEST_BAILEYS_SOURCE ||
  new URL('../node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js',import.meta.url);
const original=readFileSync(archivo,'utf8');
const src=parchearRecepcion(original);
assert.equal(parchearRecepcion(src),src,'Parche idempotente');
assert.throws(()=>parchearRecepcion('version incompatible'),'Rechazar cambios desconocidos');
function extraer(desde,hasta){
 const ini=src.indexOf(desde),fin=src.indexOf(hasta,ini+desde.length);
 assert.ok(ini>=0 && fin>ini,`No se encontró ${desde} en Baileys instalado`);
 return src.slice(ini,fin);
}

const solicitudes=[],recibos=[],errores=[],entregados=[],eventos=[];
const cache=crearCacheContadorReintentos();
const logger={debug(){},info(){}};
const ctx=vm.createContext({Buffer,Map,Error,logger,msgRetryCache:cache,maxMsgRetryCount:5,
 decodeMessageNode:node=>({fullMessage:{key:{id:node.attrs.id,remoteJid:node.attrs.from}}}),
 authState:{creds:{me:{id:'prueba@s.whatsapp.net'},registrationId:1,
   signedIdentityKey:{public:Buffer.from([1])}},keys:{transaction:fn=>fn()}},
 requestPlaceholderResend:async key=>{solicitudes.push(key.id);return 'prueba';},
 encodeSignedDeviceIdentity:()=>Buffer.alloc(0),encodeBigEndian:()=>Buffer.alloc(0),
 getNextPreKeys:async()=>({update:{},preKeys:{1:{}}}),
 xmppPreKey:()=>({tag:'key'}),xmppSignedPreKey:()=>({tag:'skey'}),KEY_BUNDLE_TYPE:[5],
 ev:{emit:(...args)=>eventos.push(args)},sendNode:async r=>recibos.push(r),
 ws:{isOpen:true},
 handleMessage:async node=>{if(node.falla)throw Error('Fallo simulado');entregados.push(node.id);},
 handleNotification:async()=>{throw Error('Notificación inválida simulada');},
 handleCall:async()=>{},handleReceipt:async()=>{},
 onUnexpectedError:(error,etapa)=>errores.push(etapa)
});
vm.runInContext(extraer('const sendRetryRequest =','const handleEncryptNotification =')+
 extraer('const willSendMessageAgain =','const sendMessagesAgain =')+
 extraer('const makeOfflineNodeProcessor =','const offlineNodeProcessor =')+
 ';globalThis.api={sendRetryRequest,willSendMessageAgain,updateSendMessageAgainCount,makeOfflineNodeProcessor};',ctx);
const {api}=ctx;
const nodo={attrs:{id:'prueba-1',from:'prueba@s.whatsapp.net',t:'1800000000'}};
await api.sendRetryRequest(nodo);
assert.equal(solicitudes.length,1,'Pedir original al teléfono en primer fallo');
assert.equal(recibos[0].content[0].attrs.count,'1','Enviar contador numérico válido');
await api.sendRetryRequest(nodo);
assert.equal(recibos[1].content[0].attrs.count,'2');
assert.ok(recibos[1].content.some(x=>x.tag==='keys'),'Segundo reintento incluye claves de recuperación');
assert.equal(solicitudes.length,1,'No repetir solicitud inicial innecesariamente');
assert.equal(api.willSendMessageAgain('salida','p'),true);
for(let i=0;i<5;i++)api.updateSendMessageAgainCount('salida','p');
assert.equal(api.willSendMessageAgain('salida','p'),false,'Respetar límite de reenvíos');
cache.set('prueba-1:undefined',5);
await api.sendRetryRequest(nodo);
assert.equal(recibos.length,2,'No generar reintentos ilimitados');

const cola=api.makeOfflineNodeProcessor();
cola.enqueue('notification',{id:'falla-notificacion'});
cola.enqueue('message',{id:'cliente-1'});
cola.enqueue('message',{id:'cliente-2',falla:true});
cola.enqueue('message',{id:'cliente-3'});
await new Promise(setImmediate);
assert.deepEqual(entregados,['cliente-1','cliente-3'],'Un error no bloquea los clientes siguientes');
assert.equal(errores.length,2);
assert.equal(eventos.filter(x=>x[0]==='impar.recepcion.error').length,2);
cola.enqueue('message',{id:'cliente-4'});
await new Promise(setImmediate);
assert.deepEqual(entregados,['cliente-1','cliente-3','cliente-4'],'La cola admite nuevas respuestas');
ctx.ws.isOpen=false;cola.enqueue('message',{id:'espera'});
await new Promise(setImmediate);
assert.equal(entregados.length,3,'No procesar con conexión cerrada');
ctx.ws.isOpen=true;cola.enqueue('message',{id:'tras-apertura'});
await new Promise(setImmediate);
assert.deepEqual(entregados.slice(-2),['espera','tras-apertura']);
console.log('✔ Baileys instalado: recuperación numérica, original al teléfono y cola continúa tras errores.');
