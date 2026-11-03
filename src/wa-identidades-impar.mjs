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
  const remoto=base(clave.remoteJid);
  // Baileys 6.7.24 no utiliza siempre el mismo campo para el JID alternativo.
  // El receptor antiguo de IMPAR ya contemplaba participantPn/participantAlt.
  const alternos=[
    clave.senderPn,clave.remoteJidAlt,clave.participantPn,
    clave.participantAlt,clave.senderLid
  ].map(base).filter(Boolean);
  if(validoLID(remoto)){
    const pn=alternos.find(validoPN);
    if(pn)return {pn,lid:remoto};
  }
  if(validoPN(remoto)){
    const lid=alternos.find(validoLID);
    if(lid)return {pn:remoto,lid};
  }
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
/** Por qué identidad llegó un evento del cliente: 'lid' o 'pn' (null si no se sabe). */
export function modoDesdeEventoWA(clave){
  const remoto=base(clave?.remoteJid);
  return validoLID(remoto)?'lid':validoPN(remoto)?'pn':null;
}
/** Incluso sin pareja en el evento: anotar por qué identidad escribió un contacto ya conocido. */
export async function registrarModoEntranteWA(canal,clave){
  const j=base(clave?.remoteJid), modo=modoDesdeEventoWA(clave);
  if(!modo||!canal?.id)return false;
  const {rowCount}=await q('UPDATE wa_identidades_impar SET modo_entrante=$4,modo_ts=now() '+
    'WHERE empresa_id=$1 AND canal_id=$2 AND (pn_jid=$3 OR lid_jid=$3)',[canal.empresa_id,canal.id,j,modo]);
  return rowCount>0;
}
export async function registrarParejaWA(canal,par,fuente='mensaje_entrante',modo=null){
  const pareja=validarParejaWA(par?.pn,par?.lid);
  if(!pareja||!canal?.id||!canal?.empresa_id)return false;
  const m=modo==='lid'||modo==='pn'?modo:null;
  // Si WhatsApp informa un nuevo LID para el mismo PN, se vuelve a la ruta
  // automática y se olvidan los fallos: la identidad anterior ya no aplica.
  await q(
    'INSERT INTO wa_identidades_impar(empresa_id,canal_id,pn_jid,lid_jid,fuente,modo_entrante,modo_ts) '+
    'VALUES($1,$2,$3,$4,$5,$6::text,CASE WHEN $6::text IS NULL THEN NULL ELSE now() END) '+
    'ON CONFLICT(canal_id,pn_jid) DO UPDATE SET '+
    'lid_jid=EXCLUDED.lid_jid,fuente=EXCLUDED.fuente,actualizada=now(), '+
    'modo_entrante=COALESCE(EXCLUDED.modo_entrante,wa_identidades_impar.modo_entrante), '+
    'modo_ts=COALESCE(EXCLUDED.modo_ts,wa_identidades_impar.modo_ts), '+
    'preferir_lid=CASE WHEN wa_identidades_impar.lid_jid=EXCLUDED.lid_jid '+
    'THEN wa_identidades_impar.preferir_lid ELSE false END, '+
    "ruta=CASE WHEN wa_identidades_impar.lid_jid=EXCLUDED.lid_jid THEN wa_identidades_impar.ruta ELSE 'auto' END, "+
    'fallos_pn=CASE WHEN wa_identidades_impar.lid_jid=EXCLUDED.lid_jid THEN wa_identidades_impar.fallos_pn ELSE 0 END, '+
    'fallos_lid=CASE WHEN wa_identidades_impar.lid_jid=EXCLUDED.lid_jid THEN wa_identidades_impar.fallos_lid ELSE 0 END',
    [canal.empresa_id,canal.id,pareja.pn,pareja.lid,fuente,m]);
  return true;
}
/** Resolver un @lid entrante contra un PN realmente observado, sin inferir números.
 * Si el mapa es ambiguo, preservar @lid; jamás atribuir mensajes a otro cliente.
 */
export async function resolverRemitenteWA(canal,clave){
  const directo=base(clave?.remoteJid);
  if(!directo || !validoLID(directo) && !validoPN(directo))return null;
  const par=parejaDesdeEventoWA(clave);
  if(par)return par.pn.split('@')[0];
  if(validoPN(directo))return directo.split('@')[0];
  try {
    const {rows}=await q(
      'SELECT pn_jid FROM wa_identidades_impar '+
      'WHERE empresa_id=$1 AND canal_id=$2 AND lid_jid=$3 LIMIT 2',
      [canal.empresa_id,canal.id,directo]);
    return rows.length===1 && validoPN(rows[0].pn_jid)
      ? rows[0].pn_jid.split('@')[0] : directo;
  }catch(e){
    console.warn('[wa:identidades] mapa de recepción no disponible; se conserva LID:',e.name);
    return directo;
  }
}

const VIGENCIA_FALLO_MS=30*24*3600*1000;
/** Decide la ruta para un contacto con equivalencia PN/LID verificada.
 * - Elección manual del admin ('pn' o 'lid'): se respeta.
 * - Automática: se usa la ruta que no falló; sin fallos recientes, la misma
 *   identidad por la que el cliente escribió por última vez; si no se sabe, el número.
 */
export function decidirRutaWA(fila,ahora=Date.now()){
  if(!fila)return {usar:'pn',motivo:'sin_equivalencia'};
  if(fila.ruta==='lid')return {usar:'lid',motivo:'manual'};
  if(fila.ruta==='pn')return {usar:'pn',motivo:'manual'};
  const recientes=fila.fallo_ts && ahora-new Date(fila.fallo_ts).getTime()<VIGENCIA_FALLO_MS;
  const fp=recientes?Number(fila.fallos_pn)||0:0, fl=recientes?Number(fila.fallos_lid)||0:0;
  if(fp>fl)return {usar:'lid',motivo:'fallo_numero'};
  if(fl>fp)return {usar:'pn',motivo:'fallo_lid'};
  if(fila.modo_entrante==='lid')return {usar:'lid',motivo:'cliente_escribe_lid'};
  return {usar:'pn',motivo:fila.modo_entrante==='pn'?'cliente_escribe_numero':'predeterminada'};
}
const COLUMNAS='lid_jid,preferir_lid,ruta,modo_entrante,modo_ts,fallos_pn,fallos_lid,fallo_ts,actualizada';
export async function rutaParaEnvioWA(canal,destino){
  const pn=telefonoAStringJid(destino);
  if(!pn || !validoPN(pn))return {destino:pn||destino,origen:'sin_pn'};
  const {rows}=await q(
    'SELECT '+COLUMNAS+' FROM wa_identidades_impar '+
    'WHERE empresa_id=$1 AND canal_id=$2 AND pn_jid=$3 LIMIT 1',
    [canal.empresa_id,canal.id,pn]);
  const verificada=validarParejaWA(pn,rows[0]?.lid_jid);
  if(!verificada)return {destino:pn,origen:'pn',tieneLid:false,motivo:'sin_equivalencia'};
  const d=decidirRutaWA(rows[0]);
  return {destino:d.usar==='lid'?verificada.lid:pn,origen:d.usar==='lid'?'lid_verificado':'pn',tieneLid:true,motivo:d.motivo};
}
export async function estadoRutaWA(empresaId,canalId,numero){
  const pn=telefonoAStringJid(numero);
  if(!pn||!validoPN(pn))return {disponible:false,alternativa:false,activa:false};
  const {rows}=await q('SELECT '+COLUMNAS+' FROM wa_identidades_impar '+
    'WHERE empresa_id=$1 AND canal_id=$2 AND pn_jid=$3 LIMIT 1',
    [empresaId,canalId,pn]);
  const f=rows[0], alternativa=!!validarParejaWA(pn,f?.lid_jid);
  const d=alternativa?decidirRutaWA(f):{usar:'pn',motivo:'sin_equivalencia'};
  return {disponible:true,alternativa,activa:d.usar==='lid',ruta:f?.ruta||'auto',usar:d.usar,motivo:d.motivo,
    modoEntrante:f?.modo_entrante||null,fallosNumero:Number(f?.fallos_pn)||0,fallosLid:Number(f?.fallos_lid)||0,
    actualizada:f?.actualizada||null};
}
/** ruta: 'auto' | 'pn' | 'lid'. Acepta también el booleano anterior (true=lid, false=auto). */
export async function elegirRutaWA(empresaId,canalId,numero,ruta){
  const pn=telefonoAStringJid(numero);
  if(!pn||!validoPN(pn))return false;
  const r=ruta===true?'lid':ruta===false?'auto':ruta;
  if(!['auto','pn','lid'].includes(r))return false;
  const {rowCount}=await q('UPDATE wa_identidades_impar SET ruta=$4,preferir_lid=($4=\'lid\'),'+
    'fallos_pn=CASE WHEN $4=\'auto\' THEN 0 ELSE fallos_pn END,fallos_lid=CASE WHEN $4=\'auto\' THEN 0 ELSE fallos_lid END,actualizada=now() '+
    'WHERE empresa_id=$1 AND canal_id=$2 AND pn_jid=$3',
    [empresaId,canalId,pn,r]);
  return rowCount===1;
}

/** WhatsApp avisa (recibo «retry») que el teléfono del cliente no pudo descifrar un
 * mensaje nuestro. Se anota el fallo en la ruta usada; el próximo envío usa la otra
 * ruta verificada. No reenvía nada por su cuenta. */
export async function registrarReintentoWA(canal,attrs){
  const desde=base(attrs?.from), waId=String(attrs?.id||'');
  if(!canal?.id || !(validoPN(desde)||validoLID(desde)))return null;
  let tipo=validoLID(desde)?'lid':'pn', outboxId=null;
  if(/^[A-Za-z0-9_.:-]{4,180}$/.test(waId)){
    const {rows}=await q(
      'UPDATE wa_entregas_impar SET reintentos=reintentos+1,reintento_ts=now(),actualizado=now() '+
      'WHERE canal_id=$1 AND wa_id=$2 RETURNING jid_tipo,outbox_id',[canal.id,waId]);
    if(rows[0]?.jid_tipo==='lid'||rows[0]?.jid_tipo==='pn')tipo=rows[0].jid_tipo;
    outboxId=rows[0]?.outbox_id||null;
  }
  const col=tipo==='lid'?'fallos_lid':'fallos_pn';
  const {rowCount}=await q(
    'UPDATE wa_identidades_impar SET '+col+'=LEAST('+col+'+1,50),fallo_ts=now() '+
    'WHERE empresa_id=$1 AND canal_id=$2 AND (pn_jid=$3 OR lid_jid=$3)',
    [canal.empresa_id,canal.id,desde]);
  return {tipo,contacto:rowCount>0,outboxId};
}
/** Un mensaje leído (sin avisos de reintento) confirma que esa ruta funciona. */
export async function confirmarRutaWA(canal,remoteJid){
  const j=base(remoteJid);
  if(!canal?.id || !(validoPN(j)||validoLID(j)))return false;
  const col=validoLID(j)?'fallos_lid':'fallos_pn';
  const {rowCount}=await q('UPDATE wa_identidades_impar SET '+col+'=0 '+
    'WHERE empresa_id=$1 AND canal_id=$2 AND (pn_jid=$3 OR lid_jid=$3) AND '+col+'>0',
    [canal.empresa_id,canal.id,j]);
  return rowCount>0;
}
