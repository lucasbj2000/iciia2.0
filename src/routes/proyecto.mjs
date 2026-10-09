/** IMPAR CRM · seguimiento privado del proyecto de implementación. */
import { Router } from 'express';
import { q, tx } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { leerMultipart } from '../multipart.mjs';
import { auditar } from '../core.mjs';
import { emitir } from '../realtime.mjs';

const r = Router();
const safe = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const integer = (v, lo, hi) => Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null;
const notify = req => {
  q("SELECT id FROM usuarios WHERE empresa_id=$1 AND activo AND (rol='admin' OR id IN (SELECT usuario_id FROM proyecto_accesos WHERE empresa_id=$1))",
    [req.empresaId]).then(({ rows }) => {
    if (rows.length) emitir(req.empresaId, 'proyecto', { actualizado: Date.now() }, rows.map(x => x.id));
  }).catch(e => console.error('[proyecto] aviso:', e.message));
};
const log = (req, accion, detalle) => { auditar(req.empresaId, req.user.nombre, accion, detalle, req.ip).catch(() => {}); };
const invalido = (res, msg = 'Datos inválidos') => res.status(422).json({ error: msg });
const noExiste = res => res.status(404).json({ error: 'Elemento del proyecto no encontrado.' });

async function faseOk(req, id) {
  if (!uuid(id)) return false;
  const { rows } = await q('SELECT 1 FROM proyecto_fases WHERE id=$1 AND empresa_id=$2', [id, req.empresaId]);
  return !!rows.length;
}
async function pasoOk(req, id) {
  if (!uuid(id)) return false;
  const { rows } = await q('SELECT 1 FROM proyecto_pasos WHERE id=$1 AND empresa_id=$2', [id, req.empresaId]);
  return !!rows.length;
}
async function responsableOk(req, id) {
  if (!id) return true;
  if (!uuid(id)) return false;
  const { rows } = await q('SELECT 1 FROM usuarios WHERE id=$1 AND empresa_id=$2 AND activo', [id, req.empresaId]);
  return !!rows.length;
}
const soloAdmin = (req, res, next) => req.user.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo el administrador puede modificar el proyecto.' });

r.use(requiere());

// La visibilidad se consulta sin exponer ninguna información privada.
r.get('/acceso', safe(async (req, res) => {
  const admin = req.user.rol === 'admin';
  const { rows } = admin ? { rows: [1] } : await q(
    'SELECT 1 FROM proyecto_accesos WHERE empresa_id=$1 AND usuario_id=$2',
    [req.empresaId, req.user.id]
  );
  res.set('Cache-Control', 'no-store').json({ visible: admin || !!rows.length, admin });
}));

r.use(safe(async (req, res, next) => {
  if (req.user.rol === 'admin') return next();
  const { rows } = await q(
    'SELECT 1 FROM proyecto_accesos WHERE empresa_id=$1 AND usuario_id=$2',
    [req.empresaId, req.user.id]
  );
  if (!rows.length) return res.status(403).json({ error: 'No tenés acceso al seguimiento del proyecto.' });
  next();
}));

r.get('/', safe(async (req, res) => {
  const eid = req.empresaId;
  const [fases, pasos, comentarios, documentos, usuarios, miembros] = await Promise.all([
    q('SELECT id,nombre,descripcion,orden,creado,actualizado FROM proyecto_fases WHERE empresa_id=$1 ORDER BY orden,creado', [eid]),
    q('SELECT p.id,p.fase_id,p.titulo,p.detalle,p.tipo,p.porcentaje,p.responsable_id,p.vence,p.orden,p.creado,p.actualizado,u.nombre AS responsable FROM proyecto_pasos p LEFT JOIN usuarios u ON u.id=p.responsable_id AND u.empresa_id=p.empresa_id WHERE p.empresa_id=$1 ORDER BY p.orden,p.creado', [eid]),
    q('SELECT c.id,c.fase_id,c.usuario_id,c.texto,c.creado,u.nombre AS autor FROM proyecto_comentarios c JOIN usuarios u ON u.id=c.usuario_id AND u.empresa_id=c.empresa_id WHERE c.empresa_id=$1 ORDER BY c.creado DESC LIMIT 500', [eid]),
    q('SELECT d.id,d.fase_id,d.usuario_id,d.nombre,d.mime,d.bytes,d.creado,u.nombre AS autor FROM proyecto_documentos d LEFT JOIN usuarios u ON u.id=d.usuario_id AND u.empresa_id=d.empresa_id WHERE d.empresa_id=$1 ORDER BY d.creado DESC', [eid]),
    req.user.rol === 'admin' ? q('SELECT id,nombre,rol,cargo,sucursal FROM usuarios WHERE empresa_id=$1 AND activo ORDER BY nombre', [eid]) : Promise.resolve({ rows: [] }),
    req.user.rol === 'admin' ? q('SELECT usuario_id FROM proyecto_accesos WHERE empresa_id=$1', [eid]) : Promise.resolve({ rows: [] })
  ]);
  res.set('Cache-Control', 'no-store').json({
    admin: req.user.rol === 'admin', fases: fases.rows, pasos: pasos.rows,
    comentarios: comentarios.rows.reverse(), documentos: documentos.rows,
    usuarios: usuarios.rows, miembros: miembros.rows.map(x => x.usuario_id)
  });
}));

r.put('/accesos', soloAdmin, safe(async (req, res) => {
  if (!Array.isArray(req.body?.usuarios) || req.body.usuarios.length > 500 || req.body.usuarios.some(x => !uuid(x)))
    return invalido(res, 'Seleccioná una lista válida de usuarios.');
  const ids = [...new Set(req.body.usuarios)];
  try {
    await tx(async c => {
      const { rows } = await c.query('SELECT id FROM usuarios WHERE empresa_id=$1 AND activo AND id=ANY($2::uuid[])', [req.empresaId, ids]);
      if (rows.length !== ids.length) throw Object.assign(new Error('Hay usuarios que no pertenecen a IMPAR.'), { status: 422 });
      await c.query('DELETE FROM proyecto_accesos WHERE empresa_id=$1', [req.empresaId]);
      for (const id of ids) await c.query('INSERT INTO proyecto_accesos(empresa_id,usuario_id) VALUES ($1,$2)', [req.empresaId, id]);
    });
  } catch (e) {
    if (e.status === 422) return res.status(422).json({ error: e.message });
    throw e;
  }
  log(req, 'Proyecto CRM', 'Accesos actualizados');
  emitir(req.empresaId, 'proyecto:permisos', { actualizado: Date.now() });
  notify(req);
  res.json({ ok: true });
}));

r.post('/fases', soloAdmin, safe(async (req, res) => {
  const nombre = str(req.body?.nombre, 150), descripcion = str(req.body?.descripcion, 2000);
  if (!nombre) return invalido(res, 'Ingresá el nombre de la fase.');
  const orden = integer(req.body?.orden ?? 0, 0, 10000);
  if (orden === null) return invalido(res, 'Orden inválido.');
  const { rows } = await q('INSERT INTO proyecto_fases(empresa_id,nombre,descripcion,orden) VALUES ($1,$2,$3,$4) RETURNING id', [req.empresaId,nombre,descripcion,orden]);
  log(req,'Proyecto CRM','Fase creada: '+nombre); notify(req);
  res.status(201).json({ ok: true, id: rows[0].id });
}));

r.patch('/fases/:id', soloAdmin, safe(async (req, res) => {
  if (!await faseOk(req, req.params.id)) return noExiste(res);
  const nombre = str(req.body?.nombre,150), descripcion = str(req.body?.descripcion,2000);
  const orden = integer(req.body?.orden ?? 0,0,10000);
  if (!nombre || orden === null) return invalido(res);
  await q('UPDATE proyecto_fases SET nombre=$3,descripcion=$4,orden=$5,actualizado=now() WHERE id=$1 AND empresa_id=$2',
    [req.params.id,req.empresaId,nombre,descripcion,orden]);
  log(req,'Proyecto CRM','Fase editada: '+nombre); notify(req); res.json({ ok:true });
}));

r.delete('/fases/:id', soloAdmin, safe(async (req, res) => {
  if (!uuid(req.params.id)) return noExiste(res);
  const { rowCount } = await q('DELETE FROM proyecto_fases WHERE id=$1 AND empresa_id=$2', [req.params.id,req.empresaId]);
  if (!rowCount) return noExiste(res);
  log(req,'Proyecto CRM','Fase eliminada'); notify(req); res.json({ ok:true });
}));

r.post('/pasos', soloAdmin, safe(async (req,res) => {
  const b=req.body||{}, titulo=str(b.titulo,220), detalle=str(b.detalle,3000);
  if (!titulo || !await faseOk(req,b.fase_id)) return invalido(res, 'Título o fase inválidos.');
  const tipo = b.tipo==='necesidad'?'necesidad':b.tipo==='tarea'?'tarea':null;
  const porcentaje=integer(b.porcentaje??0,0,100), orden=integer(b.orden??0,0,10000);
  const responsable=b.responsable_id||null, vence=b.vence||null;
  if (!tipo || porcentaje===null || orden===null || !await responsableOk(req,responsable) || (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)))
    return invalido(res,'Datos del paso inválidos.');
  const {rows}=await q('INSERT INTO proyecto_pasos(empresa_id,fase_id,titulo,detalle,tipo,porcentaje,responsable_id,vence,orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [req.empresaId,b.fase_id,titulo,detalle,tipo,porcentaje,responsable,vence,orden]);
  log(req,'Proyecto CRM','Paso creado: '+titulo); notify(req); res.status(201).json({ok:true,id:rows[0].id});
}));

r.patch('/pasos/:id', soloAdmin, safe(async (req,res) => {
  if (!await pasoOk(req,req.params.id)) return noExiste(res);
  const b=req.body||{}, titulo=str(b.titulo,220), detalle=str(b.detalle,3000);
  const tipo=b.tipo==='necesidad'?'necesidad':b.tipo==='tarea'?'tarea':null;
  const porcentaje=integer(b.porcentaje,0,100), orden=integer(b.orden??0,0,10000);
  const responsable=b.responsable_id||null, vence=b.vence||null;
  if (!titulo || !await faseOk(req,b.fase_id) || !tipo || porcentaje===null || orden===null ||
      !await responsableOk(req,responsable) || (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)))
    return invalido(res);
  await q('UPDATE proyecto_pasos SET fase_id=$3,titulo=$4,detalle=$5,tipo=$6,porcentaje=$7,responsable_id=$8,vence=$9,orden=$10,actualizado=now() WHERE id=$1 AND empresa_id=$2',
    [req.params.id,req.empresaId,b.fase_id,titulo,detalle,tipo,porcentaje,responsable,vence,orden]);
  log(req,'Proyecto CRM','Paso editado: '+titulo); notify(req); res.json({ok:true});
}));

// El responsable puede reportar avance de su propio paso; solo el admin edita la planificación.
r.patch('/pasos/:id/progreso', safe(async (req,res) => {
  const porcentaje=integer(req.body?.porcentaje,0,100);
  if (!uuid(req.params.id) || porcentaje===null) return invalido(res);
  const {rows}=await q('UPDATE proyecto_pasos SET porcentaje=$3,actualizado=now() WHERE id=$1 AND empresa_id=$2 AND ($4::bool OR responsable_id=$5) RETURNING titulo',
    [req.params.id,req.empresaId,porcentaje,req.user.rol==='admin',req.user.id]);
  if (!rows.length) return res.status(403).json({error:'Solo el responsable o el administrador pueden actualizar el avance.'});
  log(req,'Proyecto CRM','Avance '+porcentaje+'%: '+rows[0].titulo); notify(req); res.json({ok:true});
}));

r.delete('/pasos/:id', soloAdmin, safe(async (req,res) => {
  if (!uuid(req.params.id)) return noExiste(res);
  const {rowCount}=await q('DELETE FROM proyecto_pasos WHERE id=$1 AND empresa_id=$2',[req.params.id,req.empresaId]);
  if (!rowCount) return noExiste(res);
  log(req,'Proyecto CRM','Paso eliminado'); notify(req); res.json({ok:true});
}));

r.post('/comentarios', safe(async (req,res) => {
  const texto=str(req.body?.texto,3000), fase=req.body?.fase_id||null;
  if (!texto || (fase && !await faseOk(req,fase))) return invalido(res,'Ingresá un comentario válido.');
  await q('INSERT INTO proyecto_comentarios(empresa_id,fase_id,usuario_id,texto) VALUES ($1,$2,$3,$4)',
    [req.empresaId,fase,req.user.id,texto]);
  notify(req); res.status(201).json({ok:true});
}));

r.delete('/comentarios/:id', safe(async (req,res) => {
  if (!uuid(req.params.id)) return noExiste(res);
  const {rowCount}=await q('DELETE FROM proyecto_comentarios WHERE id=$1 AND empresa_id=$2 AND ($3::bool OR usuario_id=$4)',
    [req.params.id,req.empresaId,req.user.rol==='admin',req.user.id]);
  if (!rowCount) return res.status(403).json({error:'Comentario inexistente o sin permiso.'});
  notify(req); res.json({ok:true});
}));

const TIPOS = new Set([
  'application/pdf','text/plain','text/csv','image/png','image/jpeg','image/webp',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);
const MAX = 10*1024*1024;

r.post('/documentos', safe(async (req,res) => {
  if (Number(req.headers['content-length']||0)>MAX+8192) return res.status(413).json({error:'Máximo 10 MB por archivo.'});
  let form;
  try { form=await leerMultipart(req,MAX); }
  catch(e) { return res.status(413).json({error:str(e.message,200)}); }
  const f=form.archivos[0], fase=form.campos.fase_id||null;
  if (!f?.buffer?.length || f.buffer.length>MAX || !TIPOS.has(f.mime.toLowerCase().trim()))
    return invalido(res,'Tipo de documento no admitido o tamaño excedido (10 MB).');
  if (fase && !await faseOk(req,fase)) return invalido(res,'Fase inexistente.');
  const nombre=str(f.nombre.replace(/[/\\\r\n"<>]/g,'_'),180)||'documento';
  await q('INSERT INTO proyecto_documentos(empresa_id,fase_id,usuario_id,nombre,mime,bytes,contenido) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req.empresaId,fase,req.user.id,nombre,f.mime.toLowerCase().trim(),f.buffer.length,f.buffer]);
  log(req,'Proyecto CRM','Documento agregado: '+nombre); notify(req); res.status(201).json({ok:true});
}));

r.get('/documentos/:id/descargar', safe(async (req,res) => {
  if (!uuid(req.params.id)) return noExiste(res);
  const {rows}=await q('SELECT nombre,mime,contenido FROM proyecto_documentos WHERE id=$1 AND empresa_id=$2',
    [req.params.id,req.empresaId]);
  if (!rows.length) return noExiste(res);
  const d=rows[0];
  res.set({
    'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff',
    'Content-Type':'application/octet-stream',
    'Content-Disposition':"attachment; filename=\"documento\"; filename*=UTF-8''"+encodeURIComponent(d.nombre)
  });
  res.send(d.contenido);
}));

r.delete('/documentos/:id', safe(async (req,res) => {
  if (!uuid(req.params.id)) return noExiste(res);
  const {rowCount}=await q('DELETE FROM proyecto_documentos WHERE id=$1 AND empresa_id=$2 AND ($3::bool OR usuario_id=$4)',
    [req.params.id,req.empresaId,req.user.rol==='admin',req.user.id]);
  if (!rowCount) return res.status(403).json({error:'Documento inexistente o sin permiso.'});
  log(req,'Proyecto CRM','Documento eliminado'); notify(req); res.json({ok:true});
}));

export default r;
