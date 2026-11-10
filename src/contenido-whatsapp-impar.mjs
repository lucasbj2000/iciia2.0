/* IMPAR · Todo lo que el cliente manda por WhatsApp (línea verificada o normal), Messenger o Instagram
   se muestra en español y completo: nunca un «[reaction recibido]».
   «especial» marca lo que no es un mensaje común:
   - reaccion: el cliente reaccionó con un emoji. Queda en la conversación, citando el mensaje,
     pero NO pasa la negociación a «Cliente espera respuesta» ni cuenta en los tiempos de respuesta.
   - sistema: aviso de WhatsApp (cambió de número, de teléfono…). Mismo trato que la reacción.
   - llamada: llamada de WhatsApp al número normal; el CRM no atiende llamadas, así que sí queda en espera.
   - no_admitido: WhatsApp no entregó el contenido (encuesta, mensaje de una sola vez…); queda en espera. */

export const INFORMATIVOS = new Set(['reaccion', 'sistema']);

const NOMBRES = {
  text: 'mensaje', image: 'imagen', video: 'video', audio: 'audio', voice: 'nota de voz', document: 'documento',
  sticker: 'sticker', location: 'ubicación', contacts: 'contacto', reaction: 'reacción', button: 'botón',
  interactive: 'respuesta de un menú', order: 'pedido', system: 'aviso de WhatsApp', unsupported: 'mensaje no compatible',
  request_welcome: 'inicio de conversación', file: 'archivo', share: 'contenido compartido', story_mention: 'mención en una historia',
  ig_reel: 'reel de Instagram', reel: 'reel', ig_post: 'publicación de Instagram', fallback: 'enlace', template: 'tarjeta',
  poll: 'encuesta', event: 'evento', product: 'producto', edit: 'mensaje editado', revoke: 'mensaje eliminado'
};
export const nombreTipo = t => NOMBRES[t] || 'mensaje';

const gs = (monto, moneda) => {
  const n = Number(monto);
  if (!Number.isFinite(n)) return '';
  if (!moneda || moneda === 'PYG') return 'Gs ' + Math.round(n).toLocaleString('es-PY');
  return `${moneda} ${n.toLocaleString('es-PY', { maximumFractionDigits: 2 })}`;
};
const recorta = (t, n = 300) => { const s = String(t ?? '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** Texto de una reacción (emoji vacío = la quitó). */
export function textoReaccion(emoji) {
  const e = String(emoji || '').trim();
  return e ? `Reaccionó con ${e}` : 'Quitó su reacción';
}

/** Respuesta de un formulario de WhatsApp (Flows): campo por campo, sin el token interno. */
export function textoFormulario(nfm) {
  let datos = null;
  try { datos = typeof nfm?.response_json === 'string' ? JSON.parse(nfm.response_json) : nfm?.response_json; } catch { datos = null; }
  const filas = datos && typeof datos === 'object'
    ? Object.entries(datos).filter(([k]) => k !== 'flow_token').slice(0, 25)
      .map(([k, v]) => `• ${k.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase())}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
    : [];
  return ['📝 Formulario enviado' + (nfm?.name && nfm.name !== 'flow' ? ` (${nfm.name})` : ''), ...filas].join('\n')
    || nfm?.body || '📝 Formulario enviado';
}

/** Pedido del catálogo de WhatsApp: artículos, cantidades, precios y total. */
export function textoPedido(order) {
  const items = Array.isArray(order?.product_items) ? order.product_items : [];
  const total = items.reduce((s, i) => s + (Number(i.item_price) || 0) * (Number(i.quantity) || 1), 0);
  const moneda = items[0]?.currency;
  const lineas = items.slice(0, 40).map(i =>
    `• ${Number(i.quantity) || 1} × ${i.product_retailer_id || 'artículo'}${i.item_price != null ? ` — ${gs(i.item_price, i.currency)}` : ''}`);
  return [`🛒 Pedido del catálogo (${items.length} ${items.length === 1 ? 'artículo' : 'artículos'})`, ...lineas,
    items.length ? `Total: ${gs(total, moneda)}` : '', order?.text ? `Nota del cliente: ${recorta(order.text, 500)}` : '']
    .filter(Boolean).join('\n');
}

/** Aviso de sistema de WhatsApp, en español. */
export function textoSistema(sys) {
  if (sys?.type === 'customer_changed_number' || sys?.type === 'user_changed_number')
    return `ℹ️ El cliente cambió su número de WhatsApp${sys.new_wa_id || sys.wa_id ? ` a +${sys.new_wa_id || sys.wa_id}` : ''}.`;
  if (sys?.type === 'customer_identity_changed' || sys?.type === 'user_identity_changed')
    return 'ℹ️ El cliente reinstaló WhatsApp o cambió de teléfono.';
  return `ℹ️ Aviso de WhatsApp${sys?.body ? ': ' + recorta(sys.body, 200) : '.'}`;
}

/** Contenido que WhatsApp no entrega por la API (encuestas, mensajes de una sola vez, ediciones…). */
export function textoNoAdmitido(m) {
  const det = m?.errors?.[0]?.error_data?.details || m?.unsupported?.type || '';
  const que = /poll/i.test(det) ? 'una encuesta' : /view.?once/i.test(det) ? 'un mensaje de una sola vez'
    : /edit/i.test(det) ? 'una edición de un mensaje' : /(delete|revoke)/i.test(det) ? 'la eliminación de un mensaje'
    : /event/i.test(det) ? 'un evento' : 'un tipo de mensaje';
  return `⚠️ El cliente envió ${que} que WhatsApp no permite ver en el CRM. Pedile que lo mande como texto o imagen.`;
}

/** Aviso cuando no se pudo bajar un adjunto: dice qué era y cómo se llamaba. */
export function textoAdjuntoFallido(tipo, nodo = {}) {
  const t = tipo === 'audio' && nodo.voice ? 'voice' : tipo;
  const nombre = nodo.filename ? `: ${recorta(nodo.filename, 80)}` : '';
  return `📎 El cliente envió ${['imagen', 'nota de voz'].includes(nombreTipo(t)) ? 'una' : 'un'} ${nombreTipo(t)}${nombre} que no se pudo descargar. Pedile que lo reenvíe.`;
}

/**
 * WhatsApp Cloud API: tipos sin adjunto. Devuelve { texto, especial, citaExt, omitir } o null si es multimedia.
 * citaExt: id del mensaje de WhatsApp al que se refiere (reacciones).
 */
export function contenidoCloud(m) {
  switch (m?.type) {
    case 'text': return { texto: m.text?.body || '' };
    case 'reaction': return { texto: textoReaccion(m.reaction?.emoji), especial: 'reaccion', citaExt: m.reaction?.message_id || null };
    case 'button': return { texto: m.button?.text || m.button?.payload || '' };
    case 'interactive': {
      const i = m.interactive || {};
      if (i.button_reply) return { texto: i.button_reply.title || i.button_reply.id || '' };
      if (i.list_reply) return { texto: [i.list_reply.title, i.list_reply.description].filter(Boolean).join(' — ') };
      if (i.nfm_reply) return { texto: textoFormulario(i.nfm_reply) };
      return { texto: `Respondió un menú${i.type ? ` (${i.type})` : ''}` };
    }
    case 'order': return { texto: textoPedido(m.order) };
    case 'system': return { texto: textoSistema(m.system), especial: 'sistema' };
    case 'unsupported': return { texto: textoNoAdmitido(m), especial: 'no_admitido' };
    case 'request_welcome': return { omitir: true };
    case 'image': case 'video': case 'audio': case 'document': case 'sticker': case 'location': case 'contacts': return null;
    default: return { texto: `⚠️ El cliente envió ${nombreTipo(m?.type) === 'mensaje' ? 'un tipo de mensaje' : 'un ' + nombreTipo(m.type)} que el CRM todavía no muestra. Pedile que lo reenvíe.`, especial: 'no_admitido' };
  }
}

/** Anuncio de Meta desde el que llegó el cliente (clic a WhatsApp/Messenger). */
export function textoAnuncio(ref) {
  if (!ref) return '';
  const titulo = recorta(ref.headline || ref.ads_context_data?.ad_title || '', 120);
  const origen = ref.source_type === 'post' ? 'una publicación' : 'un anuncio';
  return `📣 El cliente llegó desde ${origen} de Meta${titulo ? ` «${titulo}»` : ''}${ref.source_url ? ` · ${ref.source_url}` : ''}`;
}

/** WhatsApp normal (Baileys): contenidos especiales en texto. */
export function contenidoBaileys(c) {
  if (!c) return null;
  if (c.reactionMessage) return { texto: textoReaccion(c.reactionMessage.text), especial: 'reaccion', citaExt: c.reactionMessage.key?.id || null };
  const enc = c.pollCreationMessage || c.pollCreationMessageV2 || c.pollCreationMessageV3 || c.pollCreationMessageV4;
  if (enc) return { texto: [`📊 Encuesta: ${recorta(enc.name, 200)}`, ...(enc.options || []).slice(0, 12).map(o => `• ${recorta(o.optionName, 80)}`)].join('\n') };
  if (c.eventMessage) {
    const e = c.eventMessage, ini = Number(e.startTime?.toNumber?.() ?? e.startTime);
    const cuando = Number.isFinite(ini) && ini > 0 ? new Date(ini * 1000).toLocaleString('es-PY', { timeZone: 'America/Asuncion', dateStyle: 'medium', timeStyle: 'short' }) : '';
    return { texto: [`📅 Evento: ${recorta(e.name, 160)}`, cuando, e.location?.name ? `Lugar: ${e.location.name}` : '', e.description ? recorta(e.description, 300) : ''].filter(Boolean).join('\n') };
  }
  if (c.productMessage) {
    const p = c.productMessage.product || {};
    const precio = p.priceAmount1000 != null ? gs(Number(p.priceAmount1000?.toNumber?.() ?? p.priceAmount1000) / 1000, p.currencyCode) : '';
    return { texto: [`🛍️ Producto: ${recorta(p.title || 'sin nombre', 160)}`, precio, p.description ? recorta(p.description, 300) : '', p.url || ''].filter(Boolean).join('\n') };
  }
  if (c.orderMessage) {
    const o = c.orderMessage;
    return { texto: [`🛒 Pedido del catálogo (${o.itemCount || 0} ${Number(o.itemCount) === 1 ? 'artículo' : 'artículos'})`,
      o.totalAmount1000 != null ? `Total: ${gs(Number(o.totalAmount1000?.toNumber?.() ?? o.totalAmount1000) / 1000, o.totalCurrencyCode)}` : '',
      o.message ? `Nota del cliente: ${recorta(o.message, 300)}` : ''].filter(Boolean).join('\n') };
  }
  if (c.groupInviteMessage) return { texto: `👥 Invitación a un grupo de WhatsApp: ${recorta(c.groupInviteMessage.groupName || '', 120)}` };
  if (c.callLogMesssage || c.callLogMessage) return { texto: '📞 Llamada de WhatsApp', especial: 'llamada' };
  if (c.pollUpdateMessage) return { omitir: true }; // votos cifrados de una encuesta propia: no aportan texto
  return null;
}

/** Messenger/Instagram: adjuntos sin archivo, en texto completo. */
export function textoAdjuntoMeta(adj) {
  const a = (adj || [])[0];
  if (!a) return '';
  const p = a.payload || {};
  if (a.type === 'fallback' || a.type === 'share') return `🔗 Compartió: ${[p.title || a.title, p.url].filter(Boolean).join(' · ') || 'un enlace'}`;
  if (a.type === 'story_mention') return `📣 Te mencionó en su historia${p.url ? ' · ' + p.url : ''}`;
  if (a.type === 'ig_reel' || a.type === 'reel') return `🎬 Compartió un reel${p.title ? ': ' + recorta(p.title, 160) : ''}${p.url ? ' · ' + p.url : ''}`;
  if (a.type === 'ig_post') return `🖼️ Compartió una publicación${p.title ? ': ' + recorta(p.title, 160) : ''}${p.url ? ' · ' + p.url : ''}`;
  if (a.type === 'template') return `🧾 ${recorta(p.generic?.elements?.[0]?.title || p.text || 'Tarjeta compartida', 160)}`;
  if (a.type === 'location') return '📍 Ubicación compartida';
  return `📎 El cliente envió ${nombreTipo(a.type) === 'mensaje' ? 'un adjunto' : 'un ' + nombreTipo(a.type)} que no se pudo descargar.`;
}
