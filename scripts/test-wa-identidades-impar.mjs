/** IMPAR · pruebas de enrutamiento PN/LID automático y controlado, sin cuentas reales. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const leer=r=>readFileSync(new URL('../'+r,import.meta.url),'utf8');
const mod=leer('src/wa-identidades-impar.mjs');
const guardado=new Map();
const q=async(sql,args)=>{
  const key=args[0]+'|'+args[1]+'|'+args[2];
  if(sql.startsWith('INSERT INTO wa_identidades_impar')){
    const ant=guardado.get(key), misma=ant?.lid_jid===args[3];
    const nuevo={pn:args[2],lid_jid:args[3],preferir_lid:Boolean(ant?.preferir_lid&&misma),
      ruta:misma?ant.ruta:'auto',modo_entrante:args[5]||ant?.modo_entrante||null,
      fallos_pn:misma?ant.fallos_pn:0,fallos_lid:misma?ant.fallos_lid:0,fallo_ts:misma?ant.fallo_ts:null};
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
    dato.ruta=args[3];dato.preferir_lid=args[3]==='lid';
    if(args[3]==='auto'){dato.fallos_pn=0;dato.fallos_lid=0;}
    return {rowCount:1,rows:[]};
  }
  throw Error('SQL no contemplada '+sql);
};
const context=vm.createContext({q,console,String,Boolean,Number,Date});
const clean=mod.replace(/^import .*;$/gm,'').replace(/\bexport (const|async function|function)/g,'$1');
vm.runInContext(clean+'\nglobalThis.metodos={parejaDesdeEventoWA,validarParejaWA,telefonoAStringJid,registrarParejaWA,rutaParaEnvioWA,estadoRutaWA,elegirRutaWA,decidirRutaWA,modoDesdeEventoWA};',context);
const {
 parejaDesdeEventoWA,validarParejaWA,telefonoAStringJid,registrarParejaWA,
 rutaParaEnvioWA,estadoRutaWA,elegirRutaWA,decidirRutaWA,modoDesdeEventoWA
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
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,pn,'Con mapa pero sin saber cómo escribe el cliente: número');
assert.equal((await estadoRutaWA('impar','canal-A',pn)).alternativa,true);
assert.equal(await elegirRutaWA('impar','canal-A',pn,true),true);
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,lid,'Ruteo LID tras opt in');
assert.equal((await rutaParaEnvioWA({id:'canal-B',empresa_id:'impar'},pn)).destino,pn,'No mezclar canales');
assert.equal((await rutaParaEnvioWA({id:'canal-A',empresa_id:'otra'},pn)).destino,pn,'No mezclar empresas');
assert.equal(await registrarParejaWA(canal,{pn,lid:'99999999999999@lid'}),true);
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,pn,'Identidad cambiada desactiva prueba');
assert.equal(await elegirRutaWA('impar','canal-A',pn,false),true);
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,pn);
// Automática: responder por la misma identidad por la que escribe el cliente.
assert.equal(await registrarParejaWA(canal,{pn,lid:'99999999999999@lid'},'mensaje_entrante','lid'),true);
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,'99999999999999@lid','Cliente que escribe por LID recibe por LID');
assert.equal((await rutaParaEnvioWA(canal,pn)).motivo,'cliente_escribe_lid');
assert.equal(await elegirRutaWA('impar','canal-A',pn,'pn'),true);
assert.equal((await rutaParaEnvioWA(canal,pn)).destino,pn,'Elección fija del admin manda');
assert.equal(await elegirRutaWA('impar','canal-A',pn,'cualquiera'),false,'Valor de ruta inválido');
assert.equal(modoDesdeEventoWA({remoteJid:'123456789012345:4@lid'}),'lid');
assert.equal(modoDesdeEventoWA({remoteJid:pn}),'pn');
assert.equal(modoDesdeEventoWA({remoteJid:'x@g.us'}),null);
// Decisión pura
const hoy=Date.now(), reciente=new Date(hoy-3600e3).toISOString(), viejo=new Date(hoy-40*864e5).toISOString();
assert.equal(decidirRutaWA(null).usar,'pn');
assert.equal(decidirRutaWA({ruta:'auto'}).usar,'pn','Sin datos: número');
assert.equal(decidirRutaWA({ruta:'auto',modo_entrante:'lid'}).usar,'lid');
assert.equal(decidirRutaWA({ruta:'auto',modo_entrante:'pn',fallos_pn:1,fallo_ts:reciente}).usar,'lid','Falla el número: pasa a LID');
assert.equal(decidirRutaWA({ruta:'auto',modo_entrante:'lid',fallos_lid:2,fallos_pn:0,fallo_ts:reciente}).usar,'pn','Falla LID: vuelve al número');
assert.equal(decidirRutaWA({ruta:'auto',modo_entrante:'pn',fallos_pn:3,fallo_ts:viejo}).usar,'pn','Fallos viejos se olvidan');
assert.equal(decidirRutaWA({ruta:'pn',modo_entrante:'lid',fallos_pn:9,fallo_ts:reciente}).usar,'pn','Manual número');
assert.equal(decidirRutaWA({ruta:'lid'}).usar,'lid','Manual LID');
const ba=leer('src/channels/baileys.mjs');
const routes=leer('src/routes/negociaciones.mjs');
const ui=leer('public/js/ficha.js');
assert.ok(ba.includes("sock.ev.on('chats.phoneNumberShare'"),'Evento nativo de pares');
assert.ok(ba.includes('parejaDesdeEventoWA(m.key)'), 'Confirmación desde mensajes entrantes');
assert.ok(ba.includes('jid=(await rutaParaEnvioWA(canal,jid)).destino'),'Enrutamiento real en enviar');
assert.ok(!ba.includes('await sock.logout()'),'Nunca desvincular automáticamente');
assert.ok(routes.includes("r.patch('/:id/ruta-whatsapp', requiere('admin')"),'Solo admin');
assert.ok(ui.includes("['auto','Automática (recomendada)']"),'Selector de ruta en el chat');
assert.ok(ui.includes("['pn','Siempre por número']") && ui.includes("['lid','Siempre por LID']"),'Reversible');
assert.ok(ba.includes("sock.ws?.on('CB:receipt'") && ba.includes("node?.attrs?.type!=='retry'"),'Escucha avisos de no descifrado');
assert.ok(ba.includes('registrarReintentoWA(canal,node.attrs)'),'Anota el fallo de ruta');
assert.ok(ba.includes("registrarParejaWA(canal,pareja,'mensaje_entrante',modo)"),'Recuerda por dónde escribe el cliente');
assert.ok(!ui.includes('autoReenviarWA'),'Sin reenvíos automáticos');
const mig=leer('src/migrations/021_wa_identidades_impar.sql');
assert.ok(mig.includes('preferir_lid BOOLEAN NOT NULL DEFAULT FALSE'),'Compatibilidad con la columna anterior');
const mig30=leer('src/migrations/030_wa_ruta_automatica_impar.sql');
assert.ok(mig30.includes("ruta TEXT NOT NULL DEFAULT 'auto'") && mig30.includes("SET ruta='lid' WHERE preferir_lid"),'Ruta automática conservando elecciones previas');
assert.ok(routes.includes("r.post('/:id/mensajes/:mid/reenviar'") && routes.includes('reenviado_ts=now()'),'Reenvío manual de respaldo sin duplicados');
console.log('✔ IMPAR: ruta automática PN/LID, avisos de no descifrado, elección del admin, aislamiento, retorno seguro.');
