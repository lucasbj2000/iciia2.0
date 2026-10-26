/** IMPAR · recuperación de mensajes originales ante fallas de descifrado Signal.
 * No reenviar contenido como mensaje nuevo. WhatsApp/Baileys controla el
 * handshake de solicitud de reintento mediante getMessage.
 *
 * Las claves son (canal, JID exacto, ID mensaje). Jamás buscar solo por ID.
 * Si no existe un mensaje original, devolver undefined, no mensaje vacío.
 */
const TTL_MS=7*24*60*60*1000;
const MAX_CACHE=350;
const LIMPIEZA_MS=6*60*60*1000;
let ultimoBarrido=0;

export function claveReintento(key){
  if(!key || key.fromMe===false || typeof key.id!=='string' ||
    typeof key.remoteJid!=='string')return null;
  const recibido=key.remoteJid.trim().toLowerCase();
  const id=key.id.trim();
  if(!/^[0-9a-z.+:-]+@(s\.whatsapp\.net|lid)$/.test(recibido) ||
     !/^[a-zA-Z0-9._:-]{4,128}$/.test(id))return null;
  // En solicitudes de recuperación, WhatsApp puede incluir el índice
  // específico del dispositivo (usuario:3@s.whatsapp.net). El mensaje
  // original se guardó para usuario@s.whatsapp.net. Quitar solamente el
  // sufijo numérico de dispositivo, sin intercambiar usuarios ni LID/PN.
  const jid=recibido.replace(/:([0-9]+)@(s\.whatsapp\.net|lid)$/,'@$2');
  return {jid,id};
}
const claveCache=k=>k.jid+'|'+k.id;

function agregarCache(cache,k,contenido){
  if(!cache)return;
  const clave=claveCache(k);
  cache.delete(clave);
  cache.set(clave,{contenido,vence:Date.now()+TTL_MS});
  while(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);
}
function desdeCache(cache,k){
  const entrada=cache?.get(claveCache(k));
  if(!entrada)return null;
  if(entrada.vence<=Date.now()){cache.delete(claveCache(k));return null;}
  return entrada.contenido;
}

export async function guardarOriginal({q,proto,canalId,empresaId,enviado,cache}){
  const k=claveReintento(enviado?.key);
  if(!k || !enviado?.message || !proto?.Message)return false;
  // Una falla al serializar ocurre DESPUÉS de que WhatsApp aceptó el envío:
  // no propagarla al worker, porque reenviaría otro mensaje como nuevo.
  let contenido;
  try {
    contenido=Buffer.from(proto.Message.encode(enviado.message).finish());
    if(!contenido.length)return false;
    agregarCache(cache,k,contenido);
  } catch(e) {
    console.warn('[wa:retry] no se pudo guardar el original:',e.message);
    return false;
  }
  try{
    await q(
      'INSERT INTO wa_mensajes_reintento (empresa_id,canal_id,jid,mensaje_id,contenido) '+
      'VALUES ($1,$2,$3,$4,$5) '+
      'ON CONFLICT(canal_id,jid,mensaje_id) DO UPDATE '+
      "SET contenido=EXCLUDED.contenido,expira=now()+interval '7 days'",
      [empresaId,canalId,k.jid,k.id,contenido]);
    // Limpiar registros caducados de forma espaciada, sin bloquear envío si falla.
    if(Date.now()-ultimoBarrido>LIMPIEZA_MS){
      ultimoBarrido=Date.now();
      q('DELETE FROM wa_mensajes_reintento WHERE expira<now()').catch(
        e=>console.warn('[wa:retry] limpieza:',e.message));
    }
  }catch(e){
    // El mensaje YA fue enviado por WhatsApp. Nunca provocar que el worker
    // lo reenvíe como nuevo por un fallo de persistencia de su copia.
    console.warn('[wa:retry] original conservado en memoria; base no disponible:',e.message);
  }
  return true;
}

export async function recuperarOriginal({q,proto,canalId,key,cache}){
  const k=claveReintento(key);
  if(!k || !proto?.Message)return undefined;
  let contenido=desdeCache(cache,k);
  if(!contenido){
    try{
      const {rows}=await q(
        'SELECT contenido FROM wa_mensajes_reintento '+
        'WHERE canal_id=$1 AND jid=$2 AND mensaje_id=$3 AND expira>now() LIMIT 1',
        [canalId,k.jid,k.id]);
      contenido=rows[0]?.contenido;
    }catch(e){
      console.warn('[wa:retry] consulta no disponible:',e.message);
      return undefined;
    }
  }
  if(!contenido)return undefined; // Nunca devolver {conversation:''}.
  try{
    return proto.Message.decode(Buffer.isBuffer(contenido)
      ? contenido : Buffer.from(contenido));
  }catch(e){
    console.warn('[wa:retry] mensaje original no decodificable:',e.message);
    return undefined;
  }
}
