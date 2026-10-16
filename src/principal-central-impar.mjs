/** IMPAR: línea institucional única y compartida por todas las sucursales.
 * La autorización depende de empresaId, nunca de la sucursal del agente.
 * Se prioriza la selección expresa del administrador; si no está configurada,
 * se admite una sola línea activa de Central o, cuando exista UNA en toda IMPAR,
 * esa línea única. No se elige al azar ante dos candidatas.
 */
const whatsapp = c => ['whatsapp_qr','whatsapp_api'].includes(c.tipo) && c.activo === true;
const central = c => String(c.sucursal||'').trim().toLocaleLowerCase('es-PY') === 'central';
const marcado = c => c.config?.principal_global === true || c.config?.principal_global === 'true';

export function elegirPrincipalImpar(canales) {
  const activas = (canales||[]).filter(whatsapp);
  const destacadas = activas.filter(marcado);
  const nombradas = activas.filter(c=>central(c) && String(c.nombre||'').trim().toLocaleLowerCase('es-PY')==='principal');
  const centrales = activas.filter(central);
  if(destacadas.length > 1) throw Object.assign(
    new Error('Hay dos canales marcados como principales en IMPAR. Un administrador debe seleccionar uno.'),{status:409});
  if(destacadas.length === 1) return destacadas[0];
  if(nombradas.length > 1) throw Object.assign(
    new Error('Hay más de una línea principal en Central. Un administrador debe elegir una.'),{status:409});
  if(nombradas.length === 1) return nombradas[0];
  if(centrales.length === 1) return centrales[0];
  if(activas.length === 1) return activas[0];
  throw Object.assign(new Error(
    !activas.length
      ? 'No hay una línea WhatsApp activa en IMPAR. Revisá Administración → Canales.'
      : 'Hay varias líneas WhatsApp activas sin una principal definida. Un administrador debe elegir la línea compartida.'
  ),{status:409});
}

export async function consultarPrincipalCentral(db,empresaId) {
  const {rows}=await db.query(
    `SELECT ca.id,ca.nombre,ca.linea,ca.tipo,ca.activo,ca.config,
            sc.nombre AS sucursal
       FROM canales ca
       LEFT JOIN sucursales sc
         ON sc.id=ca.sucursal_id AND sc.empresa_id=ca.empresa_id
      WHERE ca.empresa_id=$1 AND ca.activo=TRUE
        AND ca.tipo IN ('whatsapp_qr','whatsapp_api')
      ORDER BY ca.creado,ca.id`,[empresaId]);
  const principal=elegirPrincipalImpar(rows);
  // El nombre mostrado siempre será real, incluso si el canal único todavía
  // no tiene asignada formalmente la sucursal Central.
  return {id:principal.id,nombre:principal.nombre,linea:principal.linea,
    sucursal:principal.sucursal||'',principal_global:true};
}
