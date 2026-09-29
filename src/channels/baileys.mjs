/**
 * Canal WhatsApp por QR (Baileys · WhatsApp Web multi-dispositivo).
 * Una sesión por canal, credenciales en disco, reconexión automática.
 */
import QRCode from 'qrcode';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { q } from '../db.mjs';
import { emitir } from '../realtime.mjs';
import { notificar } from '../core.mjs';
import { guardarBuffer, MEDIA_DIR } from '../archivos.mjs';

const AUTH_DIR = process.env.WA_AUTH_DIR || './auth';
if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });

const sesiones = new Map();
let B = null, cargaFallida = false;

async function cargarBaileys() {
  if (B) return B;
  if (cargaFallida) return null;
  try {
    const mod = await import('@whiskeysockets/baileys');
    B = mod;
    return B;
  } catch (e) {
    cargaFallida = true;
    console.warn('⚠ Baileys no disponible: el canal WhatsApp QR queda deshabilitado.', e.message);
    return null;
  }
}
const crearSocket = (mod, opts) => (typeof mod.default === 'function' ? mod.default : mod.makeWASocket)(opts);

export function estadoSesion(canalId) {
  const s = sesiones.get(canalId);
  return s ? { estado: s.estado, qr: s.qr, numero: s.numero, error: s.error || null }
           : { estado: 'desconectado', qr: null, numero: '', error: null };
}

export async function iniciar(canal) {
  const mod = await cargarBaileys();
  if (!mod) throw new Error('Baileys no está instalado en el servidor (npm i @whiskeysockets/baileys)');

  const id = canal.id;
  let S = sesiones.get(id);
  if (S && (S.arrancando || S.estado === 'conectado')) return estadoSesion(id);
  if (!S) { S = { sock: null, estado: 'desconectado', qr: null, numero: '', intentos: 0 }; sesiones.set(id, S); }
  S.arrancando = true; S.error = null;

  try {
    const carpeta = join(AUTH_DIR, String(id));
    const { state, saveCreds } = await mod.useMultiFileAuthState(carpeta);
    let version;
    try { ({ version } = await mod.fetchLatestBaileysVersion()); } catch (e) { version = undefined; }

    const sock = crearSocket(mod, {
      ...(version ? { version } : {}),
      auth: state,
      printQRInTerminal: false,
      browser: ['iciia2.0', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });
    S.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async u => {
      const { connection, lastDisconnect, qr } = u;
      try {
        if (qr) {
          S.qr = await QRCode.toDataURL(qr, { margin: 1, width: 460, errorCorrectionLevel: 'M' });
          S.estado = 'pendiente';
          await actualizar(id, 'pendiente', '');
          emitir(canal.empresa_id, 'canal:qr', { canalId: id, qr: S.qr });
        }
        if (connection === 'open') {
          S.estado = 'conectado'; S.qr = null; S.intentos = 0;
          S.numero = (sock.user?.id || '').split(':')[0];
          await actualizar(id, 'conectado', S.numero, true);
          emitir(canal.empresa_id, 'canal:estado', { canalId: id, estado: 'conectado', numero: S.numero });
          await avisar(canal, 'conectada');
          console.log(`[wa:${canal.nombre}] conectado como ${S.numero}`);
        }
        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          S.estado = 'desconectado'; S.arrancando = false;
          await actualizar(id, 'desconectado', S.numero);
          emitir(canal.empresa_id, 'canal:estado', { canalId: id, estado: 'desconectado' });
          if (code !== mod.DisconnectReason?.loggedOut) {
            S.intentos = Math.min(S.intentos + 1, 6);
            const espera = Math.min(3000 * 2 ** (S.intentos - 1), 60000);
            console.log(`[wa:${canal.nombre}] cerrado (${code}) · reintento en ${espera / 1000}s`);
            setTimeout(() => iniciar(canal).catch(e => console.error(e.message)), espera);
          } else {
            rmSync(carpeta, { recursive: true, force: true });
            S.qr = null;
            await avisar(canal, 'desvinculada');
          }
        }
      } catch (e) { console.error(`[wa:${canal.nombre}] update:`, e.message); }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        try { await recibir(mod, m, canal, id); }
        catch (e) { console.error(`[wa:${canal.nombre}] recibir:`, e.message); }
      }
    });
  } catch (e) {
    S.arrancando = false; S.estado = 'error'; S.error = e.message;
    await q('UPDATE canales SET estado=$2, ultimo_error=$3 WHERE id=$1', [id, 'error', e.message]);
    throw e;
  }
  S.arrancando = false;
  return estadoSesion(id);
}

async function recibir(mod, m, canal, id) {
  if (m.key.fromMe) return;
  const jid = m.key.remoteJid || '';
  if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;

  /*
   * WhatsApp moderno puede entregar DMs con un JID @lid. Si Baileys trae
   * también el PN alternativo, usamos el teléfono para conservar la identidad
   * existente. Si no existe PN, preservamos el @lid completo para poder
   * responder al mismo chat sin inventar un @s.whatsapp.net inválido.
   */
  const alternos = [
    m.key.remoteJidAlt,
    m.key.senderPn,
    m.key.participantPn,
    m.key.participantAlt
  ].filter(Boolean);
  const pnJid = jid.endsWith('@s.whatsapp.net')
    ? jid
    : alternos.find(x => String(x).endsWith('@s.whatsapp.net'));
  const remitente = pnJid ? String(pnJid).split('@')[0] : jid;

  const texto = m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    m.message?.documentMessage?.caption || '';

  /* ubicación nativa */
  let ubicacion = null;
  const loc = m.message?.locationMessage || m.message?.liveLocationMessage;
  if (loc) ubicacion = { lat: loc.degreesLatitude, lon: loc.degreesLongitude,
    nombre: loc.name || '', direccion: loc.address || '' };

  /* adjunto */
  let media = null;
  try { media = await bajarMedia(mod, m, canal); }
  catch (e) { console.error(`[wa:${canal.nombre}] adjunto:`, e.message); }

  const etiqueta = texto || (ubicacion ? '[ubicación compartida]' : (media ? '' : especial(m)));
  if (!etiqueta && !media && !ubicacion) return;

  await q(
    `INSERT INTO inbox (empresa_id,canal_id,tipo,ext_id,remitente,nombre,txt,media_url,media_tipo,media_nombre,ubicacion,payload)
     VALUES ($1,$2,'whatsapp_qr',$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (canal_id, ext_id) DO NOTHING`,
    [canal.empresa_id, id, m.key.id, remitente, m.pushName || '', etiqueta,
     media?.url || null, media?.tipo || null, media?.nombre || null,
     ubicacion ? JSON.stringify(ubicacion) : null,
     JSON.stringify({ ts: Number(m.messageTimestamp) * 1000, archivoId: media?.id || null })]);
  await q('UPDATE canales SET ultimo_mensaje=now() WHERE id=$1', [id]);

  // Despierta el worker inmediatamente; el polling periódico queda como respaldo.
  import('../worker.mjs')
    .then(({ drenarInbox }) => drenarInbox())
    .catch(e => console.error('[inbox inmediato]', e.message));
}

function especial(m) {
  if (m.message?.stickerMessage) return '[sticker recibido]';
  if (m.message?.contactMessage) return '[contacto compartido]';
  if (m.message?.pollCreationMessage) return '[encuesta recibida]';
  return '';
}

async function bajarMedia(mod, m, canal) {
  const tipos = [['imageMessage', 'imagen', 'image'], ['videoMessage', 'video', 'video'],
    ['audioMessage', 'audio', 'audio'], ['documentMessage', 'documento', 'document'],
    ['stickerMessage', 'imagen', 'sticker']];
  const par = tipos.find(([k]) => m.message?.[k]);
  if (!par) return null;
  const [clave, tipo, kind] = par;
  const nodo = m.message[clave];
  if (!mod.downloadContentFromMessage) return null;

  const stream = await mod.downloadContentFromMessage(nodo, kind);
  const partes = [];
  for await (const t of stream) partes.push(t);
  const buffer = Buffer.concat(partes);
  if (!buffer.length) return null;

  const mime = (nodo.mimetype || 'application/octet-stream').split(';')[0];
  const nombre = nodo.fileName || `${tipo}-${Date.now()}`;
  const a = await guardarBuffer({
    empresaId: canal.empresa_id, buffer, mime, nombre, origen: 'cliente',
    dims: { ancho: nodo.width || null, alto: nodo.height || null }
  });
  return { id: a.id, url: a.url, tipo: a.tipo, nombre: a.nombre };
}

export async function enviar(canal, destino, texto, adjunto) {
  const S = sesiones.get(canal.id);
  if (!S || S.estado !== 'conectado') throw new Error('sesión de WhatsApp no conectada');
  const prefijo = canal.config?.prefijoPais || process.env.PREFIJO_PAIS || '595';
  const bruto = String(destino || '').trim();
  let jid;
  if (bruto.includes('@')) {
    // Un @lid válido debe conservarse tal cual; no convertirlo a un teléfono falso.
    jid = bruto;
  } else {
    let num = bruto.replace(/\D/g, '');
    if (num.length <= 10 && !num.startsWith(prefijo)) num = prefijo + num.replace(/^0/, '');
    if (!num) throw new Error('destinatario de WhatsApp vacío');
    jid = `${num}@s.whatsapp.net`;
  }

  if (adjunto) {
    const bin = readFileSync(join(MEDIA_DIR, String(canal.empresa_id), adjunto.archivo));
    const pie = texto || undefined;
    const contenido =
      adjunto.tipo === 'imagen' ? { image: bin, caption: pie }
      : adjunto.tipo === 'video' ? { video: bin, caption: pie }
      : adjunto.tipo === 'audio' ? { audio: bin, mimetype: adjunto.mime }
      : { document: bin, mimetype: adjunto.mime, fileName: adjunto.nombre, caption: pie };
    await S.sock.sendMessage(jid, contenido);
    if (adjunto.tipo === 'audio' && texto) await S.sock.sendMessage(jid, { text: texto });
    return true;
  }
  await S.sock.sendMessage(jid, { text: texto });
  return true;
}

export async function desvincular(canal) {
  const S = sesiones.get(canal.id);
  try { await S?.sock?.logout(); } catch (e) {}
  try { S?.sock?.end?.(); } catch (e) {}
  rmSync(join(AUTH_DIR, String(canal.id)), { recursive: true, force: true });
  sesiones.delete(canal.id);
  await actualizar(canal.id, 'desconectado', '');
}

const actualizar = (id, estado, numero, marcar) =>
  q(`UPDATE canales SET estado=$2, numero=COALESCE(NULLIF($3,''),numero)
      ${marcar ? ', ultima_conexion=now(), ultimo_error=NULL' : ''} WHERE id=$1`,
    [id, estado, numero || '']);

async function avisar(canal, estado) {
  const { rows } = await q('SELECT * FROM empresas WHERE id=$1', [canal.empresa_id]);
  if (rows[0]) await notificar(rows[0], 'canal', { canal: canal.nombre, estado }, []);
}

/** Pre-levanta las sesiones ya vinculadas y las vigila. */
export async function prelevantar() {
  const mod = await cargarBaileys();
  if (!mod) return;
  const { rows } = await q("SELECT * FROM canales WHERE tipo='whatsapp_qr' AND activo");
  for (const c of rows) {
    if (!existsSync(join(AUTH_DIR, String(c.id)))) continue;
    console.log('› pre-levantando WhatsApp:', c.nombre);
    iniciar(c).catch(e => console.error(e.message));
  }
  setInterval(async () => {
    try {
      const { rows: cs } = await q("SELECT * FROM canales WHERE tipo='whatsapp_qr' AND activo");
      for (const c of cs) {
        const S = sesiones.get(c.id);
        if (existsSync(join(AUTH_DIR, String(c.id))) && (!S || (S.estado !== 'conectado' && !S.arrancando))) {
          iniciar(c).catch(() => {});
        }
      }
    } catch (e) {}
  }, 60000);
}

export const disponible = async () => !!(await cargarBaileys());
