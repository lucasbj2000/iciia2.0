/** Cola durable de webhooks Meta: ACK solo tras commit de PostgreSQL. */
import crypto from 'node:crypto';
import {q} from './db.mjs';

export async function encolarWebhookMeta(body,rawBody){
  const hash=crypto.createHash('sha256').update(rawBody).digest('hex');
  const objeto=body?.object;
  if(!['whatsapp_business_account','page','instagram'].includes(objeto))
    throw Object.assign(new Error('Evento de Meta desconocido.'),{status:422});
  await q(
    'INSERT INTO meta_webhook_eventos_impar(sha256,objeto,payload) '+
    'VALUES($1,$2,$3::jsonb) ON CONFLICT(sha256) DO NOTHING',
    [hash,objeto,JSON.stringify(body)]);
}
let activo=false;
export async function drenarWebhooksMeta(){
  if(activo)return;
  activo=true;
  try{
    // Recuperar trabajos reclamados por un proceso que terminó abruptamente.
    await q("UPDATE meta_webhook_eventos_impar SET estado='pendiente',procesando_desde=NULL "+
      "WHERE estado='procesando' AND procesando_desde < now()-interval '5 minutes'");
    for(let index=0;index<20;index++){
      const r=await q(
        "UPDATE meta_webhook_eventos_impar SET estado='procesando',procesando_desde=now() "+
        "WHERE id=(SELECT id FROM meta_webhook_eventos_impar WHERE estado='pendiente' "+
        "ORDER BY recibido LIMIT 1 FOR UPDATE SKIP LOCKED) "+
        "RETURNING id,objeto,payload,intentos");
      const trabajo=r.rows[0];
      if(!trabajo)break;
      try{
        const {procesarWebhookGuardado}=await import('./channels/meta.mjs');
        await procesarWebhookGuardado(trabajo.objeto,trabajo.payload);
        // Descartar contenido personal después de procesarlo; deduplicación por hash permanece.
        await q("UPDATE meta_webhook_eventos_impar SET estado='procesado',procesado=now(), "+
          "payload=NULL,error=NULL WHERE id=$1",[trabajo.id]);
      }catch(e){
        const intentos=trabajo.intentos+1;
        await q("UPDATE meta_webhook_eventos_impar SET estado=$2,intentos=$3,error=$4,"+
          "procesando_desde=NULL WHERE id=$1",
          [trabajo.id,intentos,intentos>=6?'cuarentena':'pendiente',
            String(e?.message||'Error').slice(0,250)]);
        console.error('[meta] no se procesó evento '+trabajo.id+': '+String(e?.name||'error'));
        // No bloquear otras empresas, pero evitar un bucle sobre el mismo evento.
        break;
      }
    }
  }finally{activo=false;}
}
