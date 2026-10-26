/** IMPAR · identidad de destinatario verificada por la sesión WhatsApp existente.
 * Nunca inferir LID desde un número ni usar mapas de otra empresa/canal.
 */
import {q} from './db.mjs';

const base = valor => String(valor||'').trim().toLowerCase()
  .replace(/:([0-9]+)@(s\.whatsapp\.net|lid)$/,'@$2');
const validoPN = valor => /^([0-9]{10,15})@s\.whatsapp\.net$/.test(valor);
const validoLID = valor => /^([0-9]{6,22})@lid$/.test(valor);

export function parejaDesdeEventoWA(clave){
  if(!clave || typeof clave!=='object')return null;
  const remoto=base(clave.remoteJid),pnAlt=base(clave.senderPn||clave.remoteJidAlt),
    lidAlt=base(clave.senderLid||clave.remoteJidAlt);
  if(validoLID(remoto)&&validoPN(pnAlt))return {pn:pnAlt,lid:remoto};
  if(validoPN(remoto)&&validoLID(lidAlt))return {pn:remoto,lid:lidAlt};
  return null;
}
export function validarParejaWA(pn,lid){
  const p=base(pn),l=base(lid);
  return validoPN(p)&&validoLID(l)?{pn:p,lid:l}:null;
}
export function telefonoAStringJid(numero){
  const s=String(numero??'').trim();
  if(s.includes('@'))return base(s);
  let digitos=s.replace(/\D/g,'');
  if(digitos.startsWith('09')&&digitos.length===10)digitos='595'+digitos.slice(1);
  if(!/^[0-9]{10,15}$/.test(digitos))return null;
  return digitos+'@s.whatsapp.net';
}
export async function registrarParejaWA(canal,par,fuente='mensaje_entrante'){
  const pareja=validarParejaWA(par?.pn,par?.lid);
  if(!pareja||!canal?.id||!canal?.empresa_id)return false;
  // Si WhatsApp informa un nuevo LID para el mismo PN, desactivar el permiso
  // anterior para que la ruta nueva requiera confirmación explícita.
  await q(
    'INSERT INTO wa_identidades_impar(empresa_id,canal_id,pn_jid,lid_jid,fuente) '+
    'VALUES($1,$2,$3,$4,$5) ON CONFLICT(canal_id,pn_jid) DO UPDATE SET '+
    'lid_jid=EXCLUDED.lid_jid,fuente=EXCLUDED.fuente,actualizada=now(), '+
    'preferir_lid=CASE WHEN wa_identidades_impar.lid_jid=EXCLUDED.lid_jid '+
    'THEN wa_identidades_impar.preferir_lid ELSE false END',
    [canal.empresa_id,canal.id,pareja.pn,pareja.lid,fuente]);
  return true;
}
export async function rutaParaEnvioWA(canal,destino){
  const pn=telefonoAStringJid(destino);
  if(!pn || !validoPN(pn))return {destino:pn||destino,origen:'sin_pn'};
  const {rows}=await q(
    'SELECT lid_jid,preferir_lid FROM wa_identidades_impar '+
    'WHERE empresa_id=$1 AND canal_id=$2 AND pn_jid=$3 LIMIT 1',
    [canal.empresa_id,canal.id,pn]);
  const verificada=validarParejaWA(pn,rows[0]?.lid_jid);
  const usar=Boolean(rows[0]?.preferir_lid && verificada);
  return {destino:usar?verificada.lid:pn,origen:usar?'lid_verificado':'pn',tieneLid:!!verificada};
}
export async function estadoRutaWA(empresaId,canalId,numero){
  const pn=telefonoAStringJid(numero);
  if(!pn||!validoPN(pn))return {disponible:false,alternativa:false,activa:false};
  const {rows}=await q('SELECT lid_jid,preferir_lid,actualizada FROM wa_identidades_impar '+
    'WHERE empresa_id=$1 AND canal_id=$2 AND pn_jid=$3 LIMIT 1',
    [empresaId,canalId,pn]);
  return {disponible:true,alternativa:!!validarParejaWA(pn,rows[0]?.lid_jid),
    activa:!!rows[0]?.preferir_lid,actualizada:rows[0]?.actualizada||null};
}
export async function elegirRutaWA(empresaId,canalId,numero,usarLid){
  const pn=telefonoAStringJid(numero);
  if(!pn||!validoPN(pn))return false;
  const {rowCount}=await q('UPDATE wa_identidades_impar SET preferir_lid=$4,actualizada=now() '+
    'WHERE empresa_id=$1 AND canal_id=$2 AND pn_jid=$3',
    [empresaId,canalId,pn,Boolean(usarLid)]);
  return rowCount===1;
}
