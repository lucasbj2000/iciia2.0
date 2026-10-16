/** IMPAR: una única línea WhatsApp institucional para iniciar conversaciones.
 * No cambia la sucursal de las personas ni la línea de negociaciones existentes.
 * Selecciona por identidad real (canal "principal" de Central), no por la
 * preferencia de la sucursal del agente o flags antiguos desactualizados.
 */
export async function consultarPrincipalCentral(db,empresaId){
  const {rows}=await db.query(
    `SELECT ca.id,ca.nombre,ca.linea,sc.nombre AS sucursal,
            TRUE AS principal_global
       FROM canales ca
       JOIN sucursales sc ON sc.id=ca.sucursal_id AND sc.empresa_id=ca.empresa_id
      WHERE ca.empresa_id=$1 AND ca.activo=TRUE
        AND ca.tipo IN ('whatsapp_qr','whatsapp_api')
        AND lower(trim(ca.nombre))='principal'
        AND lower(trim(sc.nombre))='central'
      ORDER BY ca.creado,ca.id LIMIT 2`,[empresaId]);
  if(rows.length!==1){
    const error=rows.length===0
      ? 'No se encontró la línea «principal» activa de Central. Consultá a Administración → Canales.'
      : 'Hay más de una línea «principal» en Central. Un administrador debe elegir la correcta.';
    throw Object.assign(new Error(error),{status:409});
  }
  return rows[0];
}
