/* IMPAR: conciliación estricta del CSV Bitrix. Nunca modifica contactos existentes. */
import { createHash } from 'node:crypto';

const quitarTildes = value => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');
export const claveNombre = value => quitarTildes(value).toLowerCase()
  .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
export const claveTelefono = value => {
  const digits = String(value || '').replace(/\D/g,'');
  return digits.length >= 10 && digits.length <= 15 ? digits.slice(-8) : '';
};
export function prepararFila(original, linea) {
  const r = original && typeof original === 'object' && !Array.isArray(original) ? original : {};
  const responsable = String(r.responsable ?? r.Responsable ?? '').trim().slice(0,150);
  const nombre = String(r.nombre ?? r.Nombre ?? '').trim().replace(/\s+/g,' ').slice(0,200);
  const apellido = String(r.apellido ?? r.Apellido ?? '').trim().replace(/\s+/g,' ').slice(0,120);
  const tel = String(r.telefono ?? r['Teléfono del trabajo'] ?? '').trim().slice(0,60);
  // Bitrix suele repetir el apellido en Nombre y Apellido.
  const full = apellido && !claveNombre(nombre).endsWith(' '+claveNombre(apellido)) &&
    claveNombre(nombre) !== claveNombre(apellido) ? (nombre+' '+apellido).trim() : nombre;
  const telefono = tel.replace(/\D/g,'');
  const telefonoClave = claveTelefono(tel);
  const invalido = !claveNombre(full) || claveNombre(full).length < 2 ||
    full==='.' || /\d+[,.]\d+\s*e\s*\+\s*\d+/i.test(full) ||
    /^(\d[\d\s+.,-]*)$/.test(full) || !telefonoClave ||
    !responsable || full.length > 180;
  return { linea, nombre:full, responsable, telefono,
    telefonoClave, nombreClave:claveNombre(full),
    invalido:!!invalido };
}
const crearFirma = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex');

export async function analizarCargaBitrix(cliente, empresaId, body) {
  if (!body || !Array.isArray(body.filas) || body.filas.length<1 || body.filas.length>1000)
    throw Object.assign(new Error('El archivo debe contener entre 1 y 1000 filas.'), {status:422});
  if (body.filas.some(x=>typeof x!=='object' || x===null || Array.isArray(x)))
    throw Object.assign(new Error('El archivo tiene filas inválidas.'), {status:422});
  const asignaciones=body.asignaciones || {};
  if (!asignaciones || typeof asignaciones!=='object' || Array.isArray(asignaciones) ||
      Object.keys(asignaciones).length>100)
    throw Object.assign(new Error('El mapa de responsables no es válido.'), {status:422});

  const contactos=await cliente.query(
    'SELECT id,nombre,tel,tel_norm,externos FROM contactos WHERE empresa_id=$1', [empresaId]);
  const usuarios=await cliente.query(
    'SELECT id,nombre,rol,sucursal,linea FROM usuarios WHERE empresa_id=$1 AND activo AND NOT oculto',
    [empresaId]);
  const usuarioPorId=new Map(usuarios.rows.map(u=>[u.id,u]));
  const usuarioPorNombre=new Map();
  for (const u of usuarios.rows) {
    const key=claveNombre(u.nombre);
    if (!usuarioPorNombre.has(key)) usuarioPorNombre.set(key,[]);
    usuarioPorNombre.get(key).push(u);
  }
  const antiguosPorTelefono=new Map(),antiguosPorNombre=new Map();
  for (const c of contactos.rows) {
    const keys=new Set([
      c.tel_norm ? String(c.tel_norm).replace(/\D/g,'').slice(-8) : '',
      String(c.tel || '').replace(/\D/g,'').slice(-8),
      String(c.externos?.whatsapp || '').replace(/\D/g,'').slice(-8),
      String(c.externos?.telefono || '').replace(/\D/g,'').slice(-8)
    ].filter(Boolean));
    for (const key of keys) {
      if (!antiguosPorTelefono.has(key)) antiguosPorTelefono.set(key,[]);
      antiguosPorTelefono.get(key).push(c.id);
    }
    const nk=claveNombre(c.nombre);
    if (nk) {
      if (!antiguosPorNombre.has(nk)) antiguosPorNombre.set(nk,[]);
      antiguosPorNombre.get(nk).push(c.id);
    }
  }

  const filas=body.filas.map((x,i)=>prepararFila(x,i+2));
  const telefonosArchivo=new Map(),nombresArchivo=new Map();
  for (const f of filas) {
    if (f.telefonoClave) telefonosArchivo.set(f.telefonoClave,(telefonosArchivo.get(f.telefonoClave)||0)+1);
    if (f.nombreClave) nombresArchivo.set(f.nombreClave,(nombresArchivo.get(f.nombreClave)||0)+1);
  }

  const lista=filas.map(f=>{
    let estado='nuevo',motivo='',usuario=null;
    if (f.invalido) {estado='invalido';motivo='Nombre, responsable o teléfono incompleto o no confiable';}
    else if (telefonosArchivo.get(f.telefonoClave)>1) {
      estado='conflicto_archivo';motivo='El mismo teléfono aparece más de una vez en el archivo';
    } else if (nombresArchivo.get(f.nombreClave)>1) {
      estado='conflicto_archivo';motivo='El mismo nombre aparece más de una vez en el archivo';
    } else if (antiguosPorTelefono.has(f.telefonoClave)) {
      estado='existente';motivo='Teléfono ya registrado en IMPAR. No se modifica.';
    } else if (antiguosPorNombre.has(f.nombreClave)) {
      estado='revision_nombre';motivo='El nombre ya existe con otro teléfono. Revisar manualmente.';
    } else {
      const mapeado=Object.prototype.hasOwnProperty.call(asignaciones,f.responsable);
      const forzado=mapeado?asignaciones[f.responsable]:undefined;
      if (mapeado) usuario=forzado?usuarioPorId.get(forzado):null;
      else {
        const candidatos=usuarioPorNombre.get(claveNombre(f.responsable))||[];
        if (candidatos.length===1) usuario=candidatos[0];
      }
      if (!usuario) {estado='sin_responsable';motivo='No se identificó un empleado activo de IMPAR para este responsable';}
    }
    return {fila:f.linea,estado,motivo,nombre:f.nombre,telefonoUltimos4:f.telefono.slice(-4),
      responsableOrigen:f.responsable,responsableId:usuario?.id||null,
      responsableNombre:usuario?.nombre||null,telefono:f.telefono,telefonoClave:f.telefonoClave};
  });
  const resumen={
    recibidos:filas.length,nuevos:lista.filter(x=>x.estado==='nuevo').length,
    existentes:lista.filter(x=>x.estado==='existente').length,
    conflictosArchivo:lista.filter(x=>x.estado==='conflicto_archivo').length,
    nombresRevisar:lista.filter(x=>x.estado==='revision_nombre').length,
    invalidos:lista.filter(x=>x.estado==='invalido').length,
    sinResponsable:lista.filter(x=>x.estado==='sin_responsable').length
  };
  const paraFirma=lista.map(x=>[x.fila,x.estado,x.nombre,x.telefono,x.responsableOrigen,x.responsableId]);
  const firma=crearFirma({empresaId,paraFirma});
  return {lista,resumen,firma,usuarios:usuarios.rows,filasOriginales:filas};
}
