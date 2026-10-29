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
import { vigilarBuffer } from '../wa-vigilancia-buffer.mjs';

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
                 eventosWA: s.eventosWA || 0,
                 mensajesWA: s.mensajesWA || 0,
                 sinContenidoWA: s.sinContenidoWA || 0,
                 tipoNoAdmitidoWA: s.tipoNoAdmitidoWA || 0,
                 erroresRecepcionWA: s.erroresRecepcionWA || 0,
                 recuperadosWA: s.recuperadosWA || 0,
                 noDescifradosWA: s.noDescifradosWA || 0,
                 tardiosWA: s.tardiosWA || 0,
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
    // Observar antes del descifrado y de messages.upsert, sin registrar
    // identificadores, contenido, teléfonos ni material Signal.
    const transporte = { nodos:0, cifrados:0, noDisponibles:0, msmsg:0, erroresCola:0 };
    sock.ws?.on('CB:message', node => {
      if(S.sock!==sock)return;
      transporte.nodos++;
      for(const hijo of Array.isArray(node?.content)?node.content:[]){
        if(hijo?.tag==='enc'){
          transporte.cifrados++;
          if(hijo.attrs?.type==='msmsg')transporte.msmsg++;
        }
        if(hijo?.tag==='unavailable')transporte.noDisponibles++;
      }
    });
    sock.ev.on('impar.recepcion.error',()=>{if(S.sock===sock)transporte.erroresCola++;});
    const detenerVigilancia = vigilarBuffer({
      sock, vigente: () => S.sock === sock, conectado: () => S.estado === 'conectado',
      alLiberar: () => {
        S.recuperacionesBuffer=(S.recuperacionesBuffer||0)+1;
        console.warn('[wa:recepcion] Buffer prolongado liberado sin cerrar sesión.');
      }
    });
    // Resumen por canal sin números, IDs ni contenido. Sirve para distinguir
    // ausencia de eventos de descartes y fallos de escritura.
    const estadoRecepcion = setInterval(() => {
      if (S.sock !== sock) { clearInterval(estadoRecepcion); return; }
      if (S.estado !== 'conectado') return;
      console.log(`[wa:recepcion] estado=${S.estado} buffer=${Boolean(sock.ev?.isBuffering?.())} eventos=${S.eventosWA||0} mensajes=${S.mensajesWA||0} guardados=${S.totalEntradas||0} sin_contenido=${S.sinContenidoWA||0} no_admitidos=${S.tipoNoAdmitidoWA||0} errores=${S.erroresRecepcionWA||0} recuperados=${S.recuperadosWA||0} avisos_no_leidos=${S.noDescifradosWA||0} tardios=${S.tardiosWA||0} esperando_descifrado=${S.noDescifrados?.size||0}`);
      console.log(`[wa:transporte] nodos=${transporte.nodos} cifrados=${transporte.cifrados} no_disponibles=${transporte.noDisponibles} msmsg=${transporte.msmsg} errores_cola=${transporte.erroresCola}`);
    },60000);
    estadoRecepcion.unref?.();
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
      if(u.connection==='close'){cancelarVigilancia();detenerVigilancia();clearInterval(estadoRecepcion);}
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
            // 401 implica que WhatsApp invalidó el enlace. No intentar reuso
            // automático, pero conservar el material Signal para diagnóstico
            // y respaldo. Borrar auth/ sin autorización sería irreversible.
            console.error('[wa] WhatsApp invalidó el dispositivo vinculado; credenciales conservadas, requiere revisión del administrador.');
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
      S.eventosWA=(S.eventosWA||0)+1;
      S.mensajesWA=(S.mensajesWA||0)+(messages||[]).length;
      for (const m of messages || []) {
        // No descartar 'append' por fecha: WhatsApp puede reenviar mensajes
        // retenidos durante una desconexión con hora ausente o atrasada.
        // La deduplicación durable depende del ID real de WhatsApp en inbox,
        // no de una ventana arbitraria de 72 horas.
        try { await recibir(mod, m, canal, id); }
        catch (e) { S.erroresRecepcionWA=(S.erroresRecepcionWA||0)+1; console.error(`[wa:${canal.nombre}] recibir:`, e.message); }
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

// Máximo 3 descargas en paralelo: el adjunto lento no bloquea los textos.
const colaMultimedia=[];
let descargasActivas=0;
function agendarMultimedia(trabajo){
  colaMultimedia.push(trabajo);
  const impulsar=()=>{
    while(descargasActivas<3 && colaMultimedia.length){
      const siguiente=colaMultimedia.shift();
      descargasActivas++;
      Promise.resolve().then(siguiente).catch(e=>
        console.warn('[wa:multimedia] Captura secundaria:',e.name)).finally(()=>{
        descargasActivas--;impulsar();
      });
    }
  };
  impulsar();
}

// WhatsApp entrega a veces un mensaje que no se puede descifrar (Bad MAC /
// No session). Baileys pide al teléfono del cliente que lo reenvíe; si no
// llega a tiempo, se registra un aviso visible en la conversación para que
// el agente pida el reenvío. Si el original llega después, reemplaza el aviso.
const ESPERA_DESCIFRADO_MS=Number(process.env.WA_ESPERA_DESCIFRADO_MS||60000);
const MAX_ESPERANDO_DESCIFRADO=2000;
const AVISO_NO_DESCIFRADO='[El cliente envió un mensaje que WhatsApp no permitió leer en el CRM. Pedile que lo reenvíe.]';

function remitenteDe(m){
  const jid=String(m.key?.remoteJid||'');
  const pareja=parejaDesdeEventoWA(m.key);
  const remitente=pareja?.pn?.split('@')[0] ||
    (jid.endsWith('@s.whatsapp.net')?jid.split('@')[0]:jid);
  return {pareja,remitente};
}
function fechaDe(m){
  const timestamp=Number(m.messageTimestamp);
  return Number.isFinite(timestamp)&&timestamp>0?timestamp*1000:Date.now();
}
const despertarWorker=()=>import('../worker.mjs').then(({drenarInbox})=>drenarInbox())
  .catch(e=>console.warn('[wa:recepcion] Worker inmediato:',e.name));

function esperarDescifrado(m,canal,id){
  const S=sesiones.get(id);
  if(!S)return;
  S.noDescifrados ||= new Map();
  const clave=String(m.key.id);
  if(S.noDescifrados.has(clave))return;
  if(S.noDescifrados.size>=MAX_ESPERANDO_DESCIFRADO){
    // Tope de memoria: el más antiguo pasa directamente a aviso.
    const [antigua,dato]=S.noDescifrados.entries().next().value;
    clearTimeout(dato.timer);S.noDescifrados.delete(antigua);
    registrarNoDescifrado(dato.m,canal,id).catch(e=>console.warn('[wa:descifrado] Aviso no registrado:',e.name));
  }
  const copia={key:{...m.key},pushName:m.pushName,messageTimestamp:m.messageTimestamp};
  const dato={m:copia,timer:null};
  dato.timer=setTimeout(()=>{
    if(S.noDescifrados?.get(clave)!==dato)return;
    S.noDescifrados.delete(clave);
    registrarNoDescifrado(copia,canal,id).catch(e=>console.warn('[wa:descifrado] Aviso no registrado:',e.name));
  },ESPERA_DESCIFRADO_MS);
  dato.timer?.unref?.();
  S.noDescifrados.set(clave,dato);
}

async function registrarNoDescifrado(m,canal,id){
  const {remitente}=remitenteDe(m);
  const {rows}=await q(
    'INSERT INTO inbox (empresa_id,canal_id,tipo,ext_id,remitente,nombre,txt,'+
    "ubicacion,payload,estado) VALUES($1,$2,'whatsapp_qr',$3,$4,$5,$6,$7,$8,$9) "+
    'ON CONFLICT(canal_id,ext_id) DO NOTHING RETURNING id',
    [canal.empresa_id,id,String(m.key.id),remitente,m.pushName||'',AVISO_NO_DESCIFRADO,
     null,JSON.stringify({ts:fechaDe(m),archivoId:null,noDescifrado:true}),'pendiente']);
  if(!rows[0]?.id)return false;
  const S=sesiones.get(id);
  if(S)S.noDescifradosWA=(S.noDescifradosWA||0)+1;
  despertarWorker();
  return true;
}

/** El original llegó después del aviso: reemplazar texto y adjunto, sin duplicar. */
async function reemplazarNoDescifrado(mod,m,contenido,canal,id,{etiqueta,ubicacion,hayMedia}){
  const ext=String(m.key.id);
  const {rows}=await q(
    "UPDATE inbox SET txt=$3,ubicacion=$4,payload=COALESCE(payload,'{}'::jsonb)||"+
    "jsonb_build_object('noDescifrado',false,'recuperadoTarde',true) "+
    "WHERE canal_id=$1 AND ext_id=$2 AND payload->>'noDescifrado'='true' RETURNING id",
    [id,ext,etiqueta,ubicacion?JSON.stringify(ubicacion):null]);
  if(!rows[0]?.id)return false;
  const S=sesiones.get(id);
  if(S)S.tardiosWA=(S.tardiosWA||0)+1;
  let media=null;
  if(hayMedia){
    try{
      media=await Promise.race([
        bajarMedia(mod,{...m,message:contenido},canal),
        new Promise(resolve=>setTimeout(()=>resolve(null),8000))
      ]);
    }catch(e){console.warn('[wa:multimedia] Descarga tardía:',e.name);}
    if(media)await q('UPDATE inbox SET media_url=$2,media_tipo=$3,media_nombre=$4,'+
      "payload=jsonb_set(COALESCE(payload,'{}'::jsonb),'{archivoId}',$5::jsonb) WHERE id=$1",
      [rows[0].id,media.url,media.tipo,media.nombre,JSON.stringify(media.id||null)]);
  }
  // Si el aviso ya está en la conversación, corregir ese mismo mensaje.
  // Se repite a los 5 s por si el worker lo estaba ingresando en paralelo.
  const corregir=async()=>{
    const {rows:ms}=await q(
      'UPDATE mensajes SET txt=$3,ubicacion=COALESCE($4,ubicacion),media_url=COALESCE($5,media_url),'+
      'media_tipo=COALESCE($6,media_tipo),media_nombre=COALESCE($7,media_nombre),archivo_id=COALESCE($8,archivo_id) '+
      "WHERE empresa_id=$1 AND msg_id=$2 AND dir='in' AND txt=$9 RETURNING negociacion_id",
      [canal.empresa_id,ext,etiqueta,ubicacion?JSON.stringify(ubicacion):null,
       media?.url||null,media?.tipo||null,media?.nombre||null,media?.id||null,AVISO_NO_DESCIFRADO]);
    for(const x of ms)emitir(canal.empresa_id,'neg:patch',{id:x.negociacion_id});
  };
  await corregir();
  const repetir=setTimeout(()=>corregir().catch(e=>console.warn('[wa:descifrado] Corrección diferida:',e.name)),5000);
  repetir?.unref?.();
  despertarWorker();
  return true;
}

async function recibir(mod,m,canal,id){
  if(!m?.key?.id || m.key.fromMe)return;
  const jid=String(m.key.remoteJid||'');
  if(!jid || jid.endsWith('@g.us') || jid==='status@broadcast' ||
     jid.endsWith('@newsletter') || jid.endsWith('@broadcast'))return;
  // Persistir ANTES de mapas, multimedia o actualizaciones de canal.
  const contenido=mod.normalizeMessageContent?.(m.message) ||
    m.message?.ephemeralMessage?.message ||
    m.message?.viewOnceMessageV2?.message || m.message;
  if(!contenido){
    const s=sesiones.get(id);if(s)s.sinContenidoWA=(s.sinContenidoWA||0)+1;
    const CIPHERTEXT=mod.proto?.WebMessageInfo?.StubType?.CIPHERTEXT ?? 2;
    if(m.messageStubType===CIPHERTEXT)esperarDescifrado(m,canal,id);
    return;
  }
  const S0=sesiones.get(id);
  const espera=S0?.noDescifrados?.get(String(m.key.id));
  if(espera){
    clearTimeout(espera.timer);S0.noDescifrados.delete(String(m.key.id));
    S0.recuperadosWA=(S0.recuperadosWA||0)+1;
  }
  const texto=contenido.conversation ||
    contenido.extendedTextMessage?.text ||
    contenido.imageMessage?.caption ||
    contenido.videoMessage?.caption ||
    contenido.documentMessage?.caption ||
    contenido.buttonsResponseMessage?.selectedDisplayText ||
    contenido.listResponseMessage?.title ||
    contenido.templateButtonReplyMessage?.selectedDisplayText ||
    contenido.interactiveResponseMessage?.body?.text || '';
  const loc=contenido.locationMessage||contenido.liveLocationMessage;
  const ubicacion=loc?{lat:loc.degreesLatitude,lon:loc.degreesLongitude,
    nombre:loc.name||'',direccion:loc.address||''}:null;
  const hayMedia=['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage']
    .some(tipo=>Boolean(contenido[tipo]));
  const etiqueta=texto || (ubicacion?'[ubicación compartida]':especial({...m,message:contenido}));
  if(!etiqueta && !hayMedia && !ubicacion){const s=sesiones.get(id);if(s)s.tipoNoAdmitidoWA=(s.tipoNoAdmitidoWA||0)+1;return;}
  const {pareja,remitente}=remitenteDe(m);
  const fecha=fechaDe(m);
  const {rows}=await q(
    'INSERT INTO inbox (empresa_id,canal_id,tipo,ext_id,remitente,nombre,txt,'+
    "ubicacion,payload,estado) VALUES($1,$2,'whatsapp_qr',$3,$4,$5,$6,$7,$8,$9) "+
    'ON CONFLICT(canal_id,ext_id) DO NOTHING RETURNING id',
    [canal.empresa_id,id,String(m.key.id),remitente,m.pushName||'',etiqueta,
     ubicacion?JSON.stringify(ubicacion):null,
     JSON.stringify({ts:fecha,archivoId:null}),hayMedia?'capturando':'pendiente']);
  const entrada=rows[0]?.id;
  if(!entrada){
    await reemplazarNoDescifrado(mod,m,contenido,canal,id,{etiqueta,ubicacion,hayMedia});
    return;
  }
  const S=sesiones.get(id);
  if(S){S.totalEntradas=(S.totalEntradas||0)+1;S.entradaUltima=Date.now();}
  if(pareja)registrarParejaWA(canal,pareja).catch(e=>
    console.warn('[wa:identidades] Guardado diferido:',e.name));
  q('UPDATE canales SET ultimo_mensaje=now() WHERE id=$1',[id]).catch(e=>
    console.warn('[wa:recepcion] Marca de actividad:',e.name));
  const despertar=despertarWorker;
  if(!hayMedia){despertar();return;}
  agendarMultimedia(async()=>{
    let media=null;
    try{
      media=await Promise.race([
        bajarMedia(mod,{...m,message:contenido},canal),
        new Promise(resolve=>setTimeout(()=>resolve(null),8000))
      ]);
    }catch(e){console.warn('[wa:multimedia] Descarga:',e.name);}
    try{
      // Nunca reabrir un mensaje ya procesado por el rescatador.
      await q(
        'UPDATE inbox SET media_url=$2,media_tipo=$3,media_nombre=$4,'+
        "payload=jsonb_set(COALESCE(payload,'{}'::jsonb),'{archivoId}',$5::jsonb),"+
        "estado='pendiente' WHERE id=$1 AND estado='capturando'",
        [entrada,media?.url||null,media?.tipo||null,media?.nombre||null,
         JSON.stringify(media?.id||null)]);
      despertar();
    }catch(e){console.error('[wa:multimedia] Finalización:',e.name);}
  });
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
