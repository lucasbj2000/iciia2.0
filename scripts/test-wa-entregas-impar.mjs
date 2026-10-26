/** IMPAR · ACKs con eventos simulados, sin WhatsApp ni datos de clientes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const leer=r=>readFileSync(new URL('../'+r,import.meta.url),'utf8');
const entregas=leer('src/wa-entregas-impar.mjs');
const cambios=[],eventos=[],tabla=new Map();
const q=async(sql,args)=>{
  if(sql.includes('INSERT INTO wa_entregas_impar')){
    const id=args[0]+'|'+args[2],prev=tabla.get(id)||{ack:0};
    if(args.length===6){
      tabla.set(id,{...prev,ack:Math.max(prev.ack,args[4]),outbox_id:args[3],jid_tipo:args[5]});
    }else{
      tabla.set(id,{...prev,ack:Math.max(prev.ack,args[3]),jid_tipo:args[4]});
    }
    cambios.push({sql,args});
    return {rows:[{outbox_id:tabla.get(id).outbox_id||null}]};
  }
  if(sql.includes('SELECT negociacion_id FROM outbox'))return {rows:[{negociacion_id:'neg-falsa'}]};
  throw new Error('Consulta SQL inesperada: '+sql);
};
const context=vm.createContext({q,emitir:(...args)=>eventos.push(args),console,Number,String,Date,Promise});
const source=entregas.replace(/^import .*;$/gm,'').replace(/\bexport (const|async function)/g,'$1');
vm.runInContext(source+'\nglobalThis.apis={interpretarAck,tipoJid,registrarEnvioImpar,registrarActualizacionImpar};',context);
const {interpretarAck,tipoJid,registrarEnvioImpar,registrarActualizacionImpar}=context.apis;
assert.equal(interpretarAck(2),2);
assert.equal(interpretarAck(3),3);
assert.equal(interpretarAck(4),4);
assert.equal(interpretarAck(undefined),null);
assert.equal(interpretarAck('hola'),null);
assert.equal(tipoJid('usuario@lid'),'lid');
assert.equal(tipoJid('usuario@s.whatsapp.net'),'pn');
const canal={id:'canal-prueba',empresa_id:'empresa-prueba'};
const key={id:'A1B2C3D4',fromMe:true,remoteJid:'0000@s.whatsapp.net'};
assert.equal(await registrarActualizacionImpar(canal,{key,update:{status:3}}),true,'ACK antes de enviar');
assert.equal(await registrarEnvioImpar(canal,{key,status:1},{outboxId:8,destino:key.remoteJid}),true);
assert.equal(tabla.get(canal.id+'|'+key.id).ack,3,'Nunca regresar estado de entregado a enviado');
assert.equal(tabla.get(canal.id+'|'+key.id).outbox_id,8,'Vincular mensaje con outbox');
await registrarActualizacionImpar(canal,{key,update:{status:4}});
assert.equal(tabla.get(canal.id+'|'+key.id).ack,4,'ACK de lectura');
assert.equal(eventos.at(-1)[1],'neg:patch','Refrescar solamente la negociación');
const antes=cambios.length;
assert.equal(await registrarActualizacionImpar(canal,{key:{...key,fromMe:false},update:{status:4}}),false,
  'Nunca procesar actualización ajena como entrega nuestra');
assert.equal(await registrarActualizacionImpar(canal,{key,update:{status:undefined}}),false);
assert.equal(cambios.length,antes);
const ba=leer('src/channels/baileys.mjs'),worker=leer('src/worker.mjs');
const historico=leer('src/historial-contacto-impar.mjs'),ficha=leer('public/js/ficha.js');
const ruta=leer('src/routes/negociaciones.mjs'),sql=leer('src/migrations/020_wa_entregas_impar.sql');
assert.ok(ba.includes("sock.ev.on('messages.update'"),'ACKs desde Baileys');
assert.ok(ba.includes('registrarActualizacionImpar(canal,cambio)'),'No reconectar sockets');
assert.ok(ba.includes('return transmitir({ text: texto })'),'Retornar el WA ID, no un booleano');
assert.ok(worker.includes('enviadoWA=await baileys.enviar'),'Capturar mensaje enviado');
assert.ok(worker.includes('await registrarEnvioImpar'),'Persistir ID de mensaje');
assert.ok(worker.includes(".catch(e=>console.warn('[wa:entregas]"),'No duplicar envío ante error de auditoría');
assert.ok(ruta.includes('media_nombre,mensaje_id'),'Correlación exacta outbox con mensaje interno');
assert.ok(historico.includes('we.ack AS wa_ack'),'Mostrar estado real');
assert.ok(ficha.includes('✓ Enviado, entrega no confirmada'),'No declarar entrega sin ACK');
assert.ok(ficha.includes('window.open(link'),'WhatsApp oficial manual');
assert.ok(ficha.includes("https://wa.me/"),'Enlace seguro a WhatsApp');
assert.ok(sql.includes('CREATE UNIQUE INDEX'),'No duplicar salida asociada a mensaje');
console.log('✔ IMPAR: ACK simulado 1→3→4, evento temprano, sin retroceso ni duplicación, enlace manual.');
