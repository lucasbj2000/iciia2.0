/**
 * IMPAR · Pasarela telefónica (en prueba).
 *
 * Un celular con chip de IMPAR, emparejado por Bluetooth con una computadora Linux de la sucursal,
 * se conecta al CRM con un token propio. El CRM le manda órdenes (atender, llamar, cortar) por un
 * canal SSE y la pasarela informa las llamadas por POST. El audio va directo entre la pasarela y el
 * navegador del agente con WebRTC; el servidor solo hace la señalización.
 *
 * Seguridad de esta etapa:
 * - Las llamadas solo se avisan y solo las atiende el administrador probador (mismo que WhatsApp).
 * - El token de la pasarela se guarda solo como hash y se muestra una única vez.
 * - Los logs no muestran números de teléfono.
 */
import crypto from 'node:crypto';
import { q, telNorm } from './db.mjs';
import { emitir } from './realtime.mjs';
import { configLlamadas, esProbador } from './llamadas-wa-impar.mjs';
import { crearContacto, negActivaDeContacto, historial } from './core.mjs';

const err = (status, message) => Object.assign(new Error(message), { status });
const conexiones = new Map(); // pasarelaId → { res, empresaId, equipo, desde }

/* ---------- números ---------- */
/** Número paraguayo a formato internacional en dígitos: «0981 123 456» → «595981123456». */
export function normalizarNumero(n) {
  const s = String(n || '').trim();
  if (!s || /withheld|privado|oculto|unknown/i.test(s)) return '';
  let d = s.replace(/\D/g, '');
  if (s.startsWith('+')) return d;
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('595')) return d;
  if (d.startsWith('0') && d.length >= 9) return '595' + d.slice(1);
  return d;
}
/** Lo que se le pasa al celular para marcar: internacional con «+» si es de Paraguay u otro país con código. */
export function numeroParaMarcar(n) {
  const d = normalizarNumero(n);
  if (!d) return '';
  return d.length >= 11 ? '+' + d : d; // números cortos (internos, *611) van tal cual
}
const telVisible = d => d.startsWith('595') ? `0${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`.trim() : d;

/* ---------- pasarela y token ---------- */
export const hashToken = t => crypto.createHash('sha256').update(String(t || '')).digest('hex');
export async function pasarelaDe(empresaId) {
  const { rows } = await q('SELECT id,nombre,sucursal,crear_negociacion,activo,creado,ultimo_contacto FROM pasarelas_tel_impar WHERE empresa_id=$1', [empresaId]);
  return rows[0] || null;
}
/** Crea la pasarela o le cambia el token. Devuelve el token en claro UNA sola vez. */
export async function generarToken(empresaId, { nombre, sucursal } = {}) {
  const token = 'pst_' + crypto.randomBytes(32).toString('base64url');
  await q(`INSERT INTO pasarelas_tel_impar(empresa_id,nombre,sucursal,token_hash) VALUES($1,$2,$3,$4)
           ON CONFLICT(empresa_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,nombre=EXCLUDED.nombre,sucursal=EXCLUDED.sucursal,activo=true`,
    [empresaId, String(nombre || 'Pasarela telefónica').slice(0, 80), sucursal ? String(sucursal).slice(0, 80) : null, hashToken(token)]);
  const p = await pasarelaDe(empresaId);
  const c = conexiones.get(p.id); if (c) { try { c.res.end(); } catch { /* nada */ } conexiones.delete(p.id); } // el token viejo deja de valer
  return token;
}
export async function ajustarPasarela(empresaId, { crear_negociacion, activo } = {}) {
  await q(`UPDATE pasarelas_tel_impar SET crear_negociacion=COALESCE($2,crear_negociacion), activo=COALESCE($3,activo) WHERE empresa_id=$1`,
    [empresaId, typeof crear_negociacion === 'boolean' ? crear_negociacion : null, typeof activo === 'boolean' ? activo : null]);
  if (activo === false) { const p = await pasarelaDe(empresaId); const c = p && conexiones.get(p.id); if (c) { try { c.res.end(); } catch { /* nada */ } conexiones.delete(p.id); } }
}
export async function pasarelaPorToken(token) {
  if (!/^pst_[\w-]{40,60}$/.test(String(token || ''))) return null;
  const { rows } = await q('SELECT * FROM pasarelas_tel_impar WHERE token_hash=$1 AND activo', [hashToken(token)]);
  return rows[0] || null;
}
export function estadoConexion(p) {
  const c = p && conexiones.get(p.id);
  return { conectada: !!c, celular: !!c?.equipo?.celular, nombre_celular: c?.equipo?.nombre_celular || null, version: c?.equipo?.version || null, desde: c?.desde || null };
}

/** Canal SSE por el que la pasarela recibe órdenes. Una sola conexión por pasarela. */
export function conectarPasarela(p, req, res) {
  const previa = conexiones.get(p.id); if (previa) { try { previa.res.end(); } catch { /* nada */ } }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const c = { res, empresaId: p.empresa_id, equipo: null, desde: new Date().toISOString() };
  conexiones.set(p.id, c);
  q('UPDATE pasarelas_tel_impar SET ultimo_contacto=now() WHERE id=$1', [p.id]).catch(() => {});
  avisarEstado(p.empresa_id);
  const ping = setInterval(() => { try { res.write('event: ping\ndata: {}\n\n'); } catch { /* nada */ } }, 20000);
  req.on('close', () => {
    clearInterval(ping);
    if (conexiones.get(p.id) === c) { conexiones.delete(p.id); avisarEstado(p.empresa_id); }
  });
}
function comando(pasarelaId, datos) {
  const c = conexiones.get(pasarelaId);
  if (!c) return false;
  try { c.res.write(`event: cmd\ndata: ${JSON.stringify(datos)}\n\n`); return true; } catch { return false; }
}

/* ---------- avisos (solo a los probadores) ---------- */
async function aviso(empresaId, datos, uid) {
  const cfg = await configLlamadas(empresaId);
  const probadores = cfg.probadores || [];
  const destino = (uid ? [uid] : probadores).filter(x => probadores.includes(x));
  if (destino.length) emitir(empresaId, 'llamada', { medio: 'telefono', ...datos }, destino);
}
async function avisarEstado(empresaId) {
  const p = await pasarelaDe(empresaId).catch(() => null);
  aviso(empresaId, { tipo: 'pasarela', ...estadoConexion(p) }).catch(() => {});
}

/* ---------- cliente y negociación ---------- */
async function contacto(empresaId, numero) {
  const clave = telNorm(numero);
  if (!clave) return null;
  const { rows } = await q(
    'SELECT DISTINCT c.* FROM contactos c LEFT JOIN contacto_telefonos t ON t.contacto_id=c.id AND t.empresa_id=c.empresa_id ' +
    'WHERE c.empresa_id=$1 AND (c.tel_norm=$2 OR t.tel_norm=$2) LIMIT 1', [empresaId, clave]);
  return rows[0] || null;
}
/** Llamada entrante: busca al cliente y su negociación abierta; si es nuevo, los crea con el sello de teléfono. */
async function negociacionDeLlamada(p, numero, responsableId) {
  const { rows: es } = await q('SELECT * FROM empresas WHERE id=$1', [p.empresa_id]);
  const emp = es[0];
  let c = await contacto(p.empresa_id, numero);
  let neg = c ? await negActivaDeContacto(emp, c.id) : null;
  if (!neg && !p.crear_negociacion) return { contacto: c, negociacion: null };
  if (!c) c = await crearContacto(emp, { nombre: `Teléfono ${telVisible(numero)}`, tel: numero, ...(p.sucursal ? { sucursal: p.sucursal } : {}) });
  let nueva = false;
  if (!neg) {
    const { rows } = await q(
      `INSERT INTO negociaciones (empresa_id,contacto_id,titulo,etapa,origen,canal_id,agente_id,sucursal,linea,bot_activo)
       VALUES ($1,$2,'Llamada telefónica','nuevo','telefonia',NULL,$3,$4,$5,FALSE) RETURNING *`,
      [p.empresa_id, c.id, responsableId || c.responsable_id || null, c.sucursal || p.sucursal || '', c.linea || '']);
    neg = rows[0]; nueva = true;
  }
  await q(`INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt) VALUES ($1,$2,'in','📞 Llamada telefónica entrante')`, [p.empresa_id, neg.id]);
  await q('UPDATE negociaciones SET actualizado=now() WHERE id=$1 AND empresa_id=$2', [neg.id, p.empresa_id]);
  emitir(p.empresa_id, nueva ? 'neg:nueva' : 'neg:patch', { id: neg.id });
  return { contacto: c, negociacion: neg };
}

/* ---------- eventos que manda la pasarela ---------- */
export async function eventoPasarela(p, ev = {}) {
  const tipo = String(ev.tipo || '');
  const c = conexiones.get(p.id);
  if (tipo === 'equipo') {
    if (c) c.equipo = { celular: !!ev.celular, nombre_celular: String(ev.nombre_celular || '').slice(0, 60) || null, version: String(ev.version || '').slice(0, 20) || null };
    await q('UPDATE pasarelas_tel_impar SET ultimo_contacto=now() WHERE id=$1', [p.id]);
    await avisarEstado(p.empresa_id);
    return { ok: true };
  }
  if (tipo === 'entrante') {
    const numero = normalizarNumero(ev.numero);
    const cfg = await configLlamadas(p.empresa_id);
    const probador = (cfg.probadores || [])[0] || null;
    const callId = 'tel.' + crypto.randomUUID();
    let ctx = { contacto: null, negociacion: null };
    if (numero) ctx = await negociacionDeLlamada(p, numero, probador).catch(e => { console.warn('[pasarela] Negociación de la llamada:', e.message); return ctx; });
    await q(`INSERT INTO llamadas_wa_impar(empresa_id,call_id,direccion,telefono,contacto_id,negociacion_id,estado,medio,pasarela_id)
             VALUES($1,$2,'entrante',$3,$4,$5,'sonando','telefono',$6)`,
      [p.empresa_id, callId, numero, ctx.contacto?.id || null, ctx.negociacion?.id || null, p.id]);
    await aviso(p.empresa_id, { tipo: 'entrante', call_id: callId, telefono: numero, nombre: ctx.contacto?.nombre || null, negociacion_id: ctx.negociacion?.id || null });
    return { call_id: callId };
  }
  const callId = String(ev.call_id || '');
  if (!/^tel\.[0-9a-f-]{36}$/.test(callId)) throw err(422, 'Llamada inválida.');
  const { rows } = await q('SELECT * FROM llamadas_wa_impar WHERE call_id=$1 AND empresa_id=$2 AND pasarela_id=$3', [callId, p.empresa_id, p.id]);
  const ll = rows[0]; if (!ll) throw err(404, 'La llamada no existe.');
  if (tipo === 'estado') {
    const st = String(ev.estado || '');
    if (st === 'alerting' || st === 'dialing') {
      await q("UPDATE llamadas_wa_impar SET estado='sonando_cliente' WHERE id=$1 AND fin IS NULL", [ll.id]);
      await aviso(p.empresa_id, { tipo: 'estado', call_id: callId, estado: 'sonando_cliente' }, ll.usuario_id);
    } else if (st === 'active') {
      await q("UPDATE llamadas_wa_impar SET estado='en_curso',conectada=COALESCE(conectada,now()) WHERE id=$1 AND fin IS NULL", [ll.id]);
      await aviso(p.empresa_id, { tipo: 'estado', call_id: callId, estado: 'en_curso' }, ll.usuario_id);
    }
    return { ok: true };
  }
  if (tipo === 'oferta') {
    if (!/^v=0/m.test(String(ev.sdp || ''))) throw err(422, 'Descripción de audio inválida.');
    await aviso(p.empresa_id, { tipo: 'oferta', call_id: callId, sdp: String(ev.sdp) }, ll.usuario_id);
    return { ok: true };
  }
  if (tipo === 'fin' || tipo === 'error') {
    const { rows: fin } = await q(`UPDATE llamadas_wa_impar SET fin=COALESCE(fin,now()),
        estado=CASE WHEN fin IS NOT NULL OR estado='rechazada' THEN estado WHEN estado='sonando' THEN 'perdida'
                    WHEN estado IN ('llamando','sonando_cliente') THEN 'sin_respuesta'
                    WHEN $2 THEN 'fallida' ELSE 'finalizada' END,
        duracion=COALESCE(duracion,CASE WHEN conectada IS NOT NULL THEN EXTRACT(EPOCH FROM now()-conectada)::int END),
        error=COALESCE(error,$3) WHERE id=$1 RETURNING estado,duracion,negociacion_id`,
      [ll.id, tipo === 'error', tipo === 'error' ? String(ev.mensaje || 'Error en la pasarela').slice(0, 200) : null]);
    const f = fin[0];
    if (f?.negociacion_id && !ll.fin) {
      const txt = { perdida: '📞 Llamada perdida', sin_respuesta: '📞 Llamada saliente sin respuesta', fallida: '📞 La llamada no se pudo completar' }[f.estado]
        || `📞 Llamada ${ll.direccion} finalizada${f.duracion ? ` · ${Math.floor(f.duracion / 60)}:${String(f.duracion % 60).padStart(2, '0')}` : ''}`;
      historial(p.empresa_id, f.negociacion_id, txt, 'Teléfono').catch(() => {});
    }
    await aviso(p.empresa_id, { tipo: 'fin', call_id: callId, estado: f?.estado || 'finalizada', duracion: f?.duracion || null });
    return { ok: true };
  }
  throw err(422, 'Evento desconocido.');
}

/* ---------- acciones del probador ---------- */
async function preparar(empresaId, user) {
  const cfg = await configLlamadas(empresaId);
  if (!cfg.activo || !esProbador(cfg, user)) throw err(403, 'Las llamadas no están habilitadas para tu usuario.');
  const p = await pasarelaDe(empresaId);
  if (!p?.activo) throw err(409, 'No hay una pasarela telefónica configurada.');
  if (!conexiones.get(p.id)) throw err(409, 'La pasarela telefónica no está conectada. Revisá que la computadora de la sucursal esté encendida y con internet.');
  return p;
}
async function llamadaTel(empresaId, callId) {
  if (!/^tel\.[0-9a-f-]{36}$/.test(String(callId || ''))) throw err(422, 'Llamada inválida.');
  const { rows } = await q("SELECT * FROM llamadas_wa_impar WHERE call_id=$1 AND empresa_id=$2 AND medio='telefono'", [callId, empresaId]);
  if (!rows[0]) throw err(404, 'La llamada ya no existe.');
  return rows[0];
}
export async function llamarTel(empresaId, user, { tel, negociacion_id } = {}) {
  const p = await preparar(empresaId, user);
  const numero = normalizarNumero(tel), marcar = numeroParaMarcar(tel);
  if (!numero || !/^\+?[0-9]{3,20}$/.test(marcar)) throw err(422, 'El número no es válido.');
  const c = await contacto(empresaId, numero);
  let negId = negociacion_id || null;
  if (!negId && c) { const { rows: es } = await q('SELECT * FROM empresas WHERE id=$1', [empresaId]); negId = (await negActivaDeContacto(es[0], c.id))?.id || null; }
  const callId = 'tel.' + crypto.randomUUID();
  await q(`INSERT INTO llamadas_wa_impar(empresa_id,call_id,direccion,telefono,contacto_id,negociacion_id,usuario_id,estado,medio,pasarela_id)
           VALUES($1,$2,'saliente',$3,$4,$5,$6,'llamando','telefono',$7)`, [empresaId, callId, numero, c?.id || null, negId, user.id, p.id]);
  if (!comando(p.id, { accion: 'llamar', call_id: callId, numero: marcar })) {
    await q("UPDATE llamadas_wa_impar SET estado='fallida',fin=now(),error='pasarela desconectada' WHERE call_id=$1", [callId]);
    throw err(409, 'La pasarela telefónica se desconectó. Probá de nuevo en un momento.');
  }
  if (negId) historial(empresaId, negId, '📞 Llamada telefónica saliente', user.nombre).catch(() => {});
  return { call_id: callId, nombre: c?.nombre || null };
}
export async function atenderTel(empresaId, user, callId) {
  const p = await preparar(empresaId, user);
  const ll = await llamadaTel(empresaId, callId);
  const { rows } = await q("UPDATE llamadas_wa_impar SET estado='atendiendo',usuario_id=$2 WHERE id=$1 AND estado='sonando' AND fin IS NULL RETURNING id", [ll.id, user.id]);
  if (!rows[0]) throw err(409, 'Esta llamada ya fue atendida o terminó.');
  if (!comando(p.id, { accion: 'atender', call_id: ll.call_id })) throw err(409, 'La pasarela telefónica se desconectó.');
  aviso(empresaId, { tipo: 'atendida', call_id: ll.call_id, por: user.id }).catch(() => {});
  return { ok: true };
}
export async function respuestaTel(empresaId, user, callId, sdp) {
  const p = await preparar(empresaId, user);
  const ll = await llamadaTel(empresaId, callId);
  if (ll.usuario_id !== user.id) throw err(403, 'Esta llamada la atiende otra persona.');
  if (!/^v=0/m.test(String(sdp || ''))) throw err(422, 'Falta la descripción de audio del navegador.');
  if (!comando(p.id, { accion: 'respuesta', call_id: ll.call_id, sdp: String(sdp) })) throw err(409, 'La pasarela telefónica se desconectó.');
  return { ok: true };
}
export async function cortarTel(empresaId, user, callId, { rechazar = false } = {}) {
  const cfg = await configLlamadas(empresaId);
  if (!esProbador(cfg, user)) throw err(403, 'Las llamadas no están habilitadas para tu usuario.');
  const ll = await llamadaTel(empresaId, callId);
  const p = await pasarelaDe(empresaId);
  if (rechazar) await q("UPDATE llamadas_wa_impar SET estado='rechazada' WHERE id=$1 AND estado='sonando' AND fin IS NULL", [ll.id]);
  if (p) comando(p.id, { accion: rechazar ? 'rechazar' : 'cortar', call_id: ll.call_id });
  if (!p || !conexiones.get(p.id)) {
    // Sin pasarela no llegará el aviso de fin: se cierra acá.
    await q(`UPDATE llamadas_wa_impar SET fin=COALESCE(fin,now()),estado=CASE WHEN $2 THEN 'rechazada' ELSE 'finalizada' END WHERE id=$1 AND fin IS NULL`, [ll.id, rechazar]);
  }
  return { ok: true };
}
