/** Tokens de API cifrados en reposo. Nunca guardar ni registrar la clave. */
import crypto from 'node:crypto';
const PREFIX='enc:v1:';
function clave(){
  const raw=String(process.env.META_TOKEN_ENCRYPTION_KEY||'');
  if(!/^[0-9a-f]{64}$/i.test(raw))throw new Error(
    'Configurá META_TOKEN_ENCRYPTION_KEY con 32 bytes hexadecimales antes de guardar credenciales de Meta.');
  return Buffer.from(raw,'hex');
}
export function cifrarToken(token){
  const original=String(token||'').trim();
  if(!original || original.length>8192)throw new Error('Token de acceso inválido.');
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',clave(),iv);
  const encoded=Buffer.concat([cipher.update(original,'utf8'),cipher.final()]);
  return PREFIX+Buffer.concat([iv,cipher.getAuthTag(),encoded]).toString('base64url');
}
export function resolverToken(token){
  const original=String(token||'');
  if(!original.startsWith(PREFIX))return original; // canales antiguos existentes
  const all=Buffer.from(original.slice(PREFIX.length),'base64url');
  if(all.length<29)throw new Error('Credencial de Meta incompleta.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',clave(),all.subarray(0,12));
  decipher.setAuthTag(all.subarray(12,28));
  return Buffer.concat([decipher.update(all.subarray(28)),decipher.final()]).toString('utf8');
}
export function tokenConfigurado(token){return !!String(token||'').trim();}
