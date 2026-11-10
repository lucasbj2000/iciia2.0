/* IMPAR · Red de seguridad de la ventana de 24 h.
   Si Meta rechaza un mensaje del agente enviado por la línea verificada porque pasaron más de 24 h
   (código 131047, o 470 en versiones viejas), el CRM lo reenvía una sola vez por la línea normal.
   Calidad de datos: el intento rechazado no se borra; queda enlazado al mensaje que lo reemplazó.
   Los agentes ven solo el mensaje que salió; administración ve los dos. */
import { q, tx } from './db.mjs';
import { historial } from './core.mjs';
import { emitir } from './realtime.mjs';
import { consultarSalidaNormal } from './principal-central-impar.mjs';

export const CODIGOS_FUERA_DE_VENTANA = new Set(['131047', '470']);

export async function reenviarPorLineaNormal({ canalId, waId, codigo }) {
  if (!CODIGOS_FUERA_DE_VENTANA.has(String(codigo || ''))) return { hecho: false, motivo: 'otro_error' };
  // Solo mensajes escritos por un agente (no automáticos, no campañas) y nunca un reenvío de reenvío.
  const { rows } = await q(`SELECT we.empresa_id, o.id AS outbox_id, o.negociacion_id, o.destino, o.mensaje_id, o.automatico, o.reenvio_de,
        m.autor_id, n.sucursal, u.sucursal AS sucursal_autor
      FROM wa_entregas_impar we
      JOIN outbox o ON o.id=we.outbox_id AND o.empresa_id=we.empresa_id
      JOIN mensajes m ON m.id=o.mensaje_id AND m.empresa_id=o.empresa_id
      JOIN negociaciones n ON n.id=o.negociacion_id AND n.empresa_id=o.empresa_id
      LEFT JOIN usuarios u ON u.id=m.autor_id
     WHERE we.canal_id=$1 AND we.wa_id=$2 AND we.rescate IS NULL AND m.reemplazado_por IS NULL`, [canalId, String(waId)]);
  const f = rows[0];
  if (!f || f.automatico || f.reenvio_de || !f.autor_id) return { hecho: false, motivo: 'no_aplica' };
  let salida;
  try { salida = await consultarSalidaNormal({ query: q }, f.empresa_id, { sucursal: f.sucursal_autor || f.sucursal }); }
  catch (e) {
    await q("UPDATE wa_entregas_impar SET rescate='sin_linea_normal' WHERE canal_id=$1 AND wa_id=$2 AND rescate IS NULL", [canalId, String(waId)]);
    return { hecho: false, motivo: 'sin_linea_normal' };
  }
  const nuevo = await tx(async c => {
    // Reclamar primero: dos avisos de Meta del mismo mensaje no generan dos reenvíos.
    const marca = await c.query("UPDATE wa_entregas_impar SET rescate='linea_normal', reenviado_ts=now() WHERE canal_id=$1 AND wa_id=$2 AND rescate IS NULL",
      [canalId, String(waId)]);
    if (!marca.rowCount) return null;
    // Copia fiel del mensaje (texto, adjunto, autor y hora en que el agente lo escribió), por la línea normal.
    const { rows: copia } = await c.query(
      `INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,autor_id,estado,archivo_id,media_url,media_tipo,media_nombre,media_bytes,canal_id,ts)
       SELECT empresa_id,negociacion_id,'out',txt,autor_id,'pendiente',archivo_id,media_url,media_tipo,media_nombre,media_bytes,$3,ts
         FROM mensajes WHERE id=$1 AND empresa_id=$2 RETURNING id`, [f.mensaje_id, f.empresa_id, salida.id]);
    if (!copia[0]) return null;
    await c.query('UPDATE mensajes SET reemplazado_por=$3 WHERE id=$1 AND empresa_id=$2', [f.mensaje_id, f.empresa_id, copia[0].id]);
    await c.query(
      `INSERT INTO outbox (empresa_id,canal_id,negociacion_id,destino,txt,archivo_id,media_url,media_tipo,media_nombre,mensaje_id,cita)
       SELECT empresa_id,$3,negociacion_id,destino,txt,archivo_id,media_url,media_tipo,media_nombre,$4,cita
         FROM outbox WHERE id=$1 AND empresa_id=$2`, [f.outbox_id, f.empresa_id, salida.id, copia[0].id]);
    // Las próximas respuestas de esta conversación ya salen por la línea normal (hasta que el cliente escriba por la verificada).
    await c.query('UPDATE negociaciones SET canal_id=$3 WHERE id=$1 AND empresa_id=$2 AND canal_id=$4', [f.negociacion_id, f.empresa_id, salida.id, canalId]);
    return copia[0].id;
  });
  if (!nuevo) return { hecho: false, motivo: 'ya_reenviado' };
  await historial(f.empresa_id, f.negociacion_id,
    `Meta no permitió enviar por la línea verificada (pasaron más de 24 h desde el último mensaje del cliente): el mensaje se reenvió solo por «${salida.nombre}»`, 'Sistema');
  emitir(f.empresa_id, 'neg:patch', { id: f.negociacion_id, mensajeId: nuevo });
  return { hecho: true, mensajeId: nuevo, canalId: salida.id };
}
