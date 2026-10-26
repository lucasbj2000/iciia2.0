#!/usr/bin/env node
/** IMPAR · Diagnóstico SOLO LECTURA para "Esperando el mensaje".
 * No envía WhatsApp, no toca auth, no reinicia PM2, no lista clientes ni teléfonos.
 * Se puede ejecutar desde main o por: git show origin/main:scripts/diagnosticar-entrega-wa.mjs | node --input-type=module
 */
import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const cwd=process.cwd();
const seguridad=nombre=>{try{return readFileSync(join(cwd,nombre),'utf8')}catch{return ''}};
const pkg=JSON.parse(seguridad('package.json')||'{}');
if(!/iciia-crm/.test(pkg.name||'')){console.error('✖ No estás en la carpeta del CRM IMPAR.');process.exitCode=1;}
else{
console.log('\n=== IMPAR · DIAGNÓSTICO DE ENTREGA (SOLO LECTURA) ===');
console.log('Carpeta: '+cwd);
const ejecutar=(cmd,args)=>{try{return execFileSync(cmd,args,{cwd,encoding:'utf8',timeout:8000,stdio:['ignore','pipe','ignore']}).trim()}catch{return ''}};
const sha=ejecutar('git',['rev-parse','--short=12','HEAD']);
console.log('SHA instalado: '+(sha||'no encontrado'));
let baileys='no encontrado';
try{
 const ruta=join(cwd,'node_modules/@whiskeysockets/baileys/package.json');
 baileys=JSON.parse(readFileSync(ruta,'utf8')).version;
}catch{}
console.log('Baileys instalado: '+baileys);
const srcBaileys=seguridad('src/channels/baileys.mjs');
const parche=seguridad('node_modules/@whiskeysockets/baileys/lib/Utils/decode-wa-message.js');
console.log('getMessage para recuperación: '+(srcBaileys.includes('getMessage: key => recuperarOriginal(')?'configurado':'NO configurado'));
console.log('Parche LID/PN: '+(parche.includes('ICIIA_LID_PN_DECRYPT_RETRY')?'presente':'ausente o estructura distinta'));
const directorio=resolve(cwd,process.env.WA_AUTH_DIR||'auth');
let cantidad=0,credenciales=0;
try{
 for(const d of readdirSync(directorio,{withFileTypes:true})){
  if(!d.isDirectory())continue;
  cantidad++;
  if(existsSync(join(directorio,d.name,'creds.json')))credenciales++;
 }
}catch{}
console.log('Sesiones en disco: '+cantidad+' · con creds.json: '+credenciales);
let pm=[];
try{
 const j=JSON.parse(ejecutar('pm2',['jlist'])||'[]');
 pm=j.filter(x=>
  String(x.pm2_env?.pm_cwd||'').startsWith(cwd) ||
  String(x.pm2_env?.pm_exec_path||'').startsWith(cwd));
 console.log('Procesos PM2 para esta carpeta: '+pm.length);
 for(const p of pm)console.log('  '+p.name+' · '+p.pm2_env?.status+' · PID '+p.pid+' · reinicios '+p.pm2_env?.restart_time);
 if(pm.filter(p=>p.pm2_env?.status==='online').length>1)
  console.log('⚠ ALERTA: varios procesos PM2 activos apuntan al mismo CRM.');
}catch{console.log('PM2: sin datos');}
const require=createRequire(join(cwd,'package.json'));
try{require('dotenv').config({path:join(cwd,'.env'),quiet:true});}catch{}
const indicadores={};
try{
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:4000,max:1});
 try{
  const {rows:tab}=await pool.query("SELECT to_regclass('public.wa_mensajes_reintento') IS NOT NULL AS existe");
  indicadores.almacenRecuperacion=!!tab[0]?.existe;
  if(indicadores.almacenRecuperacion){
   const {rows}=await pool.query(
     "SELECT count(*)::int AS guardados, count(*) FILTER (WHERE expira>now())::int AS vigentes "+
     "FROM wa_mensajes_reintento");
   indicadores.originalesGuardados=rows[0].guardados;
   indicadores.originalesVigentes=rows[0].vigentes;
  }
  const {rows:enviados}=await pool.query(
    "SELECT count(*) FILTER (WHERE estado='enviado')::int AS aceptados, "+
    "count(*) FILTER (WHERE estado='pendiente')::int AS pendientes, "+
    "count(*) FILTER (WHERE estado='error')::int AS fallos "+
    "FROM outbox WHERE ts>now()-interval '24 hours' AND "+
    "empresa_id IN (SELECT id FROM empresas WHERE codigo='impar')");
  indicadores.outboxUltimas24h=enviados[0];
  const {rows:canales}=await pool.query(
    "SELECT tipo,estado,count(*)::int AS cantidad FROM canales "+
    "WHERE empresa_id IN (SELECT id FROM empresas WHERE codigo='impar') "+
    "AND activo GROUP BY tipo,estado ORDER BY tipo,estado");
  indicadores.canales=canales.rows||canales;
 }finally{await pool.end();}
}catch(e){indicadores.consultaPostgres='No disponible (revisar DB sin mostrar credenciales)';}
console.log('Almacén de originales en PostgreSQL: '+(indicadores.almacenRecuperacion===true?'sí':indicadores.almacenRecuperacion===false?'NO':'no comprobado'));
if(indicadores.originalesVigentes!==undefined)
 console.log('Originales en recuperación: '+indicadores.originalesVigentes+' vigentes / '+indicadores.originalesGuardados+' total');
if(indicadores.outboxUltimas24h){
 const o=indicadores.outboxUltimas24h;
 console.log('Outbox 24h (aceptados por conector, NO confirmación del receptor): '+o.aceptados+' aceptados, '+o.pendientes+' pendientes, '+o.fallos+' fallos');
}
if(indicadores.canales)for(const c of indicadores.canales)
 console.log('Canal '+c.tipo+' · '+c.estado+': '+c.cantidad);
if(indicadores.consultaPostgres)console.log(indicadores.consultaPostgres);
console.log('IMPORTANTE: este resultado NO demuestra que el destinatario haya podido descifrar cada mensaje.');
console.log('No se alteraron chats, sesiones ni credenciales.\n');
}
