/** Worker de mensajería: drena inbox y outbox con reintentos y cuarentena. */
import { q } from './db.mjs';
import { ingresarMensaje, notificar } from './core.mjs';
import * as baileys from './channels/baileys.mjs';
import * as meta from './channels/meta.mjs';
import { emitir } from './realtime.mjs';
import { derivarRecepcionesVencidas } from './recepcion-impar.mjs';
import { registrarEnvioImpar } from './wa-entregas-impar.mjs';
import { drenarWebhooksMeta } from './meta-webhooks-impar.mjs';
import { resolverRemitenteWA } from './wa-identidades-impar.mjs';

const MAX_INTENTOS = 3;
const MAX_ENVIOS = 8;
const ORIGEN = { whatsapp_qr: 'whatsapp', whatsapp_api: 'whatsapp', messenger: 'facebook', instagram: 'instagram' };
const EXTERNO = { whatsapp_qr: 'whatsapp', whatsapp_api: 'whatsapp', messenger: 'messenger', instagram: 'instagram' };

let corriendoInbox = false;
let corriendoOutbox = false;

export async function drenarInbox() {
  if (corriendoInbox) return;
  corriendoInbox = true;
  try {
    const { rows } = await q(
      `SELECT i.*, c.sucursal_id, c.linea AS canal_linea, s.nombre AS canal_sucursal,
                ((c.config->>'principal_global')='true' OR (lower(trim(c.nombre))='principal' AND lower(trim(s.nombre))='central')) AS canal_compartido
         FROM inbox i
         LEFT JOIN canales c ON c.id = i.canal_id
         LEFT JOIN sucursales s ON s.id = c.sucursal_id
        WHERE i.estado='pendiente' ORDER BY i.ts ASC LIMIT 100`);
    for (const m of rows) {
      try {
        const { rows: es } = await q('SELECT * FROM empresas WHERE id=$1 AND activa', [m.empresa_id]);
        const empresa = es[0];
        if (!empresa) throw new Error('empresa inexistente o inactiva');
        // Recuperar también inbox en espera guardado originalmente con @lid.
        // Solo utilizar PN si existe equivalencia WhatsApp inequívoca de esta línea.
        const remitente=(m.tipo==='whatsapp_qr' && String(m.remitente||'').endsWith('@lid'))
          ? (await resolverRemitenteWA(
             {id:m.canal_id,empresa_id:m.empresa_id},{remoteJid:m.remitente}))||m.remitente
          : m.remitente;
        await ingresarMensaje(empresa, {
          canalId: m.canal_id, canalSucursal: m.canal_compartido ? null : m.canal_sucursal,
          canalLinea: m.canal_compartido ? null : m.canal_linea,
          origen: ORIGEN[m.tipo] || 'otro', externoTipo: EXTERNO[m.tipo],
          extId: m.ext_id, remitente, nombre: m.nombre, texto: m.txt,
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
  } finally { corriendoInbox = false; }
}

export async function drenarOutbox() {
  if (corriendoOutbox) return;
  corriendoOutbox = true;
  try {
  const { rows } = await q(
    `SELECT o.*, c.tipo, c.config, c.nombre AS canal_nombre, c.empresa_id AS c_emp,
            e.flags->>'bot' AS permiso_bot, e.bot->>'activo' AS bot_activo_empresa,
            a.archivo, a.mime, a.tipo AS a_tipo, a.nombre AS a_nombre
       FROM outbox o
       LEFT JOIN empresas e ON e.id = o.empresa_id
       LEFT JOIN canales c ON c.id = o.canal_id
       LEFT JOIN archivos a ON a.id = o.archivo_id
      WHERE o.estado='pendiente' AND o.intentos < $1 ORDER BY o.ts ASC LIMIT 50`, [MAX_ENVIOS]);

  for (const o of rows) {
    try {
      // La autorización se consulta en el momento del envío, no solo al listar la cola:
      // así una pausa global puede detener también un lote que ya estaba en proceso.
      if (o.automatico) {
        const {rows:validez}=await q(
          "SELECT flags->>'bot' AS permitido, bot->>'activo' AS activo FROM empresas WHERE id=$1",[o.empresa_id]);
        if (validez[0]?.permitido !== 'true' || validez[0]?.activo !== 'true') {
          await q("UPDATE outbox SET estado='cancelado',error='Respuesta automática pausada por IMPAR' WHERE id=$1 AND estado='pendiente'",[o.id]);
          continue;
        }
        const {rows:recepcion}=await q(`SELECT n.bot_activo,n.agente_id,n.bot_recepcion,c.responsable_id,
          ca.activo AS canal_activo,ca.bot_activo AS canal_bot,e.codigo,
          EXISTS(SELECT 1 FROM mensajes m WHERE m.empresa_id=n.empresa_id AND m.negociacion_id=n.id
            AND m.dir='out' AND m.bot=FALSE) AS atendida
          FROM negociaciones n JOIN empresas e ON e.id=n.empresa_id
          JOIN contactos c ON c.id=n.contacto_id AND c.empresa_id=n.empresa_id
          LEFT JOIN canales ca ON ca.id=n.canal_id AND ca.empresa_id=n.empresa_id
          WHERE n.id=$1 AND n.empresa_id=$2`,[o.negociacion_id,o.empresa_id]);
        const n=recepcion[0];
        if(!n || (n.codigo==='impar' && (!n.bot_activo || n.agente_id || n.responsable_id || n.atendida
          || !n.canal_activo || n.canal_bot===false || n.bot_recepcion?.elegible!==true || n.bot_recepcion?.version!==2))) {
          await q("UPDATE outbox SET estado='cancelado',error='Recepción no elegible o ya atendida' WHERE id=$1 AND estado='pendiente'",[o.id]);
          await marcar(o,'cancelado');
          continue;
        }
      }
      if (!o.canal_id) throw new Error('mensaje sin canal asignado');
      const canal = { id: o.canal_id, tipo: o.tipo, config: o.config, nombre: o.canal_nombre, empresa_id: o.c_emp };
      const adjunto = o.archivo_id
        ? { id: o.archivo_id, archivo: o.archivo, mime: o.mime, tipo: o.a_tipo,
            nombre: o.a_nombre, url: `/media/${o.c_emp}/${o.archivo}` }
        : null;
      const cuerpo = o.txt || '';

      let enviadoWA=null;
      if (o.tipo === 'whatsapp_qr') enviadoWA=await baileys.enviar(canal, o.destino, cuerpo, adjunto);
      else if (o.tipo === 'whatsapp_api') enviadoWA=await meta.enviarWhatsAppAPI(canal, o.destino, cuerpo, adjunto);
      else if (o.tipo === 'messenger' || o.tipo === 'instagram') await meta.enviarMeta(canal, o.destino, cuerpo, adjunto);
      else throw new Error(`tipo de canal no soportado: ${o.tipo}`);

      // La aceptación no es una confirmación de entrega. Nunca reenviar porque
      // falle el registro posterior de ACK: podría duplicar el pedido del cliente.
      if(o.tipo==='whatsapp_api' && enviadoWA?.messages?.[0]?.id){
        const id=String(enviadoWA.messages[0].id);
        await q(
          "INSERT INTO wa_entregas_impar(canal_id,empresa_id,wa_id,outbox_id,ack,estado_meta) "+
          "VALUES($1,$2,$3,$4,1,'accepted') "+
          "ON CONFLICT(canal_id,wa_id) DO UPDATE SET outbox_id=EXCLUDED.outbox_id, "+
          "actualizado=now()",
          [canal.id,canal.empresa_id,id,o.id]
        ).catch(e=>console.warn('[meta] No se pudo asociar ACK:',e.name));
      }
      if(o.tipo==='whatsapp_qr'){
        await registrarEnvioImpar(canal,enviadoWA,{outboxId:o.id,destino:o.destino})
          .catch(e=>console.warn('[wa:entregas] No se pudo vincular el ACK:',e.message));
      }
      await q(`UPDATE outbox SET estado='enviado', enviado=now(), error=NULL WHERE id=$1`, [o.id]);
      if (o.negociacion_id) await marcar(o, 'ok');
    } catch (e) {
      console.error(`[outbox] ${o.id} · ${o.tipo || 'sin-canal'}:`, e.message);
      const intentos = o.intentos + 1;
      const agotado = intentos >= MAX_ENVIOS;
      await q(`UPDATE outbox SET intentos=$2, error=$3, estado=$4 WHERE id=$1`,
        [o.id, intentos, e.message, agotado ? 'error' : 'pendiente']);
      if (agotado && o.negociacion_id) await marcar(o, 'error');
    }
  }
  } finally {
    corriendoOutbox = false;
  }
}

const marcar = async (o, estado) => {
  await q(
  `UPDATE mensajes SET estado=$4 WHERE negociacion_id=$1 AND estado='pendiente'
     AND COALESCE(txt,'')=COALESCE($2,'') AND COALESCE(archivo_id::text,'')=COALESCE($3,'')`,
  [o.negociacion_id, o.txt, o.archivo_id || '', estado]);
  emitir(o.empresa_id, 'neg:patch', { id: o.negociacion_id });
};

export async function reprocesarCuarentena(empresaId) {
  const { rowCount } = await q(
    `UPDATE inbox SET estado='pendiente', intentos=0, error=NULL WHERE empresa_id=$1 AND estado='cuarentena'`, [empresaId]);
  await drenarInbox();
  return rowCount;
}

export function arrancarWorkers() {
  // Plazos persistentes: también recupera las recepciones tras reiniciar PM2.
  setInterval(() => derivarRecepcionesVencidas().catch(e => console.error('[recepcion]', e.message)), 30000);
  setInterval(() => drenarWebhooksMeta().catch(e => console.error('[webhook meta]',e.name)), 15000);
  setInterval(() => drenarInbox().catch(e => console.error('[inbox]', e.message)), 2000);
  setInterval(() => drenarOutbox().catch(e => console.error('[outbox]', e.message)), 5000);
  console.log('✔ Workers de mensajería activos');
}
