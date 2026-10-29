/** IMPAR: pruebas de recuperación original de mensajes WhatsApp (sin conectar teléfono). */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {claveReintento,guardarOriginal,recuperarOriginal} from '../src/wa-reintentos.mjs';
import {crearCacheContadorReintentos} from '../src/wa-cache-reintentos.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ba=source('src/channels/baileys.mjs');
const sql=source('src/migrations/015_wa_mensajes_reintento.sql');
const worker=source('src/worker.mjs');
const tabla=new Map(),consultas=[];
const proto={
  Message:{
    encode:payload=>({finish:()=>Buffer.from(JSON.stringify(payload),'utf8')}),
    decode:bytes=>JSON.parse(Buffer.from(bytes).toString('utf8'))
  }
};
const store=async(sql,args)=>{
  consultas.push({sql,args});
  if(sql.startsWith('INSERT INTO wa_mensajes_reintento')){
    tabla.set([args[1],args[2],args[3]].join('|'),args[4]);return {rows:[],rowCount:1};
  }
  if(sql.startsWith('SELECT contenido FROM')){
    const raw=tabla.get(args.join('|'));
    return {rows:raw?[{contenido:raw}]:[],rowCount:raw?1:0};
  }
  if(sql.startsWith('DELETE FROM'))return {rows:[],rowCount:0};
  throw Error('SQL no esperada: '+sql);
};
const canalId='canal-A',empresaId='IMPAR';
const key={remoteJid:'595981000001@s.whatsapp.net',id:'A1B2C3D4',fromMe:true};
const otroJid={...key,remoteJid:'595981000002@s.whatsapp.net'};
const otroCanal='canal-B';
const sent={key,message:{conversation:'Hola desde IMPAR',extendedTextMessage:{
  text:'Original',contextInfo:{stanzaId:'ref01'}}}};
const cache=new Map();
assert.equal(await guardarOriginal({q:store,proto,canalId,empresaId,enviado:sent,cache}),true);
assert.deepEqual(await recuperarOriginal({q:store,proto,canalId,key,cache}),sent.message,
  'Mismo socket recupera mensaje original con contexto Signal');
// Simula socket y PM2 reiniciados: sin caché, tiene que buscar en DB.
assert.deepEqual(await recuperarOriginal({q:store,proto,canalId,key,cache:new Map()}),sent.message);
assert.equal(await recuperarOriginal({q:store,proto,canalId,key:otroJid,cache:new Map()}),undefined,
  'Jamás devolver el mensaje de otro contacto');
assert.equal(await recuperarOriginal({q:store,proto,canalId:otroCanal,key,cache:new Map()}),undefined,
  'Jamás devolver mensajes de otro canal');
assert.equal(await recuperarOriginal({q:store,proto,canalId,key:{...key,fromMe:false},cache}),undefined);
assert.equal(await recuperarOriginal({q:store,proto,canalId,key:{...key,id:'OTROID99'},cache}),undefined);
assert.equal(claveReintento({id:'',remoteJid:key.remoteJid}),null);
assert.equal(claveReintento({id:key.id,remoteJid:'123@g.us'}),null);
assert.equal(claveReintento({id:key.id,remoteJid:'a@lid'})?.jid,'a@lid');
const qFalla=async()=>{throw Error('base temporalmente no disponible')};
const cacheSinDB=new Map();
assert.equal(await guardarOriginal({q:qFalla,proto,canalId,empresaId,enviado:sent,cache:cacheSinDB}),true,
  'Una falla posterior al envío NO debe forzar reenvío del worker');
assert.deepEqual(await recuperarOriginal({q:qFalla,proto,canalId,key,cache:cacheSinDB}),sent.message,
  'Fallback temporal en memoria');
assert.equal(await recuperarOriginal({q:qFalla,proto,canalId,key,cache:new Map()}),undefined,
  'Falla de DB nunca fabrica mensaje vacío');
const dispositivo={...key,remoteJid:'595981000001:3@s.whatsapp.net'};
assert.equal(claveReintento(dispositivo)?.jid,key.remoteJid,
  'Un dispositivo vinculado debe resolver al mismo contacto');
assert.deepEqual(await recuperarOriginal({q:store,proto,canalId,key:dispositivo,cache:new Map()}),sent.message,
  'Una solicitud desde móvil/PC vinculado puede recuperar el original');
assert.equal(await recuperarOriginal({q:store,proto,canalId,
  key:{...key,remoteJid:'595981000002:3@s.whatsapp.net'},cache:new Map()}),undefined,
  'No mezclar contenido con dispositivos de otro cliente');
const cachereintentos=crearCacheContadorReintentos({max:2});
// Contrato real de 6.7.24: las lecturas NO llevan await.
assert.equal(cachereintentos.get('nuevo'),undefined);
let cuenta=cachereintentos.get('nuevo')||0;
cuenta+=1;
assert.equal(cuenta,1,'El primer reintento debe pedir el original al teléfono');
assert.equal(cachereintentos.set('nuevo',cuenta),true);
assert.equal(cachereintentos.get('nuevo')<5,true,'Permitir recuperación de envío');
assert.equal(cachereintentos.del('nuevo'),1);
let reloj=0;
const temporal=crearCacheContadorReintentos({ahora:()=>reloj,ttlMs:1000});
temporal.set('temporal',2);reloj=1000;
assert.equal(temporal.get('temporal'),undefined,'Expirar contadores');
temporal.set('ttl',3,2);reloj=2999;
assert.equal(temporal.get('ttl'),3);reloj=3000;
assert.equal(temporal.get('ttl'),undefined,'TTL explícito en segundos');
assert.equal(await cachereintentos.get('desconocido'),undefined);
await cachereintentos.set('a',1);await cachereintentos.set('b',2);
assert.equal(await cachereintentos.get('a'),1);
await cachereintentos.set('c',3);
assert.equal(await cachereintentos.get('a'),undefined,'Se debe limitar memoria');
assert.equal(await cachereintentos.get('b'),2);
await cachereintentos.del('b');
assert.equal(await cachereintentos.get('b'),undefined);
await cachereintentos.flushAll();
assert.equal((await cachereintentos.keys()).length,0);
const protoRoto={Message:{encode:()=>{throw Error('mensaje cifrado sin codificador')}}};
assert.equal(await guardarOriginal({q:store,proto:protoRoto,canalId,empresaId,enviado:sent,cache:new Map()}),false,
  'Una falla al codificar después del envío no debe provocar duplicación de salida');
const insert=consultas.find(x=>x.sql.startsWith('INSERT'));
assert.ok(insert.sql.includes('ON CONFLICT(canal_id,jid,mensaje_id)'));
assert.ok(sql.includes('PRIMARY KEY(canal_id, jid, mensaje_id)'));
assert.ok(sql.includes("interval '7 days'"));
assert.ok(!sql.includes('DELETE FROM contactos')&&!sql.includes('UPDATE usuarios'));
assert.ok(ba.includes('getMessage: key => recuperarOriginal('));
assert.ok(ba.includes('msgRetryCounterCache: S.contadorReintentos'),
  'Debe registrar el contador de reintentos para el socket actual');
assert.ok(ba.includes('await guardarOriginal('));
assert.ok(ba.includes('await transmitir(contenido)'));
assert.ok(ba.includes('colaCredenciales=colaCredenciales.catch'));
assert.ok(!/setTimeout\([^)]*sendMessage/.test(ba));
assert.ok(worker.includes("if (o.tipo === 'whatsapp_qr') enviadoWA=await baileys.enviar"),'Envío único con referencia al ACK');
console.log('✔ IMPAR: getMessage usa original persistido sin mezclar contactos ni duplicar mensajes.');
// También se ejecuta desde el actualizador anterior, después de npm ci.
if(existsSync(new URL('../node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js',import.meta.url))){
  await import('./test-baileys-recepcion-instalado.mjs');
}
