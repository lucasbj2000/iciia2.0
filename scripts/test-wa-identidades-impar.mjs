/** IMPAR · pruebas de enrutamiento PN/LID controlado, sin cuentas reales. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const leer=r=>readFileSync(new URL('../'+r,import.meta.url),'utf8');
const mod=leer('src/wa-identidades-impar.mjs');
const guardado=new Map();
const q=async(sql,args)=>{
  const key=sql.includes('SELECT lid_jid')||sql.includes('SELECT lid_jid,preferir_lid')?
    args[1]+'|'+args[2]:args[1]+'|'+args[2];
  if(sql.startsWith('INSERT INTO wa_identidades_impar')){
    const nuevo={pn:args[2],lid_jid:args[3],preferir_lid:false};
    const ant=guardado.get(key);
    nuevo.preferir_lid=Boolean(ant?.preferir_lid&&ant.lid_jid===nuevo.lid_jid);
    guardado.set(key,nuevo);
    return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('SELECT lid_jid')){
    const dato=guardado.get(key);
    return {rows:dato?[dato]:[]};
  }
  if(sql.startsWith('UPDATE wa_identidades_impar')){
    const dato=guardado.get(key);
    if(!dato)return {rowCount:0,rows:[]};
    dato.preferir_lid=args[3];return {rowCount:1,rows:[]};
  }
  throw Error('SQL no contemplada '+sql);
};
const context=vm.createContext({q,console,String,Boolean,Number,Date});
const clean=mod.replace(/^import .*;$/gm,'').replace(/\bexport (const|async function|function)/g,'$1');
vm.runInContext(clean+'\nglobalThis.metodos={parejaDesdeEventoWA,validarParejaWA,telefonoAStringJid,registrarParejaWA,rutaParaEnvioWA,estadoRutaWA,elegirRutaWA};',context);
const {
 parejaDesdeEventoWA,validarParejaWA,telefonoAStringJid,registrarParejaWA,
 rutaParaEnvioWA,estadoRutaWA,elegirRutaWA
}=context.metodos;
const pn='595981000001@s.whatsapp.net',lid='123456789012345@lid';
assert.equal(telefonoAStringJid('0981000001'),pn,'Normalizar Paraguay');
assert.equal(telefonoAStringJid('595981000001'),pn,'Código internacional');
assert.equal(validarParejaWA(pn,lid)?.lid,lid);
assert.equal(parejaDesdeEventoWA({remoteJid:'123456789012345@lid',
 senderPn:'595981000001@s.whatsapp.net'})?.pn,pn,'Solo pareja real');
assert.equal(parejaDesdeEventoWA({remoteJid:pn,senderLid:lid})?.lid,lid);
assert.equal(parejaDesdeEventoWA({remoteJid:pn,senderPn:'otro@s.whatsapp.net'}),null);
assert.equal(parejaDesdeEventoWA({remoteJid:'malicioso@evil.com',senderPn:pn}),null);
const canal={id:'canal-A',empresa_id:'impar'};
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,pn,'PN por defecto');
assert.equal(await registrarParejaWA(canal,{pn,lid}),true);
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,pn,'Aun con mapa, no cambiar sin administrador');
assert.equal((await estadoRutaWA('impar','canal-A',pn)).alternativa,true);
assert.equal(await elegirRutaWA('impar','canal-A',pn,true),true);
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,lid,'Ruteo LID tras opt in');
assert.equal((await rutaParaEnvioWA({id:'canal-B',empresa_id:'impar'},pn)).destino,pn,'No mezclar canales');
assert.equal((await rutaParaEnvioWA({id:'canal-A',empresa_id:'otra'},pn)).destino,pn,'No mezclar empresas');
assert.equal(await registrarParejaWA(canal,{pn,lid:'99999999999999@lid'}),true);
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,pn,'Identidad cambiada desactiva prueba');
assert.equal(await elegirRutaWA('impar','canal-A',pn,false),true);
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,pn);
const ba=leer('src/channels/baileys.mjs');
const routes=leer('src/routes/negociaciones.mjs');
const ui=leer('public/js/ficha.js');
assert.ok(ba.includes("sock.ev.on('chats.phoneNumberShare'"),'Evento nativo de pares');
assert.ok(ba.includes('parejaDesdeEventoWA(m.key)'), 'Confirmación desde mensajes entrantes');
assert.ok(ba.includes('jid=(await rutaParaEnvioWA(canal,jid)).destino'),'Enrutamiento real en enviar');
assert.ok(!ba.includes('await sock.logout()'),'Nunca desvincular automáticamente');
assert.ok(routes.includes("r.patch('/:id/ruta-whatsapp', requiere('admin')"),'Solo admin');
assert.ok(ui.includes("Probar ruta LID verificada"),'Botón del chat');
assert.ok(ui.includes('Restaurar ruta normal'),'Reversible');
assert.ok(!ui.includes('autoReenviarWA'),'Sin reenvíos automáticos');
const mig=leer('src/migrations/021_wa_identidades_impar.sql');
assert.ok(mig.includes('preferir_lid BOOLEAN NOT NULL DEFAULT FALSE'),'Ruta por defecto PN');
console.log('✔ IMPAR: PN por defecto, mapeo solo WhatsApp, LID opt-in, aislamiento, retorno seguro.');
