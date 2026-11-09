/* IMPAR · Ventana de 24 h de la línea verificada (WhatsApp Cloud API).
   Meta solo acepta texto libre por Cloud API dentro de las 24 h desde el último mensaje del cliente
   por esa línea; fuera de ese plazo rechaza el mensaje (código 131047) y solo admite plantillas.
   En ese caso el CRM envía por la línea normal principal, para que el mensaje llegue. */
import { q } from './db.mjs';
import { consultarPrincipalCentral } from './principal-central-impar.mjs';

export const VENTANA_MS = 24 * 60 * 60 * 1000;
const MARGEN_MS = 5 * 60 * 1000; // no apostar al último minuto: Meta mide con su propio reloj

/** ¿La última vez que el cliente escribió por esa línea está dentro de las 24 h? */
export function ventanaAbierta(ultimoEntrante, ahora = Date.now()) {
  if (!ultimoEntrante) return false;
  return ahora - new Date(ultimoEntrante).getTime() < VENTANA_MS - MARGEN_MS;
}

export async function ultimoEntrante(db, empresaId, contactoId, canalId) {
  const { rows } = await db.query(
    `SELECT max(m.ts) AS ts FROM mensajes m
       JOIN negociaciones n ON n.id=m.negociacion_id AND n.empresa_id=m.empresa_id
      WHERE m.empresa_id=$1 AND n.contacto_id=$2 AND m.dir='in' AND COALESCE(m.canal_id,n.canal_id)=$3`,
    [empresaId, contactoId, canalId]);
  return rows[0]?.ts || null;
}

/**
 * Decide por qué línea sale un mensaje del agente.
 * Devuelve { canalId, cambio: null | { de, a } } o lanza un error con status 409 si no hay salida posible.
 */
export async function rutaDeEnvio({ empresaId, contactoId, canalId }, db = { query: q }) {
  if (!canalId) return { canalId, cambio: null };
  const { rows } = await db.query('SELECT id,nombre,tipo,activo FROM canales WHERE id=$1 AND empresa_id=$2', [canalId, empresaId]);
  const canal = rows[0];
  if (!canal || canal.tipo !== 'whatsapp_api') return { canalId, cambio: null };
  if (ventanaAbierta(await ultimoEntrante(db, empresaId, contactoId, canalId))) return { canalId, cambio: null };
  let principal = null;
  try { principal = await consultarPrincipalCentral(db, empresaId); } catch { /* sin principal definida */ }
  if (principal && principal.id !== canal.id) {
    const { rows: p } = await db.query('SELECT tipo FROM canales WHERE id=$1 AND empresa_id=$2 AND activo', [principal.id, empresaId]);
    if (p[0]?.tipo === 'whatsapp_qr') return { canalId: principal.id, cambio: { de: canal.nombre, a: principal.nombre } };
  }
  // Sin principal definida: si hay una sola línea normal activa, es la única opción posible.
  const { rows: normales } = await db.query("SELECT id,nombre FROM canales WHERE empresa_id=$1 AND activo AND tipo='whatsapp_qr'", [empresaId]);
  if (normales.length === 1) return { canalId: normales[0].id, cambio: { de: canal.nombre, a: normales[0].nombre } };
  throw Object.assign(new Error(
    'Pasaron más de 24 horas desde el último mensaje del cliente por la línea verificada. Meta solo permite enviarle una plantilla aprobada, y no hay una línea normal principal activa para escribirle.'),
    { status: 409 });
}

/** Códigos de error de Meta en palabras para el agente. */
const MOTIVOS = {
  131047: 'pasaron más de 24 h desde el último mensaje del cliente por esta línea (solo se permiten plantillas)',
  131026: 'el número no tiene WhatsApp o no puede recibir mensajes',
  131042: 'falta el método de pago en la cuenta de WhatsApp de Meta',
  131049: 'Meta limitó los mensajes de marketing a este número',
  131050: 'el cliente pidió no recibir mensajes de marketing',
  131051: 'tipo de mensaje no admitido',
  131052: 'no se pudo descargar el archivo',
  131053: 'el archivo no es válido para WhatsApp',
  131056: 'demasiados mensajes seguidos a este número; esperá un momento',
  131021: 'no se puede enviar a este mismo número',
  131031: 'la cuenta de WhatsApp de Meta está bloqueada',
  131000: 'error interno de Meta; volvé a intentar',
  130472: 'Meta no entregó el mensaje por una prueba interna suya',
  470: 'pasaron más de 24 h desde el último mensaje del cliente (solo se permiten plantillas)'
};
export const motivoMeta = codigo => MOTIVOS[Number(codigo)] || (codigo ? `código ${codigo}` : '');
