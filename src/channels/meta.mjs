/**
 * Canales Meta: WhatsApp Cloud API, Facebook Messenger e Instagram Direct.
 * Comparten webhook, verify token y firma HMAC.
 */
import crypto from 'node:crypto';
import { contactosDeCloud, textoContactos } from '../contactos-compartidos-impar.mjs';
import { contenidoCloud, textoAdjuntoFallido, textoAnuncio, textoReaccion, textoAdjuntoMeta } from '../contenido-whatsapp-impar.mjs';
import { API, traducirError } from '../redes-sociales-impar.mjs';
import { q } from '../db.mjs';
import { guardarDesdeUrl, urlPublica } from '../archivos.mjs';
import { resolverToken } from '../meta-secretos-impar.mjs';
import { encolarWebhookMeta, drenarWebhooksMeta } from '../meta-webhooks-impar.mjs';

// Messenger e Instagram: versión vigente (las anteriores a v24 se ignoran porque Meta las retira).
const WA_API = `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION || 'v26.0'}`;

/* ---------- Verificación (GET) ---------- */
export function verificarWebhook(req, res) {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (modo === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) {
    console.log('✔ Webhook de Meta verificado');
    return res.status(200).send(challenge);
  }
  console.warn('✖ Verificación de webhook rechazada');
  res.sendStatus(403);
}

/* ---------- Firma HMAC ---------- */
export function firmaValida(req) {
  const secreto = process.env.META_APP_SECRET;
  if (!secreto || !req.rawBody) return false;
  const firma = req.headers['x-hub-signature-256'];
  if (!firma) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', secreto).update(req.rawBody).digest('hex');
  try {
    const a = Buffer.from(firma), b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

/* ---------- Recepción (POST) ---------- */
export async function recibirWebhook(req, res) {
  try {
    await encolarWebhookMeta(req.body||{},req.rawBody);
    res.sendStatus(200);
    drenarWebhooksMeta().catch(e=>console.error('[meta] cola:',e.name));
  }catch(e){
    console.error('[meta] recepción no confirmada:',e.name);
    res.sendStatus(e.status===422?422:503);
  }
}
export async function procesarWebhookGuardado(objeto,body){
  if(objeto==='whatsapp_business_account')await procesarWhatsAppAPI(body);
  else if(objeto==='page')await procesarMeta(body,'messenger');
  else if(objeto==='instagram')await procesarMeta(body,'instagram');
}

async function canalPor(tipo, campo, valor) {
  const { rows } = await q(
    `SELECT * FROM canales WHERE tipo=$1 AND activo AND config->>$2 = $3 LIMIT 1`, [tipo, campo, String(valor)]);
  return rows[0] || null;
}

async function guardarInbox(canal, tipo, extId, remitente, nombre, txt, extra = {}) {
  await q(
    `INSERT INTO inbox (empresa_id,canal_id,tipo,ext_id,remitente,nombre,txt,media_url,media_tipo,media_nombre,ubicacion,payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (canal_id, ext_id) DO NOTHING`,
    [canal.empresa_id, canal.id, tipo, extId, String(remitente), nombre || '', txt || '',
     extra.mediaUrl || null, extra.mediaTipo || null, extra.mediaNombre || null,
     extra.ubicacion ? JSON.stringify(extra.ubicacion) : null, JSON.stringify(extra.payload || {})]);
  await q('UPDATE canales SET ultimo_mensaje=now() WHERE id=$1', [canal.id]);

  // Procesar el mensaje apenas se confirma en inbox; el polling queda de respaldo.
  import('../worker.mjs')
    .then(({ drenarInbox }) => drenarInbox())
    .catch(e => console.error('[inbox meta inmediato]', e.message));
}

/* ---------- WhatsApp Cloud API ---------- */
async function procesarWhatsAppAPI(body) {
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const phoneId = v.metadata?.phone_number_id;
      if (!phoneId) continue;
      const canal = await canalPor('whatsapp_api', 'phone_number_id', phoneId);
      if (!canal) { console.warn('[meta] sin canal para phone_number_id', phoneId); continue; }

      for(const estado of v.statuses || [])await registrarEstadoCloud(canal,estado);
      for (const m of v.messages || []) {
        const perfil = (v.contacts || []).find(c => c.wa_id === m.from);
        const { texto, media, ubicacion, especial, citaExt } = await extraerWhatsApp(m, canal);
        if (!texto && !media && !ubicacion) continue;
        // Una reacción cita el mensaje al que reacciona; un mensaje común, el que el cliente respondió.
        const citado = citaExt || m.context?.id;
        await guardarInbox(canal, 'whatsapp_api', m.id, m.from, perfil?.profile?.name || '', texto, {
          mediaUrl: media?.url, mediaTipo: media?.tipo, mediaNombre: media?.nombre, ubicacion,
          payload: { ts: Number(m.timestamp) * 1000, archivoId: media?.id,
            ...(citado ? { cita: { ext: String(citado).slice(0, 180), txt: '', dir: 'in' } } : {}),
            ...(especial ? { especial } : {}),
            ...(m.referral ? { anuncio: textoAnuncio(m.referral) } : {}) }
        });
      }
    }
  }
}

/** Meta entrega acuses asíncronos: HTTP 200 no significa recibido. */
async function registrarEstadoCloud(canal,s){
  if(!s?.id || !['sent','delivered','read','failed'].includes(s.status))return;
  // Mensajes de campañas: su avance se guarda en la campaña, no en la cola de conversación.
  const {registrarEstadoCampana}=await import('../campanas-impar.mjs');
  if(await registrarEstadoCampana(s.id,s.status,s.errors?.[0]?.code))return;
  const ack={sent:2,delivered:3,read:4,failed:0}[s.status];
  const {rows}=await q(
    "INSERT INTO wa_entregas_impar(canal_id,empresa_id,wa_id,ack,estado_meta,error_meta) "+
    "VALUES($1,$2,$3,$4,$5,$6) "+
    "ON CONFLICT(canal_id,wa_id) DO UPDATE SET "+
    "ack=GREATEST(wa_entregas_impar.ack,EXCLUDED.ack), "+
    "estado_meta=CASE WHEN EXCLUDED.ack>=wa_entregas_impar.ack OR EXCLUDED.estado_meta='failed' "+
    "THEN EXCLUDED.estado_meta ELSE wa_entregas_impar.estado_meta END, "+
    "error_meta=CASE WHEN EXCLUDED.estado_meta='failed' THEN EXCLUDED.error_meta ELSE NULL END, "+
    "actualizado=now() RETURNING outbox_id",
    [canal.id,canal.empresa_id,String(s.id),ack,s.status,
     s.status==='failed'?String(s.errors?.[0]?.code||'Meta no entregó').slice(0,60):null]);
  // Fuera de la ventana de 24 h: el mensaje del agente se reenvía solo por la línea normal.
  if(s.status==='failed' && rows[0]?.outbox_id){
    try{
      const {reenviarPorLineaNormal}=await import('../reenvio-linea-normal-impar.mjs');
      const r=await reenviarPorLineaNormal({canalId:canal.id,waId:s.id,codigo:s.errors?.[0]?.code});
      if(r.hecho)return;
    }catch(e){console.warn('[meta:24h] No se pudo reenviar por la línea normal:',e.name);}
  }
  if(rows[0]?.outbox_id){
    const {rows:neg}=await q('SELECT negociacion_id FROM outbox WHERE id=$1 AND empresa_id=$2',
      [rows[0].outbox_id,canal.empresa_id]);
    if(neg[0]?.negociacion_id){
      const {emitir}=await import('../realtime.mjs');
      emitir(canal.empresa_id,'neg:patch',{id:neg[0].negociacion_id});
    }
  }
}

async function extraerWhatsApp(m, canal) {
  let texto = '', media = null, ubicacion = null, especial = null, citaExt = null;
  const simple = contenidoCloud(m);
  if (simple?.omitir) return { texto: '', media, ubicacion };
  if (simple) return { texto: simple.texto || '', media, ubicacion, especial: simple.especial || null, citaExt: simple.citaExt || null };
  switch (m.type) {
    case 'location':
      ubicacion = { lat: m.location?.latitude, lon: m.location?.longitude,
        nombre: m.location?.name || '', direccion: m.location?.address || '' };
      texto = '[ubicación compartida]'; break;
    case 'image': case 'video': case 'audio': case 'document': case 'sticker': {
      const nodo = m[m.type] || {};
      texto = nodo.caption || '';
      if (nodo.id) {
        try { media = await bajarMediaWA(nodo.id, canal, nodo.filename || `${m.type}-${Date.now()}`, nodo.mime_type); }
        catch (e) { console.error('[meta] adjunto:', e.message); }
      }
      // Sin archivo: queda el aviso con qué era y su nombre, más el texto que haya mandado.
      if (!media) texto = [textoAdjuntoFallido(m.type, nodo), texto].filter(Boolean).join('\n');
      break;
    }
    case 'contacts': texto = textoContactos(contactosDeCloud(m.contacts)); break;
  }
  return { texto, media, ubicacion, especial, citaExt };
}

async function bajarMediaWA(mediaId, canal, nombre, mime) {
  const token = resolverToken(canal.config?.token);
  if (!token) throw new Error('canal sin token');
  const meta = await (await fetch(`${WA_API}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  if (!meta.url) throw new Error(meta.error?.message || 'la API no devolvió URL del adjunto');
  const a = await guardarDesdeUrl({
    empresaId: canal.empresa_id, url: meta.url, mime: mime || meta.mime_type,
    nombre, origen: 'cliente', headers: { Authorization: `Bearer ${token}` }
  });
  return { id: a.id, url: a.url, tipo: a.tipo, nombre: a.nombre };
}

/* ---------- Messenger / Instagram ---------- */
async function procesarMeta(body, tipo) {
  for (const entry of body.entry || []) {
    const canal = tipo === 'instagram'
      ? (await canalPor('instagram', 'ig_id', entry.id)) || (await canalPor('instagram', 'page_id', entry.id))
      : await canalPor('messenger', 'page_id', entry.id);
    if (!canal) { console.warn(`[meta] sin canal ${tipo} para`, entry.id); continue; }

    for (const ev of entry.messaging || []) {
      const sid = ev.sender?.id;
      if (!sid || sid === entry.id) continue; // ecos de la propia página
      // Reacción del cliente a un mensaje: queda en la conversación sin pasarla a espera.
      if (ev.reaction?.mid) {
        const nombreR = await nombrePerfil(sid, canal, tipo);
        const emoji = ev.reaction.action === 'unreact' ? '' : (ev.reaction.emoji || ev.reaction.reaction || '');
        await guardarInbox(canal, tipo, `react:${ev.reaction.mid}:${ev.timestamp || Date.now()}`, sid, nombreR, textoReaccion(emoji), {
          payload: { ts: ev.timestamp, especial: 'reaccion', cita: { ext: String(ev.reaction.mid).slice(0, 180), txt: '', dir: 'in' } } });
        continue;
      }
      // Botón o menú tocado por el cliente.
      if (ev.postback && !ev.message) {
        const nombreP = await nombrePerfil(sid, canal, tipo);
        await guardarInbox(canal, tipo, ev.postback.mid || `postback:${sid}:${ev.timestamp}`, sid, nombreP,
          ev.postback.title || ev.postback.payload || 'Tocó un botón', { payload: { ts: ev.timestamp, ...(ev.postback.referral ? { anuncio: textoAnuncio(ev.postback.referral) } : {}) } });
        continue;
      }
      if (!ev.message || ev.message.is_echo) continue;

      const texto = ev.message.text || '';
      const adj = ev.message.attachments || [];
      let ubicacion = null;
      const loc = adj.find(a => a.type === 'location');
      if (loc?.payload?.coordinates) {
        ubicacion = { lat: loc.payload.coordinates.lat, lon: loc.payload.coordinates.long,
          nombre: loc.title || '', direccion: loc.url || '' };
      }
      const media = ubicacion ? null : await bajarMediaMeta(adj, canal);
      const extraAdj = !media && !ubicacion && adj.length ? textoAdjuntoMeta(adj) : '';
      const textoFinal = [texto, extraAdj].filter(Boolean).join('\n') || (ubicacion ? '[ubicación compartida]' : '');
      if (!textoFinal && !media && !ubicacion) continue;

      const nombre = await nombrePerfil(sid, canal, tipo);
      const citado = ev.message.reply_to?.mid;
      await guardarInbox(canal, tipo, ev.message.mid, sid, nombre, textoFinal, {
        mediaUrl: media?.url, mediaTipo: media?.tipo, mediaNombre: media?.nombre, ubicacion,
        payload: { ts: ev.timestamp, archivoId: media?.id,
          ...(citado ? { cita: { ext: String(citado).slice(0, 180), txt: '', dir: 'in' } } : {}),
          ...(ev.message.referral || ev.referral ? { anuncio: textoAnuncio(ev.message.referral || ev.referral) } : {}) }
      });
    }
  }
}

async function bajarMediaMeta(adjuntos, canal) {
  const a = (adjuntos || []).find(x => ['image', 'video', 'audio', 'file'].includes(x.type));
  if (!a?.payload?.url) return null;
  const MIMES = { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/mpeg', file: 'application/pdf' };
  try {
    const g = await guardarDesdeUrl({
      empresaId: canal.empresa_id, url: a.payload.url, mime: MIMES[a.type],
      nombre: `${a.type}-${Date.now()}`, origen: 'cliente'
    });
    return { id: g.id, url: g.url, tipo: g.tipo, nombre: g.nombre };
  } catch (e) { console.error('[meta] adjunto no descargado:', e.message); return null; }
}

// Messenger no tiene «username» (pedirlo hace fallar toda la consulta); Instagram sí.
async function nombrePerfil(id, canal, tipo) {
  try {
    const token = resolverToken(canal.config?.token);
    if (!token) return '';
    const campos = tipo === 'instagram' ? 'name,username' : 'first_name,last_name,name';
    const r = await fetch(`${API}/${encodeURIComponent(id)}?fields=${campos}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return j.name || [j.first_name, j.last_name].filter(Boolean).join(' ') || (j.username ? '@' + j.username : '');
  } catch (e) { return ''; }
}

/* ---------- ENVÍO ---------- */
export async function enviarWhatsAppAPI(canal, destino, texto, adjunto, opciones = {}) {
  const { phone_number_id } = canal.config || {};
  const token = resolverToken(canal.config?.token);
  if (!token || !phone_number_id) throw new Error('canal sin token o phone_number_id');
  const prefijo = canal.config.prefijoPais || process.env.PREFIJO_PAIS || '595';
  let num = String(destino).replace(/\D/g, '');
  if (num.length <= 10 && !num.startsWith(prefijo)) num = prefijo + num.replace(/^0/, '');

  // Respuesta citada: solo el primer envío lleva el contexto del mensaje original.
  let contexto = opciones?.cita?.ext ? { context: { message_id: String(opciones.cita.ext) } } : {};
  const post = async cuerpo => {
    const extra = contexto; contexto = {};
    const r = await fetch(`${WA_API}/${phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: num, ...extra, ...cuerpo })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'error de WhatsApp Cloud API');
    return j;
  };

  if (adjunto) {
    const link = urlPublica(adjunto.url);
    if (!/^https:/.test(link)) throw new Error('PUBLIC_URL debe ser HTTPS para enviar adjuntos por Cloud API');
    const CLAVE = { imagen: 'image', video: 'video', audio: 'audio', documento: 'document' };
    const k = CLAVE[adjunto.tipo] || 'document';
    const cuerpo = { type: k, [k]: { link } };
    if (k !== 'audio' && texto) cuerpo[k].caption = texto;
    if (k === 'document') cuerpo[k].filename = adjunto.nombre;
    const res = await post(cuerpo);
    if (k === 'audio' && texto) await post({ type: 'text', text: { body: texto } });
    return res;
  }
  return post({ type: 'text', text: { body: texto } });
}

export async function enviarMeta(canal, destino, texto, adjunto) {
  const { page_id } = canal.config || {};
  const token = resolverToken(canal.config?.token);
  if (!token) throw new Error('canal sin token');
  const post = async mensaje => {
    const r = await fetch(`${API}/${page_id || 'me'}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: String(destino) }, message: mensaje, messaging_type: 'RESPONSE' })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(traducirError(j.error));
    return j;
  };
  if (adjunto) {
    const link = urlPublica(adjunto.url);
    if (!/^https:/.test(link)) throw new Error('PUBLIC_URL debe ser HTTPS para enviar adjuntos por Meta');
    const TIPO = { imagen: 'image', video: 'video', audio: 'audio', documento: 'file' };
    const res = await post({ attachment: { type: TIPO[adjunto.tipo] || 'file', payload: { url: link, is_reusable: true } } });
    if (texto) await post({ text: texto });
    return res;
  }
  return post({ text: texto });
}

/* ---------- Prueba de credenciales ---------- */
export async function probarCanal(canal) {
  const { phone_number_id, page_id, ig_id } = canal.config || {};
  const token = resolverToken(canal.config?.token);
  if (!token) return { ok: false, error: 'Falta el token de acceso.' };
  const destino = canal.tipo === 'whatsapp_api'
    ? `${WA_API}/${phone_number_id}?fields=display_phone_number,verified_name,quality_rating`
    : `${API}/${canal.tipo === 'instagram' ? (ig_id || page_id) : (page_id || ig_id)}?fields=name,username`;
  try {
    const r = await fetch(destino, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || 'Credenciales inválidas.' };
    return { ok: true, info: j,
      numero: j.display_phone_number || '', nombre: j.verified_name || j.name || j.username || '' };
  } catch (e) { return { ok: false, error: e.message }; }
}
