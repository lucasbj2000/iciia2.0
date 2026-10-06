import { tx } from './db.mjs';
import { emitir } from './realtime.mjs';
import { detectarCiudad,nombreDelMensaje,masCercanas,sucursalDe,SUCURSALES,normalizar } from './geografia-impar.mjs';
const pideUbicacion=t=>/\b(ubicacion|direccion|maps|donde (estan|queda|quedan|se encuentran))\b/.test(normalizar(t));
const destino=n=>!n.canal_activo?'':String(n.canal_tipo).startsWith('whatsapp')?((n.canal_tipo==='whatsapp_qr'&&n.externos?.wa_jid)||n.tel||n.externos?.whatsapp||''):(n.externos?.[n.canal_tipo==='messenger'?'messenger':'instagram']||'');
export async function responderRecepcionImpar(empresaId,negId){
 const resultado=await tx(async db=>{
  const {rows}=await db.query(`SELECT n.*,c.nombre AS cliente,c.tel,c.externos,c.responsable_id,c.ciudad,
    ca.tipo AS canal_tipo,ca.activo AS canal_activo,ca.bot_activo AS canal_bot,e.bot AS empresa_bot,e.flags,e.codigo,
    u.nombre AS responsable_nombre,u.activo AS responsable_activo,u.oculto AS responsable_oculto
    FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id AND c.empresa_id=n.empresa_id
    JOIN empresas e ON e.id=n.empresa_id AND e.activa
    LEFT JOIN canales ca ON ca.id=n.canal_id AND ca.empresa_id=n.empresa_id
    LEFT JOIN usuarios u ON u.id=n.agente_id AND u.empresa_id=n.empresa_id
    WHERE n.id=$1 AND n.empresa_id=$2 FOR UPDATE OF n`,[negId,empresaId]);
  const n=rows[0];
  if(!n||n.codigo!=='impar'||!n.flags?.bot||!n.empresa_bot?.activo||n.empresa_bot?.recepcionImpar===false||!n.bot_activo||n.canal_bot===false||['ganado','cerrado'].includes(n.etapa))return null;
  const a=destino(n);if(!a)return null;
  if(n.agente_id&&(!n.responsable_activo||n.responsable_oculto)){
   await db.query('UPDATE contactos SET responsable_id=NULL WHERE id=$1 AND empresa_id=$2 AND responsable_id=$3',[n.contacto_id,empresaId,n.agente_id]);
   await db.query('UPDATE negociaciones SET agente_id=NULL WHERE id=$1 AND empresa_id=$2',[negId,empresaId]);
   n.agente_id=null;
  }
  const st={...n.bot_recepcion};
  const {rows:hist}=await db.query(`SELECT id,dir,txt,bot FROM mensajes WHERE negociacion_id=$1 AND empresa_id=$2 ORDER BY ts DESC,id DESC LIMIT 14`,[negId,empresaId]);
  if(!hist.length||hist[0].dir!=='in')return null;
  const entradas=hist.filter(m=>m.dir==='in'&&Number(m.id)>Number(st.ultimo||0));
  if(!entradas.length)return null;
  const texto=entradas.reverse().map(m=>String(m.txt||'').slice(0,1000)).join('\n');
  st.ultimo=Math.max(...entradas.map(m=>Number(m.id)));
  let respuesta='',apagar=false,asignado=null;
  const lugar=detectarCiudad(texto);
  const solicitada=SUCURSALES.find(s=>s.alias.some(alias=>(' '+normalizar(texto)+' ').includes(' '+alias+' ')));
  const ubicacion=pideUbicacion(texto)?(solicitada||sucursalDe(n.sucursal)|| (lugar?masCercanas(lugar)[0]:null)):null;
  if(st.fase==='derivado'||st.fase==='retorno'){
   st.producto=texto.slice(0,500);st.fase='finalizado';apagar=true;
   if(pideUbicacion(texto))respuesta=ubicacion?`${ubicacion.nombre}: ${ubicacion.url}`:'¿De qué sucursal necesitás la ubicación? Tu asesor te ayudará.';
  }else if(n.agente_id&&n.responsable_activo&&!n.responsable_oculto){
   respuesta=`${n.responsable_nombre.split(' ')[0]}, tu agente responsable, te dará retorno en un momento. ¿Qué producto necesitás?`;
   st.fase='retorno';
  }else{
   const estabaPidiendoDatos=st.fase==='datos';
   const nombre=nombreDelMensaje(texto,lugar,estabaPidiendoDatos&&!st.nombre);
   if(nombre)st.nombre=nombre;
   if(lugar)st.ciudad={nombre:lugar.nombre,lat:lugar.lat,lon:lugar.lon};
   if(st.nombre)await db.query('UPDATE contactos SET nombre=$3 WHERE id=$1 AND empresa_id=$2',[n.contacto_id,empresaId,st.nombre]);
   if(st.ciudad)await db.query('UPDATE contactos SET ciudad=$3 WHERE id=$1 AND empresa_id=$2',[n.contacto_id,empresaId,st.ciudad.nombre]);
   if(st.nombre&&st.ciudad){
    // Jamás cambia de línea de WhatsApp ni el responsable de un cliente asignado.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[empresaId+'-recepcion-asignacion']);
    const cercanas=masCercanas(st.ciudad),{rows:sucs}=await db.query('SELECT nombre FROM sucursales WHERE empresa_id=$1 AND activa',[empresaId]);
    const nombres=sucs.filter(s=>cercanas.some(c=>sucursalDe(s.nombre)?.url===c.url&&normalizar(sucursalDe(s.nombre)?.nombre)===normalizar(c.nombre))).map(s=>s.nombre);
    const {rows:agentes}=await db.query(`SELECT u.id,u.nombre,u.sucursal,COUNT(n.id) FILTER(WHERE n.etapa NOT IN('ganado','cerrado'))::int AS carga,MAX(n.creado) AS ultima
      FROM usuarios u LEFT JOIN negociaciones n ON n.agente_id=u.id AND n.empresa_id=u.empresa_id
      WHERE u.empresa_id=$1 AND u.activo AND NOT u.oculto AND u.rol='agente' AND u.sucursal=ANY($2::text[])
      GROUP BY u.id ORDER BY carga,ultima ASC NULLS FIRST,u.nombre LIMIT 1`,[empresaId,nombres]);
    asignado=agentes[0]||null;
    const sucursal=asignado?.sucursal||nombres[0]||cercanas[0].nombre;
    await db.query('UPDATE negociaciones SET agente_id=$3,sucursal=$4,actualizado=now() WHERE id=$1 AND empresa_id=$2 AND agente_id IS NULL',[negId,empresaId,asignado?.id||null,sucursal]);
    await db.query('UPDATE contactos SET responsable_id=COALESCE(responsable_id,$3),sucursal=$4 WHERE id=$1 AND empresa_id=$2',[n.contacto_id,empresaId,asignado?.id||null,sucursal]);
    st.fase='derivado';st.sucursal=sucursal;
    respuesta=asignado?`Gracias, ${st.nombre.split(' ')[0]}. Te atenderá ${asignado.nombre.split(' ')[0]} de ${sucursal}. ¿Qué producto necesitás?`:`Gracias, ${st.nombre.split(' ')[0]}. Tu consulta quedó para ${sucursal}; un asesor te dará retorno. ¿Qué producto necesitás?`;
    await db.query(`INSERT INTO historial(empresa_id,negociacion_id,txt,por) VALUES($1,$2,$3,'Bot')`,[empresaId,negId,`Recepción: ${st.ciudad.nombre} → ${sucursal}${asignado?' · '+asignado.nombre:' · pendiente, sin agente activo en la sucursal'}`]);
    if(asignado&&n.flags.notificaciones!==false)await db.query(`INSERT INTO notificaciones(empresa_id,usuario_id,tipo,titulo,msg,tono,ref) VALUES($1,$2,'nuevo','Cliente asignado por ciudad',$3,'ok',$4)`,[empresaId,asignado.id,`${st.nombre} · ${st.ciudad.nombre}`,negId]);
   }else if((st.respuestas||0)>=3){
    respuesta='Un asesor te ayudará a completar tus datos y atender tu consulta.';st.fase='finalizado';apagar=true;
   }else{
    respuesta=!st.nombre&&!st.ciudad?'¡Hola! Soy el asistente de IMPAR. ¿Cómo te llamás y en qué ciudad vivís?':!st.nombre?'¿Cómo te llamás?':'¿En qué ciudad vivís?';st.fase='datos';
   }
  }
  if(ubicacion&&respuesta&&!respuesta.includes(ubicacion.url))respuesta+=`\n${ubicacion.nombre}: ${ubicacion.url}`;
  if(pideUbicacion(texto)&&!ubicacion&&respuesta&&st.fase==='datos')respuesta+='\nDecime la sucursal y te paso la ubicación.';
  st.respuestas=(st.respuestas||0)+(respuesta?1:0);
  if(st.respuestas>=5)apagar=true;
  await db.query('UPDATE negociaciones SET bot_recepcion=$3,bot_activo=$4 WHERE id=$1 AND empresa_id=$2',[negId,empresaId,JSON.stringify(st),!apagar]);
  if(respuesta){
   await db.query(`INSERT INTO mensajes(empresa_id,negociacion_id,dir,txt,bot,estado) VALUES($1,$2,'out',$3,true,'pendiente')`,[empresaId,negId,respuesta]);
   await db.query(`INSERT INTO outbox(empresa_id,canal_id,negociacion_id,destino,txt) VALUES($1,$2,$3,$4,$5)`,[empresaId,n.canal_id,negId,a,respuesta]);
  }
  return {asignado,notificar:n.flags.notificaciones!==false,respondio:!!respuesta};
 });
 if(resultado){emitir(empresaId,'neg:patch',{id:negId});if(resultado.asignado){emitir(empresaId,'neg:recargar',{});if(resultado.notificar)emitir(empresaId,'noti',{tipo:'nuevo',titulo:'Cliente asignado por ciudad',msg:'Tenés un nuevo cliente asignado.',tono:'ok',ref:negId},[resultado.asignado.id]);}}
 return resultado;
}
