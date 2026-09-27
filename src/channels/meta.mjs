/**
 * Canales Meta: WhatsApp Cloud API, Facebook Messenger e Instagram Direct.
 * Comparten webhook, verify token y firma HMAC.
 */
import crypto from 'node:crypto';
import { q } from '../db.mjs';
import { guardarDesdeUrl, urlPublica } from '../archivos.mjs';

const GRAPH = process.env.GRAPH_VERSION || 'v21.0';
const API = `https://graph.facebook.com/${GRAPH}`;

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
  if (!secreto) return true;
  const firma = req.headers['x-hub-signature-256'];
  if (!firma || !req.rawBody) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', secreto).update(req.rawBody).digest('hex');
  try {
    const a = Buffer.from(firma), b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

/* ---------- Recepción (POST) ---------- */
export async function recibirWebhook(req, res) {
  res.sendStatus(200);
  const body = req.body || {};
  try {
    if (body.object === 'whatsapp_business_account') await procesarWhatsAppAPI(body);
    else if (body.object === 'page') await procesarMeta(body, 'messenger');
    else if (body.object === 'instagram') await procesarMeta(body, 'instagram');
  } catch (e) { console.error('[meta] webhook:', e.message); }
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

      for (const m of v.messages || []) {
        const perfil = (v.contacts || []).find(c => c.wa_id === m.from);
        const { texto, media, ubicacion } = await extraerWhatsApp(m, canal);
        if (!texto && !media && !ubicacion) continue;
        await guardarInbox(canal, 'whatsapp_api', m.id, m.from, perfil?.profile?.name || '', texto, {
          mediaUrl: media?.url, mediaTipo: media?.tipo, mediaNombre: media?.nombre, ubicacion,
          payload: { ts: Number(m.timestamp) * 1000, archivoId: media?.id }
        });
      }
    }
  }
}

async function extraerWhatsApp(m, canal) {
  let texto = '', media = null, ubicacion = null;
  switch (m.type) {
    case 'text': texto = m.text?.body || ''; break;
    case 'button': texto = m.button?.text || ''; break;
    case 'interactive':
      texto = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || ''; break;
    case 'location':
      ubicacion = { lat: m.location?.latitude, lon: m.location?.longitude,
        nombre: m.location?.name || '', direccion: m.location?.address || '' };
      texto = '[ubicación compartida]'; break;
    case 'image': case 'video': case 'audio': case 'document': case 'sticker': {
      texto = m[m.type]?.caption || '';
      const nodo = m[m.type] || {};
      if (nodo.id) {
        try { media = await bajarMediaWA(nodo.id, canal, nodo.filename || `${m.type}-${Date.now()}`, nodo.mime_type); }
        catch (e) { console.error('[meta] adjunto:', e.message); texto = texto || `[${m.type} recibido]`; }
      }
      break;
    }
    default: texto = `[${m.type} recibido]`;
  }
  return { texto, media, ubicacion };
}

async function bajarMediaWA(mediaId, canal, nombre, mime) {
  const token = canal.config?.token;
  if (!token) throw new Error('canal sin token');
  const meta = await (await fetch(`${API}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } })).json();
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
      if (!ev.message || ev.message.is_echo) continue;
      const sid = ev.sender?.id;
      if (!sid) continue;

      const texto = ev.message.text || '';
      const adj = ev.message.attachments || [];
      let ubicacion = null;
      const loc = adj.find(a => a.type === 'location');
      if (loc?.payload?.coordinates) {
        ubicacion = { lat: loc.payload.coordinates.lat, lon: loc.payload.coordinates.long,
          nombre: loc.title || '', direccion: loc.url || '' };
      }
      const media = ubicacion ? null : await bajarMediaMeta(adj, canal);
      if (!texto && !media && !ubicacion) continue;

      const nombre = await nombrePerfil(sid, canal);
      await guardarInbox(canal, tipo, ev.message.mid, sid, nombre,
        texto || (ubicacion ? '[ubicación compartida]' : (media ? '' : descripcionAdjunto(adj))), {
        mediaUrl: media?.url, mediaTipo: media?.tipo, mediaNombre: media?.nombre, ubicacion,
        payload: { ts: ev.timestamp, archivoId: media?.id }
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

function descripcionAdjunto(adj) {
  if (!adj || !adj.length) return '';
  return ({ image: '[imagen recibida]', video: '[video recibido]', audio: '[audio recibido]',
    file: '[archivo recibido]', share: '[contenido compartido]', story_mention: '[mención en historia]',
    location: '[ubicación compartida]' })[adj[0].type] || `[${adj[0].type} recibido]`;
}

async function nombrePerfil(id, canal) {
  try {
    const token = canal.config?.token;
    if (!token) return '';
    const r = await fetch(`${API}/${id}?fields=name,username&access_token=${encodeURIComponent(token)}`);
    const j = await r.json();
    return j.name || j.username || '';
  } catch (e) { return ''; }
}

/* ---------- ENVÍO ---------- */
export async function enviarWhatsAppAPI(canal, destino, texto, adjunto) {
  const { token, phone_number_id } = canal.config || {};
  if (!token || !phone_number_id) throw new Error('canal sin token o phone_number_id');
  const prefijo = canal.config.prefijoPais || process.env.PREFIJO_PAIS || '595';
  let num = String(destino).replace(/\D/g, '');
  if (num.length <= 10 && !num.startsWith(prefijo)) num = prefijo + num.replace(/^0/, '');

  const post = async cuerpo => {
    const r = await fetch(`${API}/${phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: num, ...cuerpo })
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
  const { token, page_id } = canal.config || {};
  if (!token) throw new Error('canal sin token');
  const post = async mensaje => {
    const r = await fetch(`${API}/${page_id || 'me'}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: String(destino) }, message: mensaje, messaging_type: 'RESPONSE' })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'error de Meta Send API');
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
  const { token, phone_number_id, page_id, ig_id } = canal.config || {};
  if (!token) return { ok: false, error: 'Falta el token de acceso.' };
  const destino = canal.tipo === 'whatsapp_api'
    ? `${API}/${phone_number_id}?fields=display_phone_number,verified_name,quality_rating`
    : `${API}/${ig_id || page_id}?fields=name,username`;
  try {
    const r = await fetch(destino, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || 'Credenciales inválidas.' };
    return { ok: true, info: j,
      numero: j.display_phone_number || '', nombre: j.verified_name || j.name || j.username || '' };
  } catch (e) { return { ok: false, error: e.message }; }
}
