/** IMPAR: baja con transferencia, sin borrar la autoría histórica. */
import { q, tx } from './db.mjs';

export function validarSeleccion(origen,destino,administradorId){
  if(!origen || origen.rol==='admin' || origen.id===administradorId || !origen.activo || origen.oculto)
    throw Object.assign(new Error('No se puede eliminar esta cuenta (administrador, inactiva o archivada).'),{status:409});
  if(!destino || !destino.activo || destino.oculto || origen.id===destino.id)
    throw Object.assign(new Error('Seleccioná un empleado activo diferente para recibir los datos.'),{status:409});
  return true;
}

export async function vistaPreviaTransferencia(empresaId,origenId,administradorId){
  const {rows:empleados}=await q(
    'SELECT id,nombre,usuario,rol,sucursal,activo,oculto FROM usuarios WHERE empresa_id=$1 AND NOT oculto ORDER BY nombre',
    [empresaId]);
  const origen=empleados.find(u=>u.id===origenId);
  if(!origen || origen.rol==='admin' || origen.id===administradorId)
    throw Object.assign(new Error('No se puede eliminar ese usuario.'),{status:403});
  const candidatos=empleados.filter(u=>u.activo&&u.id!==origenId);
  const {rows:[resumen]}=await q(
    'SELECT '+
    '(SELECT count(*)::int FROM contactos WHERE empresa_id=$1 AND responsable_id=$2) AS clientes, '+
    '(SELECT count(*)::int FROM negociaciones WHERE empresa_id=$1 AND agente_id=$2) AS negociaciones, '+
    '(SELECT count(*)::int FROM usuarios WHERE empresa_id=$1 AND superior_id=$2 AND activo) AS subordinados, '+
    '(SELECT count(*)::int FROM proyecto_pasos WHERE empresa_id=$1 AND responsable_id=$2) AS tareas, '+
    '(SELECT count(*)::int FROM sucursales WHERE empresa_id=$1 AND responsable_id=$2) AS sucursales, '+
    "(SELECT count(*)::int FROM solicitudes WHERE empresa_id=$1 AND para_id=$2 AND estado='pendiente') AS solicitudes",
    [empresaId,origenId]);
  return {origen:{id:origen.id,nombre:origen.nombre,usuario:origen.usuario},
    candidatos:candidatos.map(u=>({id:u.id,nombre:u.nombre,usuario:u.usuario,rol:u.rol,sucursal:u.sucursal})),
    resumen};
}

/** Mueve propiedad operativa; conserva la autoría de mensajes y archivos históricos. */
export async function eliminarConTransferencia(empresaId,origenId,destinoId,adminId){
  return tx(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[empresaId]);
    const {rows:empleados}=await db.query(
      'SELECT id,nombre,usuario,rol,superior_id,activo,oculto FROM usuarios WHERE empresa_id=$1 FOR UPDATE',
      [empresaId]);
    const origen=empleados.find(u=>u.id===origenId);
    const destino=empleados.find(u=>u.id===destinoId);
    validarSeleccion(origen,destino,adminId);
    let superior=destino;
    const vistos=new Set();
    while(superior?.superior_id){
      if(vistos.has(superior.id) || superior.superior_id===origenId)
        throw Object.assign(new Error('El empleado de destino depende de la cuenta que querés eliminar. Elegí otro destinatario o actualizá primero esa jerarquía.'),{status:409});
      vistos.add(superior.id);
      superior=empleados.find(u=>u.id===superior.superior_id);
    }

    const cambiar=async(sql,params=[empresaId,origenId,destinoId])=>
      (await db.query(sql,params)).rowCount;
    const movidos={};
    movidos.clientes=await cambiar('UPDATE contactos SET responsable_id=$3 WHERE empresa_id=$1 AND responsable_id=$2');
    movidos.negociaciones=await cambiar('UPDATE negociaciones SET agente_id=$3 WHERE empresa_id=$1 AND agente_id=$2');
    movidos.sucursales=await cambiar('UPDATE sucursales SET responsable_id=$3 WHERE empresa_id=$1 AND responsable_id=$2');
    movidos.tareas=await cambiar('UPDATE proyecto_pasos SET responsable_id=$3 WHERE empresa_id=$1 AND responsable_id=$2');
    movidos.solicitudes=await cambiar(
      "UPDATE solicitudes SET para_id=$3 WHERE empresa_id=$1 AND para_id=$2 AND estado='pendiente'");
    movidos.subordinados=await cambiar(
      'UPDATE usuarios SET superior_id=$3,equipo=CASE WHEN lower(equipo)=lower($4) THEN $5 ELSE equipo END '+
      'WHERE empresa_id=$1 AND superior_id=$2 AND id<>$3',
      [empresaId,origenId,destinoId,origen.usuario,destino.usuario]);
    movidos.equipos=await cambiar(
      'UPDATE usuarios SET equipo=$3 WHERE empresa_id=$1 AND lower(equipo)=lower($2) AND id<>$4',
      [empresaId,origen.usuario,destino.usuario,origenId]);

    movidos.grupos=await cambiar(
      'UPDATE grupos g SET miembros=( '+
      "SELECT COALESCE(jsonb_agg(to_jsonb(ids.id)),'[]'::jsonb) "+
      'FROM (SELECT DISTINCT CASE WHEN x.val=$2::text THEN $3::text ELSE x.val END AS id '+
      'FROM jsonb_array_elements_text(g.miembros) AS x(val)) AS ids) '+
      'WHERE g.empresa_id=$1 AND g.miembros @> to_jsonb($2::text)');
    movidos.avisos=await cambiar(
      'UPDATE notificaciones SET usuario_id=$3 WHERE empresa_id=$1 AND usuario_id=$2 AND NOT leida');
    movidos.menciones=await cambiar(
      'UPDATE notas_internas n SET menciones=ARRAY( '+
      'SELECT DISTINCT CASE WHEN x.id=$2::uuid THEN $3::uuid ELSE x.id END '+
      'FROM unnest(n.menciones) AS x(id)) WHERE n.empresa_id=$1 AND $2::uuid=ANY(n.menciones)');

    // Su perfil permanece como referencia histórica, pero deja de poder iniciar sesión.
    const archivados=await cambiar(
      "UPDATE usuarios SET activo=FALSE,oculto=TRUE,fecha_baja=COALESCE(fecha_baja,now()),disponibilidad='fuera' "+
      'WHERE empresa_id=$1 AND id=$2 AND activo AND NOT oculto',[empresaId,origenId]);
    if(archivados!==1)throw new Error('No se pudo archivar la cuenta antigua; se revirtió la transferencia.');
    await db.query(
      "INSERT INTO auditoria(empresa_id,usuario,accion,detalle) VALUES($1,'Sistema','Baja con transferencia',$2)",
      [empresaId,origen.usuario+' -> '+destino.usuario+
        '; clientes='+movidos.clientes+'; negociaciones='+movidos.negociaciones+'; tareas='+movidos.tareas]);
    return {origen:{nombre:origen.nombre,usuario:origen.usuario},
      destino:{nombre:destino.nombre,usuario:destino.usuario},movidos};
  });
}
