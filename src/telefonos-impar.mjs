/** IMPAR: un contacto puede tener varios teléfonos sin duplicar su ficha.
 * El código usa el mismo criterio telNorm del CRM histórico (últimos 8 dígitos).
 * Ante colisión devuelve conflicto; nunca fusiona automáticamente clientes.
 */
import { telNorm } from './db.mjs';

export const errorTelefono=(status,message)=>Object.assign(new Error(message),{status});
export function normalizarNumero(numero) {
  const bruto=String(numero??'').trim();
  const digitos=bruto.replace(/\D/g,'');
  if(digitos.length<10 || digitos.length>15 || !/^\+?[\d\s().-]+$/.test(bruto))
    throw errorTelefono(422,'Indicá un teléfono completo con código de país (10 a 15 dígitos).');
  let salida=digitos;
  if(salida.startsWith('09')&&salida.length===10)salida='595'+salida.slice(1);
  if(salida.startsWith('0'))throw errorTelefono(422,'Ingresá el teléfono con código de país, sin cero inicial.');
  return {numero:salida,clave:telNorm(salida)};
}
export async function telefonosContacto(db,empresaId,contactoId) {
  const {rows}=await db.query(
    'SELECT id,numero,tel_norm,etiqueta FROM contacto_telefonos '+
    'WHERE empresa_id=$1 AND contacto_id=$2 ORDER BY (etiqueta=$3) DESC,creado,id',
    [empresaId,contactoId,'Principal']);
  return rows;
}
export async function agregarTelefono(db,empresaId,contactoId,entrada,etiqueta='Secundario'){
  const {numero,clave}=normalizarNumero(entrada);
  // Lock por teléfono ANTES de verificar contactos legados, para impedir carreras
  // entre dos agentes que intenten agregar la misma identidad simultáneamente.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[empresaId+':'+clave]);
  const {rows:primarios}=await db.query(
    'SELECT id FROM contactos WHERE empresa_id=$1 AND tel_norm=$2 FOR UPDATE',
    [empresaId,clave]);
  if(primarios.some(c=>c.id!==contactoId))
    throw errorTelefono(409,'Este número ya pertenece a otro cliente de IMPAR. No se modificó ninguna ficha.');
  if(primarios.some(c=>c.id===contactoId))
    throw errorTelefono(409,'Este número ya está registrado como principal del cliente.');
  const {rows:ya}=await db.query(
    'SELECT contacto_id FROM contacto_telefonos WHERE empresa_id=$1 AND tel_norm=$2 FOR UPDATE',
    [empresaId,clave]);
  if(ya.length)
    throw errorTelefono(409,ya[0].contacto_id===contactoId
      ? 'El cliente ya tiene este número vinculado.'
      : 'El número está vinculado a otro cliente. No se fusionarán sus historiales automáticamente.');
  const txt=String(etiqueta||'Secundario').trim().slice(0,35)||'Secundario';
  const {rows}=await db.query(
    'INSERT INTO contacto_telefonos(empresa_id,contacto_id,numero,tel_norm,etiqueta) '+
    'VALUES($1,$2,$3,$4,$5) RETURNING id,numero,tel_norm,etiqueta',
    [empresaId,contactoId,numero,clave,txt]);
  return rows[0];
}
export async function buscarPorTelefono(db,empresaId,numero) {
  const t=telNorm(numero);
  if(!t)return null;
  const {rows}=await db.query(
    'SELECT DISTINCT c.* FROM contactos c '+
    'LEFT JOIN contacto_telefonos t ON t.contacto_id=c.id AND t.empresa_id=c.empresa_id '+
    'WHERE c.empresa_id=$1 AND (c.tel_norm=$2 OR t.tel_norm=$2) LIMIT 2',
    [empresaId,t]);
  if(rows.length>1)throw errorTelefono(409,'El teléfono está asociado a varias fichas preexistentes. Revisalo desde Administración antes de continuar.');
  return rows[0]||null;
}
export function puedeEditarContacto(user,contacto,negociaciones=[]) {
  if(!user||!contacto)return false;
  if(['admin','gerente'].includes(user.rol))return true;
  if(contacto.responsable_id===user.id)return true;
  if(user.rol==='agente')return negociaciones.some(n=>n.agente_id===user.id);
  if(user.rol==='jefe')return negociaciones.some(n=>n.agente_id===user.id);
  return false;
}
