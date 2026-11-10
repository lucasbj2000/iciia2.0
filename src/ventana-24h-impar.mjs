/* IMPAR · Ventana de 24 h de la línea verificada (WhatsApp Cloud API).
   Meta solo acepta texto libre por Cloud API dentro de las 24 h desde el último mensaje del cliente
   por esa línea; fuera de ese plazo rechaza el mensaje (código 131047) y solo admite plantillas.
   En ese caso el CRM envía por la línea normal principal, para que el mensaje llegue. */
import { q } from './db.mjs';
import { consultarSalidaNormal } from './principal-central-impar.mjs';

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
  let salida = null, motivo = '';
  try { salida = await consultarSalidaNormal(db, empresaId); } catch (e) { motivo = e.message; }
  if (salida && salida.id !== canal.id) return { canalId: salida.id, cambio: { de: canal.nombre, a: salida.nombre } };
  throw Object.assign(new Error(
    'Pasaron más de 24 horas desde el último mensaje del cliente por la línea verificada y Meta solo permite enviarle una plantilla aprobada. ' +
    (motivo || 'No hay una línea de WhatsApp normal activa para escribirle.')), { status: 409 });
}

export { motivoMeta } from './motivos-meta-impar.mjs';
