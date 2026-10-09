import { Router } from 'express';
import { q, tx } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { emitir } from '../realtime.mjs';
import { auditar } from '../core.mjs';
import { DIAS, HORA, normalizar, horaValida, fechaLocal, calcularAviso, minutos } from '../horarios-reglas.mjs';

const r=Router();
r.use(requiere());
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const semana=()=>DIAS.map((_,dia)=>({dia,activo:dia>=1&&dia<=5,entrada:'08:00',salida:'17:00'}));
const sanitizar=x=>({dia:Number(x.dia),activo:x.activo,entrada:normalizar(x.entrada),salida:normalizar(x.salida)});
const valido=x=>Number.isInteger(x.dia)&&x.dia>=0&&x.dia<=6&&typeof x.activo==='boolean'&&horaValida(x.entrada,x.salida);

async function turnosEmpresa(id){
  const {rows}=await q('SELECT dia,activo,entrada,salida FROM horarios_empresa WHERE empresa_id=$1',[id]);
  const mapa=new Map(rows.map(x=>[x.dia,{...x,entrada:normalizar(x.entrada),salida:normalizar(x.salida)}]));
  return semana().map(x=>mapa.get(x.dia)||x);
}
async function turnoActual(req,fecha){
  const defaults=await turnosEmpresa(req.empresaId);
  const {rows}=await q('SELECT dia,activo,entrada,salida FROM horarios_agentes WHERE empresa_id=$1 AND usuario_id=$2 AND dia=$3',
    [req.empresaId,req.user.id,fecha.dia]);
  const t=rows[0]||defaults[fecha.dia];
  return {...t,entrada:normalizar(t.entrada),salida:normalizar(t.salida)};
}
async function estadoDeSalida(req){
  const fecha=fechaLocal();
  if(req.user.rol!=='agente')return {aplica:false,fecha:fecha.fecha,horaActual:fecha.hora};
  const t=await turnoActual(req,fecha);
  const {rows}=await q('SELECT decision,hasta,confirmado_para,actualizado FROM horarios_respuestas WHERE empresa_id=$1 AND usuario_id=$2 AND dia_fecha=$3',
    [req.empresaId,req.user.id,fecha.fecha]);
  const resp=rows[0]||{};
  const aviso=calcularAviso({activo:t.activo,salida:t.salida,hora:fecha.hora,...resp});
  return {aplica:!!t.activo,fecha:fecha.fecha,dia:fecha.dia,horaActual:fecha.hora,
    entrada:t.entrada,salida:t.salida,decision:resp.decision||null,
    hasta:resp.hasta?normalizar(resp.hasta):null,objetivo:aviso.objetivo,
    faltan:aviso.faltan,mostrarAviso:aviso.mostrar};
}
r.get('/mi-turno',async(req,res,next)=>{
  try{res.set('Cache-Control','no-store').json(await estadoDeSalida(req));}catch(e){next(e);}
});
r.post('/mi-turno/responder',async(req,res,next)=>{
  try{
    if(req.user.rol!=='agente')return res.status(403).json({error:'Disponible para agentes'});
    const b=req.body||{},decision=String(b.decision||'');
    if(!['normal','extra'].includes(decision))return res.status(422).json({error:'Elegí una salida válida.'});
    const estado=await estadoDeSalida(req);
    if(!estado.mostrarAviso || String(b.objetivo||'')!==estado.objetivo)
      return res.status(409).json({error:'El aviso ya no corresponde al turno actual. Actualizá la página.'});
    let hasta=null;
    if(decision==='extra'){
      hasta=String(b.hasta||'').slice(0,5);
      if(!HORA.test(hasta)||minutos(hasta)<=minutos(estado.objetivo)||minutos(hasta)<=minutos(estado.horaActual))
        return res.status(422).json({error:'La nueva salida debe ser posterior al horario previsto y dentro del mismo día.'});
    }
    await q(\`INSERT INTO horarios_respuestas(empresa_id,usuario_id,dia_fecha,decision,hasta,confirmado_para)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(empresa_id,usuario_id,dia_fecha) DO UPDATE SET
       decision=EXCLUDED.decision,hasta=EXCLUDED.hasta,
       confirmado_para=EXCLUDED.confirmado_para,actualizado=now()\`,
      [req.empresaId,req.user.id,estado.fecha,decision,hasta,estado.objetivo]);
    emitir(req.empresaId,'horarios:respuesta',{usuario_id:req.user.id});
    res.json({ok:true,decision,hasta,fecha:estado.fecha});
  }catch(e){next(e);}
});
r.get('/config',requiere('admin'),async(req,res,next)=>{
  try{
    const [empresa,excepciones,usuarios]=await Promise.all([
      turnosEmpresa(req.empresaId),
      q('SELECT h.usuario_id,h.dia,h.activo,h.entrada,h.salida FROM horarios_agentes h JOIN usuarios u ON u.id=h.usuario_id WHERE h.empresa_id=$1 AND u.empresa_id=$1 AND u.activo',[req.empresaId]),
      q("SELECT id,nombre,sucursal FROM usuarios WHERE empresa_id=$1 AND activo AND rol='agente' AND NOT oculto ORDER BY nombre",[req.empresaId])
    ]);
    res.set('Cache-Control','no-store').json({zona:'America/Asuncion',empresa,
      excepciones:excepciones.rows.map(x=>({...x,entrada:normalizar(x.entrada),salida:normalizar(x.salida)})),
      usuarios:usuarios.rows});
  }catch(e){next(e);}
});
r.put('/config',requiere('admin'),async(req,res,next)=>{
  try{
    const b=req.body||{};
    if(!Array.isArray(b.empresa)||b.empresa.length!==7 || !Array.isArray(b.excepciones)||b.excepciones.length>700)
      return res.status(422).json({error:'Enviá los siete días de la empresa y sus excepciones.'});
    const base=b.empresa.map(sanitizar);
    const excepciones=b.excepciones.map(x=>({...sanitizar(x),usuario_id:String(x.usuario_id||'')}));
    if(base.some(x=>!valido(x))||new Set(base.map(x=>x.dia)).size!==7 ||
       excepciones.some(x=>!valido(x)||!uuid.test(x.usuario_id))||
       new Set(excepciones.map(x=>x.usuario_id+':'+x.dia)).size!==excepciones.length)
      return res.status(422).json({error:'Horarios incorrectos. Verificá días y formato HH:MM; la salida debe ser posterior a la entrada.'});
    await tx(async c=>{
      const uids=[...new Set(excepciones.map(x=>x.usuario_id))];
      if(uids.length){
        const {rows}=await c.query("SELECT id FROM usuarios WHERE empresa_id=$1 AND activo AND rol='agente' AND id=ANY($2::uuid[])",[req.empresaId,uids]);
        if(rows.length!==uids.length)throw Object.assign(new Error('Agentes inválidos'),{status:422});
      }
      for(const h of base)await c.query(\`INSERT INTO horarios_empresa(empresa_id,dia,activo,entrada,salida) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(empresa_id,dia) DO UPDATE SET activo=EXCLUDED.activo,entrada=EXCLUDED.entrada,
         salida=EXCLUDED.salida,actualizado=now()\`,[req.empresaId,h.dia,h.activo,h.entrada,h.salida]);
      await c.query('DELETE FROM horarios_agentes WHERE empresa_id=$1',[req.empresaId]);
      for(const h of excepciones)await c.query('INSERT INTO horarios_agentes(empresa_id,usuario_id,dia,activo,entrada,salida) VALUES($1,$2,$3,$4,$5,$6)',
        [req.empresaId,h.usuario_id,h.dia,h.activo,h.entrada,h.salida]);
    });
    auditar(req.empresaId,req.user.nombre,'Horarios IMPAR','Actualización de horarios de agentes y empresa',req.ip).catch(()=>{});
    emitir(req.empresaId,'horarios:cambio',{ts:Date.now()});
    res.json({ok:true});
  }catch(e){if(e.status===422)return res.status(422).json({error:e.message});next(e);}
});
r.get('/salidas-hoy',requiere('admin'),async(req,res,next)=>{
  try{
    const hoy=fechaLocal(),base=await turnosEmpresa(req.empresaId);
    const {rows}=await q(\`SELECT u.id,u.nombre,u.sucursal,
      h.activo AS dia_activo,h.entrada AS entrada_personal,h.salida AS salida_personal,
      resp.decision,resp.hasta,resp.confirmado_para,resp.actualizado
      FROM usuarios u
      LEFT JOIN horarios_agentes h ON h.empresa_id=u.empresa_id AND h.usuario_id=u.id AND h.dia=$2
      LEFT JOIN horarios_respuestas resp ON resp.empresa_id=u.empresa_id AND resp.usuario_id=u.id AND resp.dia_fecha=$3
      WHERE u.empresa_id=$1 AND u.rol='agente' AND u.activo AND NOT u.oculto ORDER BY u.nombre\`,
      [req.empresaId,hoy.dia,hoy.fecha]);
    res.set('Cache-Control','no-store').json({fecha:hoy.fecha,horaActual:hoy.hora,
      agentes:rows.map(x=>({
        id:x.id,nombre:x.nombre,sucursal:x.sucursal,
        activo:x.dia_activo===null?base[hoy.dia].activo:x.dia_activo,
        entrada:normalizar(x.entrada_personal||base[hoy.dia].entrada),
        salida:normalizar(x.salida_personal||base[hoy.dia].salida),
        decision:x.decision||null,hasta:x.hasta?normalizar(x.hasta):null,
        actualizado:x.actualizado||null
      }))});
  }catch(e){next(e);}
});
export default r;
