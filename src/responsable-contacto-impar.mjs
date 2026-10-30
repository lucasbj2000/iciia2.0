/** IMPAR: asignación manual de responsable en Contactos.
 * Todo usuario puede tomar un contacto libre o pasarlo a otro empleado activo
 * (pedido de IMPAR, 30/10/2026: había contactos mal asignados o libres que nadie podía tomar).
 * Preserva autoría e historial de todas las conversaciones cerradas; queda auditado.
 */
import {q,tx} from './db.mjs';

const fallo=(status,error)=>{throw Object.assign(new Error(error),{status});};
const encargado=(u)=>u && u.activo && !u.oculto && u.rol!=='admin';
const habilitado=(u)=>u && u.activo!==false;

export async function consultarDestinos(req){
  if(!habilitado(req.user))fallo(403,'No tenés permiso para cambiar responsables.');
  const {rows}=await q(
    "SELECT id,nombre,usuario,rol,sucursal FROM usuarios "+
    "WHERE empresa_id=$1 AND activo AND NOT oculto AND rol<>'admin' ORDER BY sucursal,nombre",
    [req.empresaId]);
  return rows.map(({id,nombre,usuario,rol,sucursal})=>({id,nombre,usuario,rol,sucursal,yo:id===req.user.id}));
}

export async function cambiarResponsable(req,contactoId,destinoId){
  if(!habilitado(req.user))fallo(403,'No tenés permiso para cambiar responsables.');
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(contactoId)) ||
     !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(destinoId)))
    fallo(422,'Seleccioná un contacto y un empleado válidos.');
  return tx(async db=>{
    const {rows:cs}=await db.query(
      'SELECT id,nombre,sucursal,responsable_id FROM contactos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',
      [contactoId,req.empresaId]);
    const c=cs[0];if(!c)fallo(404,'Contacto no encontrado.');
    const {rows:us}=await db.query(
      'SELECT id,nombre,usuario,rol,activo,oculto,sucursal,equipo FROM usuarios '+
      'WHERE empresa_id=$1 AND (id=$2 OR id=$3) FOR UPDATE',
      [req.empresaId,destinoId,c.responsable_id]);
    const nuevo=us.find(x=>x.id===destinoId),anterior=us.find(x=>x.id===c.responsable_id);
    if(!encargado(nuevo))fallo(422,'Elegí un responsable activo y habilitado.');
    if(c.responsable_id===nuevo.id)return {
      sinCambios:true,cliente:c.nombre,destino:nuevo.nombre,movidas:0
    };
    const activas=(req.empresa.etapas||[]).filter(e=>e.activa).map(e=>e.id);
    await db.query(
      'UPDATE contactos SET responsable_id=$3,sucursal=$4 WHERE id=$1 AND empresa_id=$2',
      [c.id,req.empresaId,nuevo.id,nuevo.sucursal||c.sucursal||'']);
    const {rows:abiertas}=await db.query(
      'SELECT id,marcadores FROM negociaciones WHERE contacto_id=$1 AND empresa_id=$2 '+
      'AND etapa=ANY($3::text[]) FOR UPDATE',
      [c.id,req.empresaId,activas]);
    for(const n of abiertas){
      const marcadores=new Set(n.marcadores||[]);
      if(req.empresa.flags?.marcadorTransferido)marcadores.add('transferido');
      await db.query(
        'UPDATE negociaciones SET agente_id=$3,sucursal=$4,marcadores=$5,actualizado=now() '+
        'WHERE id=$1 AND empresa_id=$2',
        [n.id,req.empresaId,nuevo.id,nuevo.sucursal||c.sucursal||'',JSON.stringify([...marcadores])]);
      await db.query(
        'INSERT INTO transferencias (empresa_id,negociacion_id,de_nombre,a_nombre,por,nota) '+
        'VALUES ($1,$2,$3,$4,$5,$6)',
        [req.empresaId,n.id,anterior?.nombre||'Sin asignar',nuevo.nombre,req.user.nombre,
          (anterior?'Responsable cambiado desde Contactos':'Contacto libre tomado desde Contactos')]);
      await db.query(
        'INSERT INTO historial (empresa_id,negociacion_id,txt,por) VALUES ($1,$2,$3,$4)',
        [req.empresaId,n.id,'Responsable actualizado desde Contactos: '+
          (anterior?.nombre||'Sin asignar')+' → '+nuevo.nombre,req.user.nombre]);
    }
    return {sinCambios:false,cliente:c.nombre,destino:nuevo.nombre,
      destinoId:nuevo.id,anterior:anterior?.nombre||'Sin asignar',anteriorId:anterior?.id||null,
      movidas:abiertas.length};
  });
}
