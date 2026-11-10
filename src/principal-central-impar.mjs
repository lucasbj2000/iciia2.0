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
  return {id:principal.id,nombre:principal.nombre,linea:principal.linea,tipo:principal.tipo,
    sucursal:principal.sucursal||'',principal_global:true};
}

/** Línea normal (WhatsApp QR) para escribir a quien no tiene abierta la ventana de 24 h de la verificada.
 * Orden: la elegida por el administrador («Contactos nuevos»), la principal si es normal,
 * la llamada «principal» en Central, la única normal de Central o la única normal de IMPAR. */
const salidaMarcada = c => c.config?.salida_nueva === true || c.config?.salida_nueva === 'true';
const mismaSucursal = (c, sucursal) => !!sucursal && String(c.sucursal||'').trim().toLocaleLowerCase('es-PY') === String(sucursal).trim().toLocaleLowerCase('es-PY');
export function elegirSalidaNormal(canales, { sucursal = '' } = {}) {
  const normales = (canales||[]).filter(c => c.tipo === 'whatsapp_qr' && c.activo === true);
  const elegidas = normales.filter(salidaMarcada);
  if (elegidas.length === 1) return elegidas[0];
  const candidatas = [
    normales.filter(marcado),
    normales.filter(c=>central(c) && String(c.nombre||'').trim().toLocaleLowerCase('es-PY')==='principal'),
    normales.filter(central),
    normales,
    // Sin otra regla: la única línea normal de la sucursal de quien escribe.
    normales.filter(c => mismaSucursal(c, sucursal))
  ];
  for (const lista of candidatas) if (lista.length === 1) return lista[0];
  throw Object.assign(new Error(!normales.length
    ? 'No hay una línea de WhatsApp normal activa para escribir a contactos nuevos.'
    : 'Hay varias líneas de WhatsApp normales: un administrador debe elegir en Canales cuál usar para contactos nuevos.'), { status: 409 });
}
export async function consultarSalidaNormal(db, empresaId, opciones = {}) {
  const {rows}=await db.query(
    `SELECT ca.id,ca.nombre,ca.linea,ca.tipo,ca.activo,ca.config,sc.nombre AS sucursal
       FROM canales ca LEFT JOIN sucursales sc ON sc.id=ca.sucursal_id AND sc.empresa_id=ca.empresa_id
      WHERE ca.empresa_id=$1 AND ca.activo=TRUE AND ca.tipo='whatsapp_qr' ORDER BY ca.creado,ca.id`,[empresaId]);
  const c=elegirSalidaNormal(rows, opciones);
  return {id:c.id,nombre:c.nombre,linea:c.linea,tipo:c.tipo,sucursal:c.sucursal||''};
}
