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
import { guardarOriginal, recuperarOriginal } from '../wa-reintentos.mjs';
import { crearCacheContadorReintentos } from '../wa-cache-reintentos.mjs';
import { registrarActualizacionImpar } from '../wa-entregas-impar.mjs';
import { registrarParejaWA, parejaDesdeEventoWA, validarParejaWA, rutaParaEnvioWA, resolverRemitenteWA } from '../wa-identidades-impar.mjs';

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
  return s ? { estado: s.estado, qr: s.qr, numero: s.numero, error: s.error || null,
                 entradaUltima: s.entradaUltima || null,
                 recepcionEnBuffer: Boolean(s.sock?.ev?.isBuffering?.()),
                 pendientesIniciales: s.pendientesIniciales !== false,
                 totalEntradas: s.totalEntradas||0,
                 recuperacionesBuffer: s.recuperacionesBuffer||0 }
           : { estado: 'desconectado', qr: null, numero: '', error: null };
}

export async function iniciar(canal) {
  const mod = await cargarBaileys();
  if (!mod) throw new Error('Baileys no está instalado en el servidor (npm i @whiskeysockets/baileys)');

  const id = canal.id;
  let S = sesiones.get(id);
  if (S && (S.arrancando || S.estado === 'conectado' || S.estado === 'pendiente' ||
    (S.estado === 'conectando' && Date.now() - (S.iniciadoEn || 0) < 90000))) return estadoSesion(id);
  // No lanzar un segundo socket mientras ya se espera una reconexión programada.
  if (S?.reintentoTimer) return estadoSesion(id);
  if (!S) { S = { sock: null, estado: 'desconectado', qr: null, numero: '', intentos: 0, retryCache:new Map() }; sesiones.set(id, S); }
  if (!S.retryCache) S.retryCache=new Map();
  S.arrancando = true; S.error = null;
  S.estado = 'conectando'; S.iniciadoEn = Date.now();
  // Retirar un socket antiguo sin cerrar sesión de WhatsApp ni borrar credenciales.
  if (S.sock) {
    const anterior = S.sock;
    S.sock = null;
    try { anterior.end?.(new Error('Sustituido por nueva conexión IMPAR')); } catch {}
  }

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
      generateHighQualityLinkPreview: false,
      // Baileys recomienda contar reintentos para evitar reenvíos de cifrado
      // ilimitados. No se almacenan contenidos ni credenciales en esta caché.
      msgRetryCounterCache: S.contadorReintentos ||= crearCacheContadorReintentos(),
      // WhatsApp solicita el mensaje ORIGINAL al fallar su descifrado:
      // recuperarlo de memoria o PostgreSQL después de una reconexión.
      // Nunca generar un mensaje vacío ni reenviar por cuenta propia.
      getMessage: key => recuperarOriginal({
        q,proto:mod.proto,canalId:id,key,cache:S.retryCache
      })
    });
    S.sock = sock;
    S.pendientesIniciales=true;
    // Si el servidor de WhatsApp no termina el lote offline, Baileys 6.7.24
    // puede quedar conectado pero sin emitir messages.upsert (#2810).
    let timerBuffer=null;
    const cancelarVigilancia=()=>{if(timerBuffer){clearTimeout(timerBuffer);timerBuffer=null;}};
    sock.ev.on('connection.update',u=>{
      if(S.sock!==sock)return;
      if(u.receivedPendingNotifications===true){
        S.pendientesIniciales=false;
        cancelarVigilancia();
      }
      if(u.connection==='close')cancelarVigilancia();
      if(u.connection!=='open')return;
      cancelarVigilancia();
      timerBuffer=setTimeout(()=>{
        timerBuffer=null;
        if(S.sock!==sock || S.estado!=='conectado' || !S.pendientesIniciales)return;
        if(sock.ev?.isBuffering?.() && typeof sock.ev.flush==='function'){
          S.recuperacionesBuffer=(S.recuperacionesBuffer||0)+1;
          console.warn('[wa:recepcion] Buffer inicial bloqueado tras conexión; liberando eventos sin cerrar sesión.');
          sock.ev.flush();
        }
      },18000);
    });
    // Serializar escrituras de credenciales para evitar sobrescrituras
    // concurrentes del estado de la sesión Signal.
    let colaCredenciales=Promise.resolve();
    sock.ev.on('creds.update', () => {
      if (S.sock !== sock) return;
      colaCredenciales=colaCredenciales.catch(()=>{}).then(async()=>{
        if(S.sock!==sock)return;
        await saveCreds();
      });
      colaCredenciales.catch(e=>console.warn('[wa] Guardar sesión:',e.message));
    });

    sock.ev.on('connection.update', async u => {
      if (S.sock !== sock) return; // evento tardío de un socket reemplazado
      const { connection, lastDisconnect, qr } = u;
      try {
        if (qr) {
          const qrImagen = await QRCode.toDataURL(qr, { margin: 1, width: 460, errorCorrectionLevel: 'M' });
          if (S.sock !== sock || ['conectado','reconectando','desconectado'].includes(S.estado)) return;
          S.qr = qrImagen;
          S.estado = 'pendiente';
          await actualizar(id, 'pendiente', '');
          emitir(canal.empresa_id, 'canal:qr', { canalId: id, qr: S.qr });
        }
        if (connection === 'open') {
          const cambioReal = S.estado !== 'conectado';
          if (S.reintentoTimer) { clearTimeout(S.reintentoTimer); S.reintentoTimer = null; }
          S.estado = 'conectado'; S.arrancando = false;
          S.qr = null; S.intentos = 0;
          S.numero = (sock.user?.id || '').split(':')[0];
          await actualizar(id, 'conectado', S.numero, true);
          if (cambioReal) emitir(canal.empresa_id, 'canal:estado', { canalId: id, estado: 'conectado', numero: S.numero });
          // Conexión transitoria recuperada: no generar notificaciones invasivas.

          console.log(`[wa:${canal.nombre}] conectado como ${S.numero}`);
        }
        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          const sesionCaducada = code === mod.DisconnectReason?.loggedOut;
          if (sesionCaducada && S.estado === 'desconectado') return;
          if (!sesionCaducada && S.estado === 'reconectando' && S.reintentoTimer) return;
          S.estado = sesionCaducada ? 'desconectado' : 'reconectando';
          S.arrancando = false; S.qr = null;
          // Terminar los guardados Signal iniciados antes de sustituir el socket.
          await colaCredenciales.catch(()=>{});
          if(S.sock!==sock)return;
          await actualizar(id, S.estado, S.numero);
          emitir(canal.empresa_id,'canal:estado',{ canalId:id,estado:S.estado });
          if (S.reintentoTimer) { clearTimeout(S.reintentoTimer); S.reintentoTimer = null; }
          if (!sesionCaducada) {
            S.intentos = Math.min(S.intentos + 1, 6);
            const espera = Math.min(3000 * 2 ** (S.intentos - 1), 60000);
            console.log(`[wa:${canal.nombre}] conexión interrumpida (${code || 'sin código'}) · reintento en ${espera / 1000}s`);
            S.reintentoTimer = setTimeout(() => {
              S.reintentoTimer = null;
              if (sesiones.get(id) !== S || S.sock !== sock) return;
              iniciar(canal).catch(e => console.error(`[wa:${canal.nombre}] reintento:`,e.message));
            },espera);
          } else {
            rmSync(carpeta, { recursive: true, force: true });
            await avisar(canal,'desvinculada');
          }
        }
      } catch (e) { console.error(`[wa:${canal.nombre}] update:`, e.message); }
    });

    sock.ev.on('messages.update', cambios => {
      if (S.sock !== sock) return;
      for (const cambio of cambios || []) {
        registrarActualizacionImpar(canal,cambio).catch(e =>
          console.warn('[wa:entregas] Estado no registrado:',e.message));
      }
    });
    sock.ev.on('chats.phoneNumberShare', par => {
      if(S.sock!==sock)return;
      const pareja=validarParejaWA(par?.jid,par?.lid);
      if(pareja)registrarParejaWA(canal,pareja,'telefono_compartido')
        .catch(e=>console.warn('[wa:ruta] No se guardó equivalencia:',e.message));
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (S.sock !== sock || !['notify','append'].includes(type)) return;
      for (const m of messages || []) {
        // Los mensajes pendientes pueden llegar como 'append' tras reconexión.
        // Admitir únicamente mensajes recientes para no reimportar históricos masivos.
        if(type==='append'){
          const hora=Number(m.messageTimestamp||0)*1000;
          if(!Number.isFinite(hora)||hora<Date.now()-72*60*60*1000||
             hora>Date.now()+10*60*1000)continue;
        }
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
  if (!m?.key?.id || m.key.fromMe) return;
  const jid = m.key.remoteJid || '';
  if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
  // Sólo confiamos en identidades que traiga la sesión real de WhatsApp.
  const pareja=parejaDesdeEventoWA(m.key);
  if(pareja)await registrarParejaWA(canal,pareja).catch(e=>
    console.warn('[wa:ruta] Identidad no registrada:',e.message));

  /*
   * WhatsApp moderno puede entregar DMs con un JID @lid. Si Baileys trae
   * también el PN alternativo, usamos el teléfono para conservar la identidad
   * existente. Si no existe PN, preservamos el @lid completo para poder
   * responder al mismo chat sin inventar un @s.whatsapp.net inválido.
   */
  const remitente = await resolverRemitenteWA(canal,m.key);
  if(!remitente)return;

  // Mensajes efímeros y de visualización única llegan envueltos por WhatsApp.
  const contenido=mod.normalizeMessageContent?.(m.message) ||
    m.message?.ephemeralMessage?.message ||
    m.message?.viewOnceMessageV2?.message || m.message;
  if(!contenido)return;
  const texto = contenido?.conversation ||
    contenido?.extendedTextMessage?.text ||
    contenido?.imageMessage?.caption ||
    contenido?.videoMessage?.caption ||
    contenido?.documentMessage?.caption || '';

  /* ubicación nativa */
  let ubicacion = null;
  const loc = contenido?.locationMessage || contenido?.liveLocationMessage;
  if (loc) ubicacion = { lat: loc.degreesLatitude, lon: loc.degreesLongitude,
    nombre: loc.name || '', direccion: loc.address || '' };

  /* adjunto */
  let media = null;
  try {
    // No permitir que una descarga bloqueada impida guardar el texto entrante.
    media = await Promise.race([
      bajarMedia(mod,{...m,message:contenido},canal),
      new Promise(resolve=>setTimeout(()=>resolve(null),8000))
    ]);
  }
  catch (e) { console.error(`[wa:${canal.nombre}] adjunto:`, e.message); }

  const etiqueta = texto || (ubicacion ? '[ubicación compartida]' : (media ? '' : especial({...m,message:contenido})));
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
  if (m.message?.imageMessage) return '[imagen recibida · adjunto no disponible]';
  if (m.message?.videoMessage) return '[video recibido · adjunto no disponible]';
  if (m.message?.audioMessage) return '[audio recibido · adjunto no disponible]';
  if (m.message?.documentMessage) return '[documento recibido · adjunto no disponible]';
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
  const sock=S?.sock;
  if (!sock || !S || S.estado !== 'conectado') throw new Error('sesión de WhatsApp no conectada');
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

  // Default PN. Ruta LID sólo con equivalencia real confirmada y opt-in admin.
  // No se modifica la ficha del contacto ni la cola de salida.
  try { jid=(await rutaParaEnvioWA(canal,jid)).destino; }
  catch(e){ console.warn('[wa:ruta] Se conserva ruta por defecto:',e.message); }

  // Cada salida se registra en el almacén de recuperación por su propio
  // identificador original (no se duplican envíos para intentar repararla).
  const transmitir=async contenido=>{
    if(S.sock!==sock || S.estado!=='conectado')
      throw new Error('Sesión WhatsApp cambió durante el envío. Reintentá cuando figure conectada.');
    const enviado=await sock.sendMessage(jid,contenido);
    await guardarOriginal({q,proto:(await cargarBaileys())?.proto,
      canalId:canal.id,empresaId:canal.empresa_id,enviado,cache:S.retryCache});
    return enviado;
  };
  if (adjunto) {
    const bin = readFileSync(join(MEDIA_DIR, String(canal.empresa_id), adjunto.archivo));
    const pie = texto || undefined;
    const contenido =
      adjunto.tipo === 'imagen' ? { image: bin, caption: pie }
      : adjunto.tipo === 'video' ? { video: bin, caption: pie }
      : adjunto.tipo === 'audio' ? { audio: bin, mimetype: adjunto.mime }
      : { document: bin, mimetype: adjunto.mime, fileName: adjunto.nombre, caption: pie };
    const enviado=await transmitir(contenido);
    if (adjunto.tipo === 'audio' && texto) await transmitir({ text: texto });
    return enviado;
  }
  return transmitir({ text: texto });
}

export async function desvincular(canal) {
  const S = sesiones.get(canal.id);
  if (S?.reintentoTimer) { clearTimeout(S.reintentoTimer); S.reintentoTimer = null; }
  const sock = S?.sock;
  if (S) S.sock = null; // el evento close tardío no debe relanzar la sesión
  try { await sock?.logout(); } catch (e) {}
  try { sock?.end?.(); } catch (e) {}
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
        const esperando = S && (S.arrancando || S.reintentoTimer ||
          ['conectado','pendiente'].includes(S.estado) ||
          (S.estado === 'conectando' && Date.now() - (S.iniciadoEn || 0) < 90000));
        if (existsSync(join(AUTH_DIR, String(c.id))) && !esperando) {
          iniciar(c).catch(e => console.warn('[wa] Verificación de sesión:',e.message));
        }
      }
    } catch (e) {}
  }, 60000);
}

export const disponible = async () => !!(await cargarBaileys());
