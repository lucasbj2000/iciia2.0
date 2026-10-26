/** IMPAR · trazabilidad real de acuses. No reenvía mensajes ni cambia la sesión Signal. */
import {q} from './db.mjs';
import {emitir} from './realtime.mjs';

export const interpretarAck = valor => {
  if(valor===null||valor===undefined)return null;
  const n=Number(valor);
  return Number.isInteger(n)&&n>=0&&n<=5?n:null;
};
export const tipoJid = jid => String(jid||'').endsWith('@lid')?'lid':
  String(jid||'').endsWith('@s.whatsapp.net')?'pn':'otro';
const waIdSeguro=id=>typeof id==='string' && /^[A-Za-z0-9_.:-]{4,180}$/.test(id);

/** DESPUÉS de sendMessage: los errores de registro jamás deben generar otro envío. */
export async function registrarEnvioImpar(canal,wa,meta){
  const id=wa?.key?.id;
  if(!waIdSeguro(id) || !meta?.outboxId)return false;
  const ack=interpretarAck(wa?.status);
  await q(
    'INSERT INTO wa_entregas_impar(canal_id,empresa_id,wa_id,outbox_id,ack,jid_tipo) '+
    'VALUES($1,$2,$3,$4,$5,$6) '+
    'ON CONFLICT(canal_id,wa_id) DO UPDATE SET outbox_id=EXCLUDED.outbox_id, '+
    'ack=GREATEST(wa_entregas_impar.ack,EXCLUDED.ack), '+
    'jid_tipo=EXCLUDED.jid_tipo,actualizado=now()',
    [canal.id,canal.empresa_id,id,meta.outboxId,ack??1,tipoJid(wa?.key?.remoteJid||meta.destino)]);
  return true;
}

/** Solo notificaciones de estado actualizan entrega. */
export async function registrarActualizacionImpar(canal,evento){
  if(!evento?.key?.id || evento.key.fromMe===false)return false;
  const id=evento.key.id,ack=interpretarAck(evento?.update?.status);
  if(!waIdSeguro(id) || ack===null || ack===1)return false;
  const {rows}=await q(
    'INSERT INTO wa_entregas_impar(canal_id,empresa_id,wa_id,ack,jid_tipo) '+
    'VALUES($1,$2,$3,$4,$5) '+
    'ON CONFLICT(canal_id,wa_id) DO UPDATE SET '+
    'ack=GREATEST(wa_entregas_impar.ack,EXCLUDED.ack),actualizado=now() '+
    'RETURNING outbox_id',
    [canal.id,canal.empresa_id,id,ack,tipoJid(evento.key.remoteJid)]);
  if(rows[0]?.outbox_id){
    const data=await q('SELECT negociacion_id FROM outbox WHERE id=$1 AND empresa_id=$2',
      [rows[0].outbox_id,canal.empresa_id]);
    const neg=data.rows[0]?.negociacion_id;
    if(neg)emitir(canal.empresa_id,'neg:patch',{id:neg});
  }
  return true;
}
