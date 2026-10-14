/** IMPAR: lectura continua por contacto entre negociaciones, nunca fusiona registros.
 * La primera página trae los mensajes más recientes; el resto se carga hacia atrás.
 */
const TAM_PAGINA = 120;

export function leerCursorMensaje(texto) {
  if (texto == null || texto === '') return null;
  const partes=String(texto).split('|');
  if (partes.length!==2 || partes[0].length>36 || !/^\d+$/.test(partes[1]))
    throw Object.assign(new Error('Cursor de conversación no válido.'),{status:422});
  const ms=Date.parse(partes[0]);
  if (!Number.isFinite(ms) || BigInt(partes[1])<=0n)
    throw Object.assign(new Error('Cursor de conversación no válido.'),{status:422});
  // Conservar microsegundos: redondear a Date (milisegundos) omitiría mensajes.
  return {fecha:partes[0],id:partes[1]};
}

export async function obtenerHistorialContacto(q, empresaId, contactoId, negociacionId, cursorTexto=null) {
  const antes=leerCursorMensaje(cursorTexto);
  const {rows}=await q(
    'SELECT m.*, to_char(m.ts AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS cursor_preciso, '+
    'a.archivo,a.mime,a.tipo AS archivo_tipo,a.nombre AS archivo_nombre, '+
    "a.bytes AS archivo_bytes,a.ancho,a.alto, CASE WHEN a.id IS NOT NULL THEN '/media/' || "+
    'a.empresa_id || \'/\' || a.archivo ELSE m.media_url END AS media_url, '+
    'nx.creado AS creado_negociacion,nx.titulo AS titulo_negociacion, '+
    'nx.id AS conversacion_id, (nx.id <> $3::uuid) AS anterior '+
    'FROM mensajes m '+
    'JOIN negociaciones nx ON nx.id=m.negociacion_id AND nx.empresa_id=m.empresa_id '+
    'LEFT JOIN archivos a ON a.id=m.archivo_id AND a.empresa_id=m.empresa_id '+
    'WHERE m.empresa_id=$1 AND nx.contacto_id=$2 '+
    'AND ($4::timestamptz IS NULL OR (m.ts,m.id) < ($4::timestamptz,$5::bigint)) '+
    'ORDER BY m.ts DESC,m.id DESC LIMIT $6',
    [empresaId,contactoId,negociacionId,antes?.fecha||null,antes?.id||null,TAM_PAGINA+1]
  );
  const hayAnteriores=rows.length>TAM_PAGINA;
  const mensajes=rows.slice(0,TAM_PAGINA).reverse();
  const primero=mensajes[0];
  return {
    mensajes,
    mensajesHayAnteriores:hayAnteriores,
    mensajesCursorAnterior:hayAnteriores && primero ? (primero.cursor_preciso || new Date(primero.ts).toISOString())+'|'+primero.id : null
  };
}
