/** IMPAR · regresiones de recepción PN/LID y carga manual, sin WhatsApp real. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {combinarHistorial} from '../public/js/historial-chat.js';
const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=leer('src/wa-identidades-impar.mjs');
const tabla=new Map(),queries=[];
let errorBD=false;
const q=async(sql,args)=>{
  queries.push({sql,args});
  if(errorBD)throw Error('BD simulada inaccesible');
  if(sql.includes('SELECT pn_jid FROM wa_identidades_impar')){
    const value=tabla.get(args[0]+'|'+args[1]+'|'+args[2])||[];
    return {rows:value.map(pn_jid=>({pn_jid}))};
  }
  throw Error('No esperada: '+sql);
};
const context=vm.createContext({q,console,String,Number,Boolean,Date});
vm.runInContext(source.replace(/^import .*;$/gm,'')
  .replace(/\bexport (const|async function|function)/g,'$1')+
  '\nglobalThis.api={resolverRemitenteWA,parejaDesdeEventoWA,validarParejaWA};',context);
const {resolverRemitenteWA,parejaDesdeEventoWA}=context.api;
const canal={id:'canal-a',empresa_id:'empresa-a'};
const pn='595981123456@s.whatsapp.net',lid='123456789012345@lid';
assert.equal(await resolverRemitenteWA(canal,{remoteJid:pn}),'595981123456');
assert.equal(await resolverRemitenteWA(canal,{remoteJid:lid,senderPn:pn}),'595981123456',
  'Resolver evento LID con PN confirmado por WhatsApp');
assert.equal(await resolverRemitenteWA(canal,{remoteJid:lid}),lid,
  'Sin mapa no inventar números');
tabla.set('empresa-a|canal-a|'+lid,[pn]);
assert.equal(await resolverRemitenteWA(canal,{remoteJid:lid}),'595981123456',
  'El mapa de identidad vincula con la ficha telefónica existente');
assert.equal(await resolverRemitenteWA({id:'canal-b',empresa_id:'empresa-a'},{remoteJid:lid}),lid,
  'Una línea distinta nunca hereda el mapa');
assert.equal(await resolverRemitenteWA({id:'canal-a',empresa_id:'otra'},{remoteJid:lid}),lid,
  'Otra empresa nunca hereda el mapa');
tabla.set('empresa-a|canal-a|'+lid,[pn,'595981222333@s.whatsapp.net']);
assert.equal(await resolverRemitenteWA(canal,{remoteJid:lid}),lid,
  'Mapeo ambiguo no atribuye mensajes a un teléfono ajeno');
errorBD=true;
assert.equal(await resolverRemitenteWA(canal,{remoteJid:lid}),lid,
  'Un error de mapa no impide registrar el LID original');
assert.equal(parejaDesdeEventoWA({remoteJid:lid,remoteJidAlt:pn})?.pn,pn);
const ba=leer('src/channels/baileys.mjs');
assert.ok(ba.includes("!['notify','append'].includes(type)"),
  'Recuperar mensajes append tras desconexión');
assert.ok(ba.includes('hora<Date.now()-72*60*60*1000'),
  'Append antiguo se filtra para no duplicar históricos');
assert.ok(ba.includes('await resolverRemitenteWA(canal,m.key)'),'Unificar PN antes de inbox');
assert.ok(ba.includes('await registrarParejaWA(canal,pareja)'),
  'Persistir equivalencia antes de resolver el remitente');
assert.ok(ba.includes('normalizeMessageContent'),'Contenido efímero desembalado');
assert.ok(ba.includes('[imagen recibida · adjunto no disponible]'),
  'Descargas fallidas no descartan eventos de imagen');

const route=leer('src/routes/historicos-impar.mjs');
const validation=route.slice(route.indexOf('export function validarCargaHistorica('),
  route.indexOf("\nr.post('/:id/historico'"));
const c=vm.createContext({String,Date,Number,BigInt});
vm.runInContext(validation.replace('export function','function')+
  ';globalThis.validate=validarCargaHistorica;',c);
const valid=c.validate;
const base={direccion:'in',texto:'Texto recuperado',modo:'fecha',fecha:'2026-10-20T10:34:00.000Z'};
assert.equal(valid(base).error,undefined);
assert.equal(valid({...base,direccion:'out'}).dir,'out');
assert.ok(valid({...base,direccion:'otro'}).error);
assert.ok(valid({...base,texto:' '}).error);
assert.ok(valid({...base,fecha:'2026-10-20T10:34:00'}).error,
  'No aceptar fecha sin zona horaria');
assert.ok(valid({...base,fecha:'1990-01-01T00:00:00Z'}).error);
assert.equal(valid({direccion:'in',texto:'Recuperado',modo:'antes',referenciaId:'123'}).referencia,'123');
assert.equal(valid({direccion:'out',texto:'Respondido',modo:'despues',referenciaId:'456'}).referencia,'456');
assert.ok(valid({direccion:'in',texto:'x',modo:'antes',referenciaId:'xyz'}).error);
assert.ok(route.includes("requiere('admin')"),'Sólo admin inserta');
assert.ok(route.includes('carga_historica,carga_por,carga_registrada'),'Auditoría persistente');
assert.ok(route.includes('n.contacto_id=$3'),'Referencia no cruza contactos');
assert.ok(route.includes('await auditar('),'Historial auditable');
assert.ok(!route.includes('outbox')&&!route.includes('baileys.enviar')&&!route.includes('meta.enviarWhatsAppAPI'),
  'Una inserción no envía mensaje a WhatsApp');
const ui=leer('public/js/ficha.js'),form=leer('public/js/carga-historica-impar.js');
assert.ok(ui.includes('formularioHistorico()')&&ui.includes('botonAnclarHistorico(m)'));
assert.ok(ui.includes('activarCargaHistorica(n.id,refrescarFicha)'));
assert.ok(ui.includes('Carga histórica (admin)'),'Identificación inequívoca');
assert.ok(form.includes('hist-modo')&&form.includes('hist-dir'),'Elegir fecha y emisor');
assert.ok(form.includes('data-hist-tras')&&form.includes('referenciaId'),'Inserción junto a mensaje');
assert.ok(leer('src/server.mjs').includes("app.use('/api/negociaciones', rHistoricosImpar)"));
assert.ok(leer('src/migrations/023_carga_historica_mensajes.sql').includes('carga_historica'));

const ns=[
 {id:'3',ts:'2026-10-20T10:00:00.000Z',cursor_preciso:'2026-10-20T10:00:00.000300Z',conversacion_id:'a'},
 {id:'1',ts:'2026-10-20T10:00:00.000Z',cursor_preciso:'2026-10-20T10:00:00.000100Z',conversacion_id:'a'},
 {id:'2',ts:'2026-10-20T10:00:00.000Z',cursor_preciso:'2026-10-20T10:00:00.000200Z',conversacion_id:'a'}
];
assert.deepEqual(combinarHistorial([],ns).map(m=>m.id),['1','2','3'],
  'Historial respeta microsegundos de PostgreSQL');
console.log('✔ IMPAR: recuperación append, PN/LID segura, multimedia, registro histórico admin y orden preciso.');
