/** IMPAR · carga de mensajes históricos desde una conversación; solo admin.
 * Nunca envía a WhatsApp ni altera estados de las negociaciones.
 */
import {Router} from 'express';
import {q} from '../db.mjs';
import {requiere} from '../auth.mjs';
import {auditar,historial} from '../core.mjs';
import {emitir} from '../realtime.mjs';
const r=Router();

export function validarCargaHistorica(body){
  const dir=String(body?.direccion||''),texto=String(body?.texto||'').trim();
  const modo=String(body?.modo||'fecha');
  if(!['in','out'].includes(dir))return {error:'Elegí Cliente o Agente.'};
  if(!texto || texto.length>10000)return {error:'El mensaje debe contener entre 1 y 10.000 caracteres.'};
  if(!['fecha','antes','despues'].includes(modo))return {error:'Ubicación del mensaje inválida.'};
  if(modo==='fecha'){
    if(typeof body?.fecha!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(body.fecha))
      return {error:'Indicá fecha y hora completas con zona horaria.'};
    const ts=new Date(body.fecha);
    if(!Number.isFinite(ts.getTime()) || ts.getTime()<Date.UTC(2000,0,1) ||
       ts.getTime()>Date.now()+10*60*1000)
      return {error:'Fecha fuera del intervalo permitido.'};
    return {dir,texto,modo,fecha:ts};
  }
  const referencia=String(body?.referenciaId||'');
  if(!/^[1-9]\d{0,18}$/.test(referencia))return {error:'Seleccioná un mensaje existente como referencia.'};
  return {dir,texto,modo,referencia};
}

r.post('/:id/historico',requiere('admin'),async(req,res)=>{
  try{
    const input=validarCargaHistorica(req.body);
    if(input.error)return res.status(422).json({error:input.error});
    const {rows:negociaciones}=await q(
      'SELECT id,contacto_id FROM negociaciones WHERE empresa_id=$1 AND id=$2',
      [req.empresaId,req.params.id]);
    const actual=negociaciones[0];
    if(!actual)return res.status(404).json({error:'Negociación no encontrada.'});
    let fecha=input.fecha,negociacionId=actual.id;
    if(input.modo!=='fecha'){
      const {rows:references}=await q(
        'SELECT m.id,m.ts,m.negociacion_id, '+
        'to_char(m.ts AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS ts_precisa FROM mensajes m '+
        'JOIN negociaciones n ON n.id=m.negociacion_id AND n.empresa_id=m.empresa_id '+
        'WHERE m.id=$1 AND m.empresa_id=$2 AND n.contacto_id=$3',
        [input.referencia,req.empresaId,actual.contacto_id]);
      const referencia=references[0];
      if(!referencia)return res.status(404).json({error:'El mensaje de referencia no pertenece a este cliente.'});
      negociacionId=referencia.negociacion_id;
      const antes=input.modo==='antes';
      const comparator=antes?'<':'>',direction=antes?'DESC':'ASC';
      const {rows:adyacentes}=await q(
        'SELECT m.ts,to_char(m.ts AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS ts_precisa '+
        'FROM mensajes m JOIN negociaciones n ON n.id=m.negociacion_id '+
        'WHERE m.empresa_id=$1 AND n.empresa_id=$1 AND n.contacto_id=$2 '+
        'AND (m.ts,m.id) '+comparator+' ($3::timestamptz,$4::bigint) '+
        'ORDER BY m.ts '+direction+',m.id '+direction+' LIMIT 1',
        [req.empresaId,actual.contacto_id,referencia.ts_precisa,referencia.id]);
      if(adyacentes[0] && adyacentes[0].ts_precisa!==referencia.ts_precisa){
        const primero=antes?adyacentes[0].ts_precisa:referencia.ts_precisa,
          segundo=antes?referencia.ts_precisa:adyacentes[0].ts_precisa;
        const {rows:mid}=await q('SELECT ($1::timestamptz+($2::timestamptz-$1::timestamptz)/2) AS ts',
          [primero,segundo]);
        fecha=mid[0].ts;
      }else{
        const {rows:intervalo}=await q(
          "SELECT $1::timestamptz + ($2::integer * interval '1 microsecond') AS ts",
          [referencia.ts_precisa,antes?-1:1]);
        fecha=intervalo[0].ts;
      }
    }
    const {rows:insertados}=await q(
      'INSERT INTO mensajes(empresa_id,negociacion_id,dir,txt,autor_id,ts,estado,'+
      'carga_historica,carga_por,carga_registrada) '+
      "VALUES($1,$2,$3,$4,$5,$6,'historico',TRUE,$5,now()) RETURNING id,ts,dir,txt",
      [req.empresaId,negociacionId,input.dir,input.texto,
        req.user.id,fecha]);
    await historial(req.empresaId,negociacionId,
      'Registro histórico manual ('+(input.dir==='in'?'cliente':'agente')+
      ') · hora original: '+new Date(fecha).toISOString(),req.user.nombre);
    await auditar(req.empresaId,req.user.nombre,'Mensaje histórico',
      'Carga '+(input.dir==='in'?'cliente':'agente')+' · mensaje #'+insertados[0].id+
      ' · negociación '+negociacionId,req.ip);
    emitir(req.empresaId,'neg:patch',{id:actual.id});
    if(actual.id!==negociacionId)emitir(req.empresaId,'neg:patch',{id:negociacionId});
    res.json({ok:true,mensaje:insertados[0],sinEnvioWhatsApp:true});
  }catch(e){
    console.error('[historico impar] error:',e.name);
    res.status(500).json({error:'No se pudo registrar el mensaje histórico.'});
  }
});
export default r;
