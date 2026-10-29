/** IMPAR · Citas de mensajes (respuestas). Sin contenido de clientes en logs. */
const MAX_TXT = 300;
const ETIQUETA = { imagen: '📷 Imagen', video: '🎥 Video', audio: '🎤 Audio', documento: '📄 Documento' };
const idSeguro = id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{4,180}$/.test(id);

export const vistaPrevia = (txt, mediaTipo) => {
  const t = String(txt || '').replace(/\s+/g, ' ').trim();
  return (t || ETIQUETA[mediaTipo] || 'Mensaje').slice(0, MAX_TXT);
};

/** Cita recibida desde WhatsApp ({ext, txt, dir?}) → vínculo con el mensaje del CRM, si existe. */
export async function resolverCitaEntrante(q, empresaId, cita) {
  if (!cita || !idSeguro(cita.ext)) return null;
  const { rows } = await q(
    `SELECT id,dir,txt,media_tipo FROM (
       SELECT m.id,m.dir,m.txt,m.media_tipo,1 AS orden FROM mensajes m
        WHERE m.empresa_id=$1 AND m.msg_id=$2
       UNION ALL
       SELECT m.id,m.dir,m.txt,m.media_tipo,2 FROM wa_entregas_impar w
         JOIN outbox o ON o.id=w.outbox_id AND o.empresa_id=w.empresa_id
         JOIN mensajes m ON m.id=o.mensaje_id AND m.empresa_id=o.empresa_id
        WHERE w.empresa_id=$1 AND w.wa_id=$2
     ) x ORDER BY orden LIMIT 1`, [empresaId, cita.ext]);
  const m = rows[0];
  if (m) return { id: m.id, ext: cita.ext, dir: m.dir, txt: vistaPrevia(m.txt, m.media_tipo) };
  return { id: null, ext: cita.ext, dir: cita.dir === 'out' ? 'out' : 'in', txt: vistaPrevia(cita.txt) };
}

/** Mensaje elegido por el agente → cita para guardar y enviar. Debe ser del mismo cliente. */
export async function citaParaEnvio(q, empresaId, contactoId, mensajeId) {
  if (mensajeId == null || mensajeId === '') return null;
  if (!/^\d{1,18}$/.test(String(mensajeId)))
    throw Object.assign(new Error('Mensaje citado no válido.'), { status: 422 });
  const { rows } = await q(
    `SELECT m.id,m.dir,m.txt,m.media_tipo,m.msg_id,
            (SELECT w.wa_id FROM outbox o JOIN wa_entregas_impar w ON w.outbox_id=o.id AND w.empresa_id=o.empresa_id
              WHERE o.mensaje_id=m.id AND o.empresa_id=m.empresa_id ORDER BY w.creado DESC LIMIT 1) AS wa_salida
       FROM mensajes m JOIN negociaciones n ON n.id=m.negociacion_id AND n.empresa_id=m.empresa_id
      WHERE m.id=$1 AND m.empresa_id=$2 AND n.contacto_id=$3`, [String(mensajeId), empresaId, contactoId]);
  const m = rows[0];
  if (!m) throw Object.assign(new Error('El mensaje citado no pertenece a esta conversación.'), { status: 422 });
  const ext = m.dir === 'in' ? m.msg_id : m.wa_salida;
  return { id: m.id, ext: idSeguro(ext) ? ext : null, dir: m.dir, txt: vistaPrevia(m.txt, m.media_tipo) };
}
