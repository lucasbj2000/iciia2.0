/** IMPAR · Rescate automático de mensajes que el teléfono del cliente no pudo descifrar.
 *
 * Cuando WhatsApp avisa («retry») que el cliente no pudo descifrar un mensaje nuestro,
 * Baileys reintenta por la misma ruta. Si eso tampoco alcanza, este proceso lo reenvía
 * UNA vez por la otra ruta verificada (número ↔ LID), sin intervención humana:
 *   - espera a que el reintento propio de WhatsApp falle (2.º aviso) o pasen 5 minutos;
 *   - no reenvía si el cliente lo leyó después del aviso (se descifró);
 *   - nunca reenvía un reenvío (sin rebotes entre rutas);
 *   - si no hay otra ruta, avisa a administración en vez de insistir.
 * No registra contenido ni teléfonos en los logs.
 */
import { q, tx } from './db.mjs';
import { emitir } from './realtime.mjs';
import { historial } from './core.mjs';
import { rutaParaEnvioWA } from './wa-identidades-impar.mjs';

const tipoDe = jid => String(jid || '').endsWith('@lid') ? 'lid' : 'pn';

/** ¿Corresponde reenviar? Pura, para poder probarla. */
export function decidirRescate(fila, rutaActual, ahora = Date.now()) {
  // 'sin_alternativa' se vuelve a evaluar: la ruta puede aparecer cuando el cliente escriba.
  if (!fila || !(Number(fila.reintentos) > 0) || fila.reenviado_ts || (fila.rescate && fila.rescate !== 'sin_alternativa')) return 'nada';
  const aviso = new Date(fila.reintento_ts).getTime();
  if (!Number.isFinite(aviso) || ahora - aviso > 24 * 3600e3) return 'nada';
  if (fila.leido_ts && new Date(fila.leido_ts).getTime() >= aviso) return 'nada'; // se descifró tras el reintento
  const vencido = Number(fila.reintentos) >= 2 || ahora - aviso >= 5 * 60e3;
  if (!vencido) return 'esperar';
  if (fila.reenvio_de) return 'agotado';                  // ya era un reenvío: no rebotar
  if (!rutaActual || tipoDe(rutaActual) === (fila.jid_tipo || 'pn')) return 'sin_alternativa';
  return 'reenviar';
}

const PENDIENTES = `SELECT we.canal_id,we.wa_id,we.empresa_id,we.jid_tipo,we.reintentos,we.reintento_ts,
    we.leido_ts,we.reenviado_ts,we.rescate,o.id AS outbox_id,o.destino,o.negociacion_id,o.mensaje_id,o.reenvio_de
  FROM wa_entregas_impar we
  JOIN outbox o ON o.id=we.outbox_id AND o.empresa_id=we.empresa_id
  JOIN canales c ON c.id=we.canal_id AND c.tipo='whatsapp_qr' AND c.activo
 WHERE we.reintentos>0 AND we.reenviado_ts IS NULL AND (we.rescate IS NULL OR we.rescate='sin_alternativa')
   AND we.reintento_ts > now()-interval '24 hours'
   AND NOT (we.leido_ts IS NOT NULL AND we.leido_ts>=we.reintento_ts)
 ORDER BY we.reintento_ts LIMIT 100`;

async function avisarAdmins(f, titulo, msg) {
  const { rows } = await q("SELECT id FROM usuarios WHERE empresa_id=$1 AND rol='admin' AND activo", [f.empresa_id]);
  const ids = rows.map(r => r.id);
  if (!ids.length) return;
  await q(`INSERT INTO notificaciones (empresa_id,usuario_id,tipo,titulo,msg,tono,ref)
           SELECT $1,u,'whatsapp_entrega',$2,$3,'warn',$4 FROM unnest($5::uuid[]) AS u`,
    [f.empresa_id, titulo, msg, f.negociacion_id, ids]);
  emitir(f.empresa_id, 'noti', { tipo: 'whatsapp_entrega', titulo, msg, tono: 'warn', ref: f.negociacion_id }, ids);
}

/** Encola una copia del mensaje original (mismo texto y adjunto) que saldrá por la ruta corregida. */
async function reenviar(f) {
  const hecho = await tx(async c => {
    // Reclamar primero: dos procesos o un clic manual simultáneo no generan dos reenvíos.
    const marca = await c.query(
      `UPDATE wa_entregas_impar SET reenviado_ts=now(),rescate='reenviado'
        WHERE canal_id=$1 AND wa_id=$2 AND reenviado_ts IS NULL AND (rescate IS NULL OR rescate='sin_alternativa')`, [f.canal_id, f.wa_id]);
    if (!marca.rowCount) return false;
    const { rows } = await c.query(
      `INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,autor_id,estado,archivo_id,media_url,media_tipo,media_nombre,media_bytes)
       SELECT empresa_id,negociacion_id,'out',txt,autor_id,'pendiente',archivo_id,media_url,media_tipo,media_nombre,media_bytes
         FROM mensajes WHERE id=$1 AND empresa_id=$2 RETURNING id`, [f.mensaje_id, f.empresa_id]);
    if (!rows[0]) return false;
    await c.query(
      `INSERT INTO outbox (empresa_id,canal_id,negociacion_id,destino,txt,archivo_id,media_url,media_tipo,media_nombre,mensaje_id,reenvio_de)
       SELECT empresa_id,canal_id,negociacion_id,destino,txt,archivo_id,media_url,media_tipo,media_nombre,$3,id
         FROM outbox WHERE id=$1 AND empresa_id=$2`, [f.outbox_id, f.empresa_id, rows[0].id]);
    return rows[0].id;
  });
  if (!hecho) return false;
  await historial(f.empresa_id, f.negociacion_id,
    'Mensaje reenviado automáticamente: el teléfono del cliente no pudo leerlo («Esperando mensaje»)', 'Sistema');
  emitir(f.empresa_id, 'neg:patch', { id: f.negociacion_id, mensajeId: hecho });
  return true;
}

let enCurso = false;
export async function rescatarNoDescifrados(ahora = Date.now()) {
  const r = { revisados: 0, reenviados: 0, sinAlternativa: 0, agotados: 0 };
  if (enCurso) return r; // una pasada a la vez; entre procesos protege el reclamo en la base
  enCurso = true;
  try {
    const { rows } = await q(PENDIENTES);
    for (const f of rows) {
      r.revisados++;
      let ruta = null;
      try { ruta = (await rutaParaEnvioWA({ id: f.canal_id, empresa_id: f.empresa_id }, f.destino)).destino; }
      catch (e) { console.warn('[wa:rescate] Ruta no disponible:', e.name); continue; }
      const d = decidirRescate(f, ruta, ahora);
      if (d === 'reenviar') { if (await reenviar(f)) r.reenviados++; }
      else if ((d === 'sin_alternativa' && f.rescate !== 'sin_alternativa') || d === 'agotado') {
        const m = await q(`UPDATE wa_entregas_impar SET rescate=$3 WHERE canal_id=$1 AND wa_id=$2
            AND (rescate IS NULL OR (rescate='sin_alternativa' AND $3='agotado'))`,
          [f.canal_id, f.wa_id, d]).catch(() => ({ rowCount: 0 }));
        if (!m.rowCount) continue;
        d === 'agotado' ? r.agotados++ : r.sinAlternativa++;
        await avisarAdmins(f, 'Mensaje de WhatsApp sin leer',
          d === 'agotado'
            ? 'El cliente no pudo leer un mensaje ni por número ni por LID. Conviene contactarlo por otro medio.'
            : 'El cliente no pudo leer un mensaje y WhatsApp todavía no informó otra ruta. Se resolverá cuando el cliente vuelva a escribir.');
        emitir(f.empresa_id, 'neg:patch', { id: f.negociacion_id });
      }
    }
    if (r.reenviados || r.sinAlternativa || r.agotados)
      console.log(`[wa:rescate] reenviados=${r.reenviados} sin_alternativa=${r.sinAlternativa} agotados=${r.agotados}`);
    return r;
  } finally { enCurso = false; }
}

/** Después de reparar el cifrado con un cliente: reenvía UNA vez los mensajes de las últimas 24 h
 * que el cliente no pudo leer («Esperando mensaje»). Máximo 5, nunca un reenvío de un reenvío. */
export async function reenviarPendientesCliente(empresaId, canalId, negociacionId) {
  const { rows } = await q(`SELECT we.canal_id,we.wa_id,we.empresa_id,o.id AS outbox_id,o.negociacion_id,o.mensaje_id
      FROM wa_entregas_impar we JOIN outbox o ON o.id=we.outbox_id AND o.empresa_id=we.empresa_id
     WHERE we.empresa_id=$1 AND we.canal_id=$2 AND we.reintentos>0 AND we.reenviado_ts IS NULL
       AND (we.rescate IS NULL OR we.rescate='sin_alternativa') AND o.reenvio_de IS NULL
       AND we.reintento_ts > now()-interval '24 hours'
       AND NOT (we.leido_ts IS NOT NULL AND we.leido_ts>=we.reintento_ts)
       AND o.negociacion_id=$3
     ORDER BY we.reintento_ts LIMIT 5`, [empresaId, canalId, negociacionId]);
  let n = 0;
  for (const f of rows) if (await reenviar(f)) n++;
  return n;
}
