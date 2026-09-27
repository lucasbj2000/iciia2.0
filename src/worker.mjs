/** Worker de mensajería: drena inbox y outbox con reintentos y cuarentena. */
import { q } from './db.mjs';
import { ingresarMensaje, notificar } from './core.mjs';
import * as baileys from './channels/baileys.mjs';
import * as meta from './channels/meta.mjs';

const MAX_INTENTOS = 3;
const MAX_ENVIOS = 8;
const ORIGEN = { whatsapp_qr: 'whatsapp', whatsapp_api: 'whatsapp', messenger: 'facebook', instagram: 'instagram' };
const EXTERNO = { whatsapp_qr: 'whatsapp', whatsapp_api: 'whatsapp', messenger: 'messenger', instagram: 'instagram' };

let corriendo = false;

export async function drenarInbox() {
  if (corriendo) return;
  corriendo = true;
  try {
    const { rows } = await q(
      `SELECT i.*, c.sucursal_id, c.linea AS canal_linea, s.nombre AS canal_sucursal
         FROM inbox i
         LEFT JOIN canales c ON c.id = i.canal_id
         LEFT JOIN sucursales s ON s.id = c.sucursal_id
        WHERE i.estado='pendiente' ORDER BY i.ts ASC LIMIT 100`);
    for (const m of rows) {
      try {
        const { rows: es } = await q('SELECT * FROM empresas WHERE id=$1 AND activa', [m.empresa_id]);
        const empresa = es[0];
        if (!empresa) throw new Error('empresa inexistente o inactiva');
        await ingresarMensaje(empresa, {
          canalId: m.canal_id, canalSucursal: m.canal_sucursal, canalLinea: m.canal_linea,
          origen: ORIGEN[m.tipo] || 'otro', externoTipo: EXTERNO[m.tipo],
          extId: m.ext_id, remitente: m.remitente, nombre: m.nombre, texto: m.txt,
          mediaUrl: m.media_url, mediaTipo: m.media_tipo, mediaNombre: m.media_nombre,
          archivoId: m.payload?.archivoId || null, ubicacion: m.ubicacion,
          ts: m.payload?.ts || m.ts
        });
        await q(`UPDATE inbox SET estado='procesado', procesado=now(), error=NULL WHERE id=$1`, [m.id]);
      } catch (e) {
        const intentos = m.intentos + 1;
        if (intentos >= MAX_INTENTOS) {
          await q(`UPDATE inbox SET estado='cuarentena', intentos=$2, error=$3 WHERE id=$1`, [m.id, intentos, e.message]);
          const { rows: es } = await q('SELECT * FROM empresas WHERE id=$1', [m.empresa_id]);
          if (es[0]) await notificar(es[0], 'cuarentena', { cantidad: 1 }, []);
          console.error(`[worker] ${m.ext_id} → cuarentena:`, e.message);
        } else {
          await q(`UPDATE inbox SET intentos=$2, error=$3 WHERE id=$1`, [m.id, intentos, e.message]);
        }
      }
    }
  } finally { corriendo = false; }
}

export async function drenarOutbox() {
  const { rows } = await q(
    `SELECT o.*, c.tipo, c.config, c.nombre AS canal_nombre, c.empresa_id AS c_emp,
            a.archivo, a.mime, a.tipo AS a_tipo, a.nombre AS a_nombre
       FROM outbox o
       LEFT JOIN canales c ON c.id = o.canal_id
       LEFT JOIN archivos a ON a.id = o.archivo_id
      WHERE o.estado='pendiente' AND o.intentos < $1 ORDER BY o.ts ASC LIMIT 50`, [MAX_ENVIOS]);

  for (const o of rows) {
    try {
      if (!o.canal_id) throw new Error('mensaje sin canal asignado');
      const canal = { id: o.canal_id, tipo: o.tipo, config: o.config, nombre: o.canal_nombre, empresa_id: o.c_emp };
      const adjunto = o.archivo_id
        ? { id: o.archivo_id, archivo: o.archivo, mime: o.mime, tipo: o.a_tipo,
            nombre: o.a_nombre, url: `/media/${o.c_emp}/${o.archivo}` }
        : null;
      const cuerpo = o.txt || '';

      if (o.tipo === 'whatsapp_qr') await baileys.enviar(canal, o.destino, cuerpo, adjunto);
      else if (o.tipo === 'whatsapp_api') await meta.enviarWhatsAppAPI(canal, o.destino, cuerpo, adjunto);
      else if (o.tipo === 'messenger' || o.tipo === 'instagram') await meta.enviarMeta(canal, o.destino, cuerpo, adjunto);
      else throw new Error(`tipo de canal no soportado: ${o.tipo}`);

      await q(`UPDATE outbox SET estado='enviado', enviado=now(), error=NULL WHERE id=$1`, [o.id]);
      if (o.negociacion_id) await marcar(o, 'ok');
    } catch (e) {
      const intentos = o.intentos + 1;
      const agotado = intentos >= MAX_ENVIOS;
      await q(`UPDATE outbox SET intentos=$2, error=$3, estado=$4 WHERE id=$1`,
        [o.id, intentos, e.message, agotado ? 'error' : 'pendiente']);
      if (agotado && o.negociacion_id) await marcar(o, 'error');
    }
  }
}

const marcar = (o, estado) => q(
  `UPDATE mensajes SET estado=$4 WHERE negociacion_id=$1 AND estado='pendiente'
     AND COALESCE(txt,'')=COALESCE($2,'') AND COALESCE(archivo_id::text,'')=COALESCE($3,'')`,
  [o.negociacion_id, o.txt, o.archivo_id || '', estado]);

export async function reprocesarCuarentena(empresaId) {
  const { rowCount } = await q(
    `UPDATE inbox SET estado='pendiente', intentos=0, error=NULL WHERE empresa_id=$1 AND estado='cuarentena'`, [empresaId]);
  await drenarInbox();
  return rowCount;
}

export function arrancarWorkers() {
  setInterval(() => drenarInbox().catch(e => console.error('[inbox]', e.message)), 2000);
  setInterval(() => drenarOutbox().catch(e => console.error('[outbox]', e.message)), 5000);
  console.log('✔ Workers de mensajería activos');
}
