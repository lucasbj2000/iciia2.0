import { q, tx } from './db.mjs';
import { alcanceSQL } from './auth.mjs';

const fallo = (status, msg) => { throw Object.assign(new Error(msg), { status }); };
export async function negociacionVisible(req, id, db = { query: q }, bloquear = false) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fallo(404, 'Negociación no encontrada.');
  const { where, params } = await alcanceSQL(req.user, req.empresaId, 'n', 3);
  const { rows } = await db.query(`SELECT n.id,n.contacto_id,n.agente_id,n.sucursal FROM negociaciones n
    WHERE n.id=$1 AND n.empresa_id=$2 ${where}${bloquear ? ' FOR UPDATE' : ''}`, [id, req.empresaId, ...params]);
  if (!rows[0]) fallo(404, 'Negociación no encontrada.');
  return rows[0];
}
export async function colaboradores(req, n, db = { query: q }) {
  const { rows } = await db.query(`SELECT u.id,u.nombre,u.usuario,u.rol,u.sucursal FROM usuarios u
    LEFT JOIN usuarios agente ON agente.id=$2 AND agente.empresa_id=u.empresa_id
    WHERE u.empresa_id=$1 AND u.activo AND NOT u.oculto AND
      (u.rol IN('admin','gerente') OR u.id=$2 OR
       (u.rol='jefe' AND ($2::uuid IS NULL OR u.id=$2 OR agente.equipo=u.usuario)))
    ORDER BY u.nombre`, [req.empresaId, n.agente_id]);
  return rows;
}
export async function listarNotas(req, id) {
  const n = await negociacionVisible(req, id);
  const [notas, usuarios] = await Promise.all([
    q(`SELECT ni.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'nombre',u.nombre))
      FROM usuarios u WHERE u.empresa_id=ni.empresa_id AND u.id=ANY(ni.menciones)),'[]'::jsonb) AS mencionados
      FROM notas_internas ni WHERE ni.empresa_id=$1 AND ni.negociacion_id=$2 ORDER BY ni.ts DESC,ni.id DESC LIMIT 200`, [req.empresaId,id]),
    colaboradores(req,n)
  ]);
  return { notas: notas.rows, colaboradores: usuarios };
}
export async function crearNota(req, id, body) {
  const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
  if (!texto || texto.length > 5000) fallo(422, 'Escribí una nota de hasta 5.000 caracteres.');
  if (body.menciones != null && (!Array.isArray(body.menciones) || body.menciones.length > 10)) fallo(422, 'Podés mencionar hasta 10 personas.');
  const menciones = [...new Set(body.menciones || [])];
  return tx(async db => {
    const n = await negociacionVisible(req,id,db,true);
    const usuarios = await colaboradores(req,n,db);
    if (menciones.some(uid => !usuarios.some(u => u.id === uid))) fallo(422, 'Solo podés mencionar empleados activos que ya pueden ver esta negociación.');
    const { rows } = await db.query(`INSERT INTO notas_internas(empresa_id,negociacion_id,autor_id,autor_nombre,texto,menciones)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [req.empresaId,id,req.user.id,req.user.nombre,texto,menciones]);
    await db.query(`INSERT INTO registro_cambios(empresa_id,entidad,entidad_id,operacion,campo,nuevo,usuario,usuario_id,ip)
      VALUES($1,'negociaciones',$2,'INSERT','nota_interna','"Nota interna agregada"'::jsonb,$3,$4,$5)`, [req.empresaId,id,req.user.usuario,req.user.id,req.ip || null]);
    const destinatarios = menciones.filter(uid => uid !== req.user.id);
    if (destinatarios.length && req.empresa.flags?.notificaciones !== false) await db.query(`INSERT INTO notificaciones(empresa_id,usuario_id,tipo,titulo,msg,tono,ref)
      SELECT $1,u,'mencion','Mención en nota interna',$2,'ok',$3 FROM unnest($4::uuid[]) AS u`,
      [req.empresaId,`${req.user.nombre} te mencionó en una nota interna.`,id,destinatarios]);
    return { nota: rows[0], destinatarios, visibles: usuarios.map(u => u.id) };
  });
}
export async function listarCambios(req, filtro = {}) {
  const condiciones = ['empresa_id=$1'], params = [req.empresaId];
  const add = (sql, valor) => { params.push(valor); condiciones.push(sql.replaceAll('?',`$${params.length}`)); };
  if (filtro.negociacion) {
    const n = await negociacionVisible(req,filtro.negociacion);
    params.push(n.id,n.contacto_id);
    condiciones.push(`((entidad='negociaciones' AND entidad_id=$2) OR (entidad='contactos' AND entidad_id=$3))`);
  } else if (req.user.rol !== 'admin') fallo(403, 'Acceso exclusivo del administrador.');
  if (['usuarios','contactos','negociaciones'].includes(filtro.entidad)) add('entidad=?',filtro.entidad);
  if (filtro.q) add("(usuario ILIKE ? OR campo ILIKE ?)",'%'+String(filtro.q).slice(0,100)+'%');
  if (filtro.antes) { if (!/^\d{1,18}$/.test(String(filtro.antes))) fallo(422,'Cursor inválido.'); add('id<?::bigint',String(filtro.antes)); }
  const { rows } = await q(`SELECT * FROM registro_cambios WHERE ${condiciones.join(' AND ')} ORDER BY id DESC LIMIT 100`,params);
  return { cambios: rows, siguiente: rows.length === 100 ? rows.at(-1).id : null };
}
