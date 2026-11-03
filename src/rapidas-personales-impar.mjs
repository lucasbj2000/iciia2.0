/** IMPAR · Respuestas rápidas personales con cambios atómicos.
 *
 * Antes cada cambio enviaba la lista completa y reemplazaba la guardada: si el agente
 * tenía el CRM abierto en dos equipos (o pestañas), la lista vieja de uno pisaba la del
 * otro y las respuestas nuevas «desaparecían». Ahora cada operación toca solo su
 * elemento dentro de PostgreSQL, en una única sentencia.
 */
import { randomBytes } from 'node:crypto';
import { q } from './db.mjs';

export const MAX_PERSONALES = 150;
const MAX_TXT = 2000;
const idValido = id => typeof id === 'string' && /^p[0-9a-z]{4,40}$/i.test(id);
const nuevoId = () => 'p' + Date.now().toString(36) + randomBytes(4).toString('hex');

/** Normaliza el elemento que guarda el servidor (nunca confía en el navegador para el adjunto). */
export function elementoRapida(txt, archivo) {
  const t = String(txt ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TXT);
  if (!t && !archivo) return null;
  return { txt: t, archivo_id: archivo?.id || null, media_url: archivo?.url || null,
    media_tipo: archivo?.tipo || null, media_nombre: archivo?.nombre || null };
}

/** Lista del usuario; asigna id a elementos antiguos que no lo tenían (una sola vez). */
export async function listarPersonales(usuarioId) {
  const { rows } = await q('SELECT rapidas FROM usuarios WHERE id=$1', [usuarioId]);
  const lista = Array.isArray(rows[0]?.rapidas) ? rows[0].rapidas : [];
  if (lista.every(e => idValido(e?.id))) return lista;
  const { rows: r2 } = await q(
    `UPDATE usuarios SET rapidas=COALESCE((
       SELECT jsonb_agg(CASE WHEN COALESCE(e->>'id','') ~ '^p[0-9A-Za-z]{4,40}$' THEN e
                             ELSE e || jsonb_build_object('id','p'||md5(random()::text||ord::text)) END ORDER BY ord)
         FROM jsonb_array_elements(rapidas) WITH ORDINALITY t(e,ord)),'[]'::jsonb)
     WHERE id=$1 RETURNING rapidas`, [usuarioId]);
  return r2[0]?.rapidas || [];
}

export async function agregarPersonal(usuarioId, elemento) {
  const e = { id: nuevoId(), ...elemento };
  const { rows } = await q(
    `UPDATE usuarios SET rapidas=COALESCE(rapidas,'[]'::jsonb) || jsonb_build_array($2::jsonb)
      WHERE id=$1 AND jsonb_array_length(COALESCE(rapidas,'[]'::jsonb)) < $3 RETURNING rapidas`,
    [usuarioId, JSON.stringify(e), MAX_PERSONALES]);
  return rows[0] ? { lista: rows[0].rapidas, elemento: e } : null;
}

/** cambios: { txt?, archivo? (objeto) , quitarArchivo? } */
export async function editarPersonal(usuarioId, id, cambios) {
  if (!idValido(id)) return null;
  const parche = {};
  if (cambios.txt !== undefined) parche.txt = String(cambios.txt ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TXT);
  if (cambios.archivo) Object.assign(parche, { archivo_id: cambios.archivo.id, media_url: cambios.archivo.url,
    media_tipo: cambios.archivo.tipo, media_nombre: cambios.archivo.nombre });
  if (cambios.quitarArchivo) Object.assign(parche, { archivo_id: null, media_url: null, media_tipo: null, media_nombre: null });
  const { rows } = await q(
    `UPDATE usuarios SET rapidas=(
       SELECT COALESCE(jsonb_agg(CASE WHEN e->>'id'=$2 THEN e || $3::jsonb ELSE e END ORDER BY ord),'[]'::jsonb)
         FROM jsonb_array_elements(rapidas) WITH ORDINALITY t(e,ord))
      WHERE id=$1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(rapidas) x WHERE x->>'id'=$2)
      RETURNING rapidas`, [usuarioId, id, JSON.stringify(parche)]);
  return rows[0]?.rapidas || null;
}

export async function borrarPersonal(usuarioId, id) {
  if (!idValido(id)) return null;
  const { rows } = await q(
    `UPDATE usuarios SET rapidas=(
       SELECT COALESCE(jsonb_agg(e ORDER BY ord),'[]'::jsonb)
         FROM jsonb_array_elements(rapidas) WITH ORDINALITY t(e,ord) WHERE e->>'id' IS DISTINCT FROM $2)
      WHERE id=$1 RETURNING rapidas`, [usuarioId, id]);
  return rows[0]?.rapidas || null;
}
