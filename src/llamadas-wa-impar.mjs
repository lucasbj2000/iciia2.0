/**
 * IMPAR · Llamadas de WhatsApp (Cloud API Calling), en etapa de prueba.
 *
 * Reglas de seguridad de esta etapa:
 * - Solo los administradores listados como «probadores» ven y usan las llamadas.
 * - Al activarlas en Meta se usa call_icon_visibility=DISABLE_ALL: los clientes NO ven el ícono
 *   de llamada; solo pueden llamar desde un botón de llamada que el probador se envía a sí mismo.
 * - Nada de esto toca el envío ni la recepción de mensajes: el webhook solo separa los eventos
 *   de llamadas y deja todo lo demás igual.
 * - Los registros no guardan contenido de audio; los logs no muestran números.
 */
import { q, telNorm } from './db.mjs';
import { emitir } from './realtime.mjs';
import { resolverToken } from './meta-secretos-impar.mjs';
import { ETAPAS_ABIERTAS } from './duplicados-impar.mjs';

const WA_API = `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION || 'v26.0'}`;
const err = (status, message) => Object.assign(new Error(message), { status });
const soloDigitos = v => String(v || '').replace(/\D/g, '');

/* ---------- configuración ---------- */
export async function configLlamadas(empresaId) {
  const { rows } = await q('SELECT * FROM llamadas_wa_config_impar WHERE empresa_id=$1', [empresaId]);
  return rows[0] || { empresa_id: empresaId, activo: false, probadores: [], canal_id: null };
}
export const esProbador = (cfg, user) => !!(user && user.rol === 'admin' && (cfg.probadores || []).includes(user.id));
/** Antes de la primera activación cualquier administrador ve el panel; después, solo los probadores. */
export const puedeConfigurar = (cfg, user) => !!(user && user.rol === 'admin' && (!(cfg.probadores || []).length || esProbador(cfg, user)));

export async function canalesCloud(empresaId) {
  const { rows } = await q(
    "SELECT id,nombre,config->>'phone_number_id' AS phone_number_id,activo FROM canales " +
    "WHERE empresa_id=$1 AND tipo='whatsapp_api' AND activo ORDER BY creado", [empresaId]);
  return rows;
}
export async function canalLlamadas(empresaId, cfg) {
  cfg = cfg || await configLlamadas(empresaId);
  const { rows } = await q(
    "SELECT * FROM canales WHERE empresa_id=$1 AND tipo='whatsapp_api' AND activo " +
    "ORDER BY (id=$2) DESC, creado LIMIT 1", [empresaId, cfg.canal_id || '00000000-0000-0000-0000-000000000000']);
  const c = rows[0];
  if (!c) throw err(409, 'No hay una línea de WhatsApp Cloud API activa para llamadas.');
  if (!c.config?.phone_number_id || !resolverToken(c.config?.token)) throw err(409, 'La línea de WhatsApp Cloud API no tiene identificador o token configurado.');
  return c;
}

/* ---------- Graph API ---------- */
async function graph(canal, ruta, { method = 'GET', body } = {}) {
  const token = resolverToken(canal.config?.token);
  let r;
  try {
    r = await fetch(`${WA_API}/${ruta}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000)
    });
  } catch { throw err(502, 'No se pudo conectar con Meta. Probá de nuevo en un momento.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    console.warn('[llamadas] Meta respondió', r.status, 'código', e.code || '-', e.error_subcode || '');
    throw Object.assign(new Error(traducir(e)), { status: r.status >= 500 ? 502 : 422, codigo: e.code });
  }
  return j;
}
function traducir(e) {
  const c = Number(e?.code);
  if (c === 138006) return 'El cliente todavía no dio permiso para recibir llamadas. Enviale primero la solicitud de permiso.';
  if (c === 131026) return 'El WhatsApp del cliente no admite llamadas de empresas (versión antigua).';
  if (c === 190) return 'El token de la línea de WhatsApp venció o no es válido.';
  if (c === 10 || c === 200) return 'El token no tiene permiso para usar llamadas en esta línea.';
  return e?.error_user_msg || e?.message || 'Meta rechazó la operación de llamada.';
}
const pid = canal => canal.config.phone_number_id;
const accion = (canal, body) => graph(canal, `${pid(canal)}/calls`, { method: 'POST', body: { messaging_product: 'whatsapp', ...body } });

export async function estadoMeta(canal) {
  const [ajustes, numero] = await Promise.all([
    graph(canal, `${pid(canal)}/settings`).catch(e => ({ _error: e.message })),
    graph(canal, `${pid(canal)}?fields=display_phone_number,verified_name,messaging_limit_tier,quality_rating`).catch(e => ({ _error: e.message }))
  ]);
  return {
    calling: ajustes?.calling || null, ajustesError: ajustes?._error || null,
    numero: numero?._error ? null : { nombre: numero.verified_name, telefono: numero.display_phone_number, nivel: numero.messaging_limit_tier, calidad: numero.quality_rating },
    numeroError: numero?._error || null
  };
}
/** Activa llamadas con el ícono OCULTO: ningún cliente ve el botón de llamada en su chat. */
export const activarEnMeta = canal => graph(canal, `${pid(canal)}/settings`, { method: 'POST',
  body: { calling: { status: 'ENABLED', call_icon_visibility: 'DISABLE_ALL' } } });
export const desactivarEnMeta = canal => graph(canal, `${pid(canal)}/settings`, { method: 'POST',
  body: { calling: { status: 'DISABLED' } } });

export async function permiso(canal, tel) {
  const j = await graph(canal, `${pid(canal)}/call_permissions?user_wa_id=${encodeURIComponent(soloDigitos(tel))}`);
  const acc = Object.fromEntries((j.actions || []).map(a => [a.action_name, !!a.can_perform_action]));
  return { estado: j.permission?.status || 'no_permission', vence: j.permission?.expiration_time || null,
    puedeLlamar: acc.start_call ?? (j.permission?.status && j.permission.status !== 'no_permission'),
    puedePedir: acc.send_call_permission_request ?? true };
}
const mensaje = (canal, to, interactive) => graph(canal, `${pid(canal)}/messages`, { method: 'POST',
  body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: soloDigitos(to), type: 'interactive', interactive } });
export const pedirPermiso = (canal, tel) => mensaje(canal, tel, {
  type: 'call_permission_request', action: { name: 'call_permission_request' },
  body: { text: 'Papelerías IMPAR quiere poder llamarte por WhatsApp para atender tu consulta. ¿Nos das permiso?' } });
/** Botón de llamada para probar llamadas entrantes aunque el ícono esté oculto. */
export const enviarBotonLlamada = (canal, tel) => mensaje(canal, tel, {
  type: 'voice_call', body: { text: 'Prueba de llamadas del CRM IMPAR. Tocá el botón para llamarnos por WhatsApp.' },
  action: { name: 'voice_call', parameters: { display_text: 'Llamar a IMPAR', ttl_minutes: 60 } } });

/* ---------- contexto del cliente ---------- */
async function contextoCliente(empresaId, tel) {
  const clave = telNorm(soloDigitos(tel));
  if (!clave) return {};
  const { rows } = await q(
    'SELECT DISTINCT c.id,c.nombre FROM contactos c LEFT JOIN contacto_telefonos t ON t.contacto_id=c.id AND t.empresa_id=c.empresa_id ' +
    'WHERE c.empresa_id=$1 AND (c.tel_norm=$2 OR t.tel_norm=$2) LIMIT 1', [empresaId, clave]);
  const c = rows[0]; if (!c) return {};
  const { rows: ns } = await q('SELECT id FROM negociaciones WHERE empresa_id=$1 AND contacto_id=$2 AND etapa = ANY($3) ORDER BY actualizado DESC NULLS LAST LIMIT 1',
    [empresaId, c.id, ETAPAS_ABIERTAS]).catch(() => ({ rows: [] }));
  return { contacto_id: c.id, nombre: c.nombre, negociacion_id: ns[0]?.id || null };
}
/** Los avisos de llamadas van SOLO a los probadores (nunca a todo el equipo, aunque la lista esté vacía). */
function aviso(cfg, datos, uid) {
  const destino = (uid ? [uid] : (cfg.probadores || [])).filter(x => (cfg.probadores || []).includes(x));
  if (destino.length) emitir(cfg.empresa_id, 'llamada', datos, destino);
}

/* ---------- acciones del probador ---------- */
export async function iniciarLlamada(empresaId, user, { tel, sdp, negociacion_id }) {
  const cfg = await configLlamadas(empresaId);
  if (!cfg.activo || !esProbador(cfg, user)) throw err(403, 'Las llamadas no están habilitadas para tu usuario.');
  if (!/^v=0/m.test(String(sdp || ''))) throw err(422, 'Falta la descripción de audio del navegador.');
  const destino = soloDigitos(tel);
  if (destino.length < 10) throw err(422, 'Indicá el número con código de país.');
  const canal = await canalLlamadas(empresaId, cfg);
  const j = await accion(canal, { to: destino, action: 'connect', session: { sdp_type: 'offer', sdp } });
  const callId = j.calls?.[0]?.id;
  if (!callId) throw err(502, 'Meta no devolvió el identificador de la llamada.');
  const ctx = await contextoCliente(empresaId, destino);
  await q(`INSERT INTO llamadas_wa_impar(empresa_id,canal_id,call_id,direccion,telefono,contacto_id,negociacion_id,usuario_id,estado)
           VALUES($1,$2,$3,'saliente',$4,$5,$6,$7,'llamando') ON CONFLICT(call_id) DO NOTHING`,
    [empresaId, canal.id, callId, destino, ctx.contacto_id || null, negociacion_id || ctx.negociacion_id || null, user.id]);
  return { call_id: callId, nombre: ctx.nombre || null };
}
async function llamadaDe(empresaId, callId) {
  const { rows } = await q('SELECT * FROM llamadas_wa_impar WHERE empresa_id=$1 AND call_id=$2', [empresaId, String(callId)]);
  if (!rows[0]) throw err(404, 'La llamada ya no existe.');
  return rows[0];
}
export async function atenderLlamada(empresaId, user, callId, sdp) {
  const cfg = await configLlamadas(empresaId);
  if (!cfg.activo || !esProbador(cfg, user)) throw err(403, 'Las llamadas no están habilitadas para tu usuario.');
  if (!/^v=0/m.test(String(sdp || ''))) throw err(422, 'Falta la descripción de audio del navegador.');
  const ll = await llamadaDe(empresaId, callId);
  if (ll.direccion !== 'entrante' || ll.estado !== 'sonando') throw err(409, 'Esta llamada ya fue atendida o terminó.');
  const { rows } = await q("UPDATE llamadas_wa_impar SET estado='atendiendo',usuario_id=$3 WHERE empresa_id=$1 AND call_id=$2 AND estado='sonando' RETURNING id", [empresaId, ll.call_id, user.id]);
  if (!rows[0]) throw err(409, 'Otra persona ya atendió esta llamada.');
  const canal = await canalLlamadas(empresaId, cfg);
  const session = { sdp_type: 'answer', sdp };
  try {
    await accion(canal, { call_id: ll.call_id, action: 'pre_accept', session });
    await accion(canal, { call_id: ll.call_id, action: 'accept', session });
  } catch (e) {
    await q("UPDATE llamadas_wa_impar SET estado='fallida',error=$3,fin=now() WHERE empresa_id=$1 AND call_id=$2", [empresaId, ll.call_id, String(e.message).slice(0, 200)]);
    throw e;
  }
  await q("UPDATE llamadas_wa_impar SET estado='en_curso',conectada=now() WHERE empresa_id=$1 AND call_id=$2", [empresaId, ll.call_id]);
  aviso(cfg, { tipo: 'atendida', call_id: ll.call_id, por: user.id });
  return { ok: true };
}
export async function rechazarLlamada(empresaId, user, callId) {
  const cfg = await configLlamadas(empresaId);
  if (!esProbador(cfg, user)) throw err(403, 'Las llamadas no están habilitadas para tu usuario.');
  const ll = await llamadaDe(empresaId, callId);
  const canal = await canalLlamadas(empresaId, cfg);
  await accion(canal, { call_id: ll.call_id, action: 'reject' }).catch(e => { if (e.status !== 422) throw e; });
  await q("UPDATE llamadas_wa_impar SET estado='rechazada',fin=now() WHERE empresa_id=$1 AND call_id=$2 AND fin IS NULL", [empresaId, ll.call_id]);
  aviso(cfg, { tipo: 'fin', call_id: ll.call_id, estado: 'rechazada' });
  return { ok: true };
}
export async function cortarLlamada(empresaId, user, callId) {
  const cfg = await configLlamadas(empresaId);
  if (!esProbador(cfg, user)) throw err(403, 'Las llamadas no están habilitadas para tu usuario.');
  const ll = await llamadaDe(empresaId, callId);
  const canal = await canalLlamadas(empresaId, cfg);
  await accion(canal, { call_id: ll.call_id, action: 'terminate' }).catch(e => { if (e.status !== 422) throw e; });
  await q("UPDATE llamadas_wa_impar SET estado='finalizada',fin=now(),duracion=COALESCE(duracion,EXTRACT(EPOCH FROM now()-conectada)::int) WHERE empresa_id=$1 AND call_id=$2 AND fin IS NULL",
    [empresaId, ll.call_id]);
  aviso(cfg, { tipo: 'fin', call_id: ll.call_id, estado: 'finalizada' });
  return { ok: true };
}

/* ---------- webhooks ---------- */
const esLlamada = s => s?.type === 'call' || ['RINGING', 'ACCEPTED', 'REJECTED'].includes(String(s?.status || '').toUpperCase());
export const estadoDeLlamada = esLlamada;
export const esRespuestaPermiso = m => m?.type === 'interactive' && m.interactive?.type === 'call_permission_reply';

/** Procesa un cambio del webhook con eventos de llamadas. Nunca lanza: un error no frena los mensajes. */
export async function procesarLlamadasCloud(canal, v) {
  try {
    const cfg = await configLlamadas(canal.empresa_id);
    for (const c of v.calls || []) await eventoLlamada(canal, cfg, c);
    for (const s of (v.statuses || []).filter(esLlamada)) await estadoLlamada(canal, cfg, s);
  } catch (e) { console.error('[llamadas] webhook:', e.message); }
}
const sdpDe = c => c?.session?.sdp || c?.connection?.webrtc?.sdp || null;
const tipoSdp = c => c?.session?.sdp_type || (c?.connection?.webrtc?.sdp ? (c.direction === 'BUSINESS_INITIATED' ? 'answer' : 'offer') : null);

async function eventoLlamada(canal, cfg, c) {
  const callId = String(c.id || ''); if (!callId) return;
  const evento = String(c.event || '').toLowerCase();
  if (evento === 'connect' && tipoSdp(c) === 'offer') {
    // Entrante. Sin pruebas activas no se registra ni se avisa: Meta la corta sola al no atenderse.
    if (!cfg.activo || !(cfg.probadores || []).length) return;
    const tel = soloDigitos(c.from);
    const ctx = await contextoCliente(canal.empresa_id, tel);
    await q(`INSERT INTO llamadas_wa_impar(empresa_id,canal_id,call_id,direccion,telefono,contacto_id,negociacion_id,estado,sdp_oferta)
             VALUES($1,$2,$3,'entrante',$4,$5,$6,'sonando',$7) ON CONFLICT(call_id) DO NOTHING`,
      [canal.empresa_id, canal.id, callId, tel, ctx.contacto_id || null, ctx.negociacion_id || null, sdpDe(c)]);
    aviso(cfg, { tipo: 'entrante', call_id: callId, telefono: tel, nombre: ctx.nombre || null, negociacion_id: ctx.negociacion_id || null, sdp: sdpDe(c) });
  } else if (evento === 'connect' && tipoSdp(c) === 'answer') {
    const { rows } = await q("UPDATE llamadas_wa_impar SET estado='conectando' WHERE call_id=$1 AND empresa_id=$2 RETURNING usuario_id", [callId, canal.empresa_id]);
    aviso(cfg, { tipo: 'respuesta', call_id: callId, sdp: sdpDe(c) }, rows[0]?.usuario_id);
  } else if (evento === 'terminate') {
    const dur = Number(c.duration) || null;
    const { rows } = await q(`UPDATE llamadas_wa_impar SET fin=COALESCE(fin,now()),duracion=COALESCE($3,duracion),
        estado=CASE WHEN estado IN ('sonando') THEN 'perdida' WHEN estado IN ('llamando','conectando') AND $3 IS NULL THEN 'sin_respuesta' ELSE 'finalizada' END,
        error=COALESCE($4,error) WHERE call_id=$1 AND empresa_id=$2 RETURNING estado`,
      [callId, canal.empresa_id, dur, c.errors?.[0]?.code ? String(c.errors[0].code) : null]);
    aviso(cfg, { tipo: 'fin', call_id: callId, estado: rows[0]?.estado || 'finalizada', duracion: dur });
  }
}
async function estadoLlamada(canal, cfg, s) {
  const st = String(s.status || '').toUpperCase();
  const nuevo = { RINGING: 'sonando_cliente', ACCEPTED: 'en_curso', REJECTED: 'rechazada' }[st];
  if (!nuevo || !s.id) return;
  const { rows } = await q(`UPDATE llamadas_wa_impar SET estado=$3, conectada=CASE WHEN $3='en_curso' THEN COALESCE(conectada,now()) ELSE conectada END,
      fin=CASE WHEN $3='rechazada' THEN now() ELSE fin END WHERE call_id=$1 AND empresa_id=$2 RETURNING usuario_id`, [String(s.id), canal.empresa_id, nuevo]);
  aviso(cfg, { tipo: 'estado', call_id: String(s.id), estado: nuevo }, rows[0]?.usuario_id);
}
/** El cliente respondió la solicitud de permiso: se avisa a los probadores. */
export async function respuestaPermiso(canal, m) {
  try {
    const cfg = await configLlamadas(canal.empresa_id);
    if (!(cfg.probadores || []).length) return;
    const r = m.interactive?.call_permission_reply || {};
    aviso(cfg, { tipo: 'permiso', telefono: soloDigitos(m.from), respuesta: r.response === 'accept' ? 'acepto' : 'rechazo', permanente: !!r.is_permanent });
  } catch (e) { console.error('[llamadas] permiso:', e.message); }
}

export async function historial(empresaId, limite = 30) {
  const { rows } = await q(`SELECT l.call_id,l.direccion,l.telefono,l.estado,l.creado,l.conectada,l.fin,l.duracion,l.error,l.medio,
      c.nombre AS cliente, u.nombre AS usuario, l.negociacion_id
      FROM llamadas_wa_impar l LEFT JOIN contactos c ON c.id=l.contacto_id LEFT JOIN usuarios u ON u.id=l.usuario_id
      WHERE l.empresa_id=$1 ORDER BY l.creado DESC LIMIT $2`, [empresaId, limite]);
  return rows;
}
