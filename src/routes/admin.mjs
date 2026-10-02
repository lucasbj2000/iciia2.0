import { Router } from 'express';
import { q, crearEmpresa, FLAGS_DEF, NOTI_DEF, REGLAS_DEF, flagsDefault } from '../db.mjs';
import { requiere, hash } from '../auth.mjs';
import { auditar } from '../core.mjs';
import { listarCambios } from '../colaboracion.mjs';
import { emitir } from '../realtime.mjs';
import { reprocesarCuarentena } from '../worker.mjs';
import { obtener as obtenerArchivo } from '../archivos.mjs';

const r = Router();

/* ================= EMPRESAS ================= */
r.get('/empresas', requiere('admin'), (req, res) => res.json([req.empresa]));
r.post('/empresas', requiere('admin'), (_req, res) => res.status(403).json({ error: 'Este CRM es exclusivo de IMPAR.' }));
r.patch('/empresas/:id/activa', requiere('admin'), (_req, res) => res.status(403).json({ error: 'IMPAR es la única empresa del sistema.' }));
r.patch('/empresa', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  await q(`UPDATE empresas SET ciudad=COALESCE($2,ciudad),modulos=COALESCE($3,modulos),lineas=COALESCE($4,lineas) WHERE id=$1`,
    [req.empresaId, b.ciudad, b.modulos ? JSON.stringify(b.modulos) : null, b.lineas ? JSON.stringify(b.lineas) : null]);
  emitir(req.empresaId, 'config', {});
  res.json({ ok: true });
});

/* ================= CONFIGURACIÓN ================= */
r.get('/definiciones', requiere('admin'), (req, res) => res.json({ flags: FLAGS_DEF, notis: NOTI_DEF }));

r.patch('/flags', requiere('admin'), async (req, res) => {
  const flags = { ...flagsDefault(), ...(req.empresa.flags || {}), ...(req.body?.flags || {}) };
  await q('UPDATE empresas SET flags=$2 WHERE id=$1', [req.empresaId, JSON.stringify(flags)]);
  await auditar(req.empresaId, req.user.nombre, 'Flags', Object.keys(req.body?.flags || {}).join(','), req.ip);
  emitir(req.empresaId, 'config', {});
  res.json({ ok: true, flags });
});

r.patch('/notis', requiere('admin'), async (req, res) => {
  await q('UPDATE empresas SET notis=$2 WHERE id=$1', [req.empresaId, JSON.stringify(req.body?.notis || NOTI_DEF)]);
  emitir(req.empresaId, 'config', {});
  res.json({ ok: true });
});

r.patch('/reglas', requiere('admin'), async (req, res) => {
  const reglas = { ...REGLAS_DEF, ...(req.empresa.reglas || {}), ...(req.body?.reglas || {}) };
  await q('UPDATE empresas SET reglas=$2 WHERE id=$1', [req.empresaId, JSON.stringify(reglas)]);
  emitir(req.empresaId, 'config', {});
  res.json({ ok: true, reglas });
});

/* ---------- BOTONES PERSONALIZADOS ---------- */
r.put('/botones', requiere('admin'), async (req, res) => {
  const botones = Array.isArray(req.body?.botones) ? req.body.botones.slice(0, 12) : [];
  for (const b of botones) {
    if (!b.texto) return res.status(422).json({ error: 'Cada botón necesita un texto.' });
    if (b.accion === 'mensaje' && !b.valor) return res.status(422).json({ error: `El botón «${b.texto}» necesita un mensaje.` });
  }
  const reglas = { ...(req.empresa.reglas || {}), botones };
  await q('UPDATE empresas SET reglas=$2 WHERE id=$1', [req.empresaId, JSON.stringify(reglas)]);
  await auditar(req.empresaId, req.user.nombre, 'Botones', `${botones.length} configurados`, req.ip);
  emitir(req.empresaId, 'config', {});
  res.json({ ok: true, botones });
});

r.patch('/etapas', requiere('admin'), async (req, res) => {
  const terminales = new Set(['ganado', 'cerrado']);
  const etapas = (Array.isArray(req.body?.etapas) ? req.body.etapas : []).map(e =>
    terminales.has(e.id)
      ? { ...e, sistema: true, activa: false }
      : e
  );
  await q('UPDATE empresas SET etapas=$2 WHERE id=$1', [req.empresaId, JSON.stringify(etapas)]);
  emitir(req.empresaId, 'config', {});
  res.json({ ok: true, etapas });
});

r.patch('/motivos', requiere('admin'), async (req, res) => {
  await q('UPDATE empresas SET motivos=$2 WHERE id=$1', [req.empresaId, JSON.stringify(req.body?.motivos || [])]);
  emitir(req.empresaId, 'config', {});
  res.json({ ok: true });
});

r.patch('/bot', requiere('admin'), async (req, res) => {
  const bot = { ...(req.empresa.bot || {}), ...(req.body?.bot || {}) };
  await q('UPDATE empresas SET bot=$2 WHERE id=$1', [req.empresaId, JSON.stringify(bot)]);
  emitir(req.empresaId, 'config', {});
  res.json({ ok: true, bot });
});

r.post('/bot/reactivar', requiere('admin'), async (req, res) => {
  const activas = (req.empresa.etapas || []).filter(e => e.activa).map(e => e.id);
  const { rowCount } = await q(
    'UPDATE negociaciones SET bot_activo=TRUE WHERE empresa_id=$1 AND etapa = ANY($2) AND bot_activo=FALSE',
    [req.empresaId, activas]);
  emitir(req.empresaId, 'neg:recargar', {});
  res.json({ ok: true, reactivadas: rowCount });
});

r.patch('/stock', requiere('admin'), async (req, res) => {
  await q('UPDATE empresas SET stock=$2 WHERE id=$1', [req.empresaId, JSON.stringify(req.body?.stock || {})]);
  emitir(req.empresaId, 'config', {});
  res.json({ ok: true });
});

/* ================= SUCURSALES ================= */
r.get('/sucursales', requiere(), async (req, res) => {
  const { rows } = await q(
    `SELECT s.*, u.nombre AS responsable,
       (SELECT COUNT(*) FROM usuarios x WHERE x.empresa_id=s.empresa_id AND x.sucursal=s.nombre) AS personal,
       (SELECT COUNT(*) FROM canales c WHERE c.sucursal_id=s.id AND c.activo) AS canales,
       (SELECT COUNT(*) FROM canales c WHERE c.sucursal_id=s.id AND c.estado='conectado') AS canales_ok
       FROM sucursales s LEFT JOIN usuarios u ON u.id=s.responsable_id
      WHERE s.empresa_id=$1 ORDER BY s.nombre`, [req.empresaId]);
  res.json(rows);
});

r.post('/sucursales', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !b.ciudad) return res.status(422).json({ error: 'Nombre y ciudad son obligatorios.' });
  try {
    const { rows } = await q(
      `INSERT INTO sucursales (empresa_id,nombre,ciudad,direccion,lat,lon,tel,email,horario,responsable_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.empresaId, b.nombre, b.ciudad, b.direccion || '', b.lat ?? null, b.lon ?? null,
       b.tel || '', b.email || '', b.horario || '08:00 a 17:00', b.responsableId || null]);
    await auditar(req.empresaId, req.user.nombre, 'Sucursal', `Alta ${b.nombre}`, req.ip);
    res.json({ ok: true, sucursal: rows[0] });
  } catch (e) { res.status(409).json({ error: 'Ya existe una sucursal con ese nombre.' }); }
});

r.patch('/sucursales/:id', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  const { rows: prev } = await q('SELECT nombre FROM sucursales WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  if (!prev[0]) return res.status(404).json({ error: 'no encontrada' });
  await q(
    `UPDATE sucursales SET nombre=COALESCE($3,nombre), ciudad=COALESCE($4,ciudad), direccion=COALESCE($5,direccion),
       lat=$6, lon=$7, tel=COALESCE($8,tel), email=COALESCE($9,email), horario=COALESCE($10,horario),
       responsable_id=$11, activa=COALESCE($12,activa) WHERE id=$1 AND empresa_id=$2`,
    [req.params.id, req.empresaId, b.nombre, b.ciudad, b.direccion, b.lat ?? null, b.lon ?? null,
     b.tel, b.email, b.horario, b.responsableId || null, typeof b.activa === 'boolean' ? b.activa : null]);
  if (b.nombre && b.nombre !== prev[0].nombre) {
    const ant = prev[0].nombre;
    for (const t of ['usuarios', 'contactos', 'negociaciones']) {
      await q(`UPDATE ${t} SET sucursal=$3 WHERE empresa_id=$1 AND sucursal=$2`, [req.empresaId, ant, b.nombre]);
    }
    await q('UPDATE rapidas SET sucursal=$3 WHERE empresa_id=$1 AND sucursal=$2', [req.empresaId, ant, b.nombre]);
  }
  res.json({ ok: true });
});

r.get('/geocodificar', requiere('admin'), async (req, res) => {
  try {
    const rr = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(req.query.ciudad || '')}&count=1&language=es`);
    const j = await rr.json();
    const g = j.results?.[0];
    res.json(g ? { ok: true, lat: g.latitude, lon: g.longitude, nombre: g.name } : { ok: false });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

/* ================= USUARIOS ================= */
r.get('/usuarios', requiere(), async (req, res) => {
  const { rows } = await q(
    `SELECT id,nombre,usuario,rol,sucursal,linea,equipo,email,tel,foto,nacimiento,disponibilidad,activo,ultimo_login,rapidas
       FROM usuarios WHERE empresa_id=$1 AND NOT oculto ORDER BY nombre`, [req.empresaId]);
  res.json(rows);
});

r.post('/usuarios', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !b.usuario) return res.status(422).json({ error: 'Nombre y usuario son obligatorios.' });
  const { rows } = await q('SELECT 1 FROM usuarios WHERE empresa_id=$1 AND lower(usuario)=lower($2)', [req.empresaId, b.usuario]);
  if (rows.length) return res.status(409).json({ error: 'Ese usuario ya existe en la empresa.' });
  const { rows: ns } = await q(
    `INSERT INTO usuarios (empresa_id,nombre,usuario,pass_hash,rol,sucursal,linea,equipo,email,nacimiento,disponibilidad)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'fuera') RETURNING id`,
    [req.empresaId, b.nombre, b.usuario.toLowerCase(), await hash(b.password || '1234'), b.rol || 'agente',
     b.sucursal || '', b.linea || '', b.equipo || null, b.email || '', b.nacimiento || null]);
  await auditar(req.empresaId, req.user.nombre, 'Usuario', `Alta ${b.nombre}`, req.ip);
  res.json({ ok: true, id: ns[0].id });
});

r.patch('/usuarios/:id', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  await q(
    `UPDATE usuarios SET rol=COALESCE($3,rol), sucursal=COALESCE($4,sucursal), linea=COALESCE($5,linea),
       equipo=COALESCE($6,equipo), activo=COALESCE($7,activo), nacimiento=COALESCE($8,nacimiento)
     WHERE id=$1 AND empresa_id=$2`,
    [req.params.id, req.empresaId, b.rol, b.sucursal, b.linea, b.equipo,
     typeof b.activo === 'boolean' ? b.activo : null, b.nacimiento || null]);
  res.json({ ok: true });
});

r.post('/usuarios/:id/password', requiere('admin'), async (req, res) => {
  const p = String(req.body?.password || '');
  if (p.length < 4) return res.status(422).json({ error: 'Mínimo 4 caracteres.' });
  await q('UPDATE usuarios SET pass_hash=$3 WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId, await hash(p)]);
  await auditar(req.empresaId, req.user.nombre, 'Seguridad', 'Reset de contraseña', req.ip);
  res.json({ ok: true });
});

/* ================= RESPUESTAS RÁPIDAS ================= */
r.get('/rapidas', requiere(), async (req, res) => {
  const { rows } = await q(
    `SELECT r.*, u.nombre AS autor, a.tipo AS archivo_tipo, a.nombre AS archivo_nombre, a.bytes AS archivo_bytes,
            CASE WHEN a.id IS NOT NULL THEN '/media/' || a.empresa_id || '/' || a.archivo ELSE r.media_url END AS media_url
       FROM rapidas r LEFT JOIN usuarios u ON u.id=r.autor_id LEFT JOIN archivos a ON a.id=r.archivo_id
      WHERE r.empresa_id=$1 ORDER BY r.creado`, [req.empresaId]);
  const { rows: mias } = await q('SELECT rapidas FROM usuarios WHERE id=$1', [req.user.id]);
  res.json({ equipo: rows, personales: mias[0]?.rapidas || [] });
});

r.post('/rapidas', requiere('admin', 'gerente', 'jefe'), async (req, res) => {
  const { txt, ambito, sucursal, archivoId } = req.body || {};
  if (!txt && !archivoId) return res.status(422).json({ error: 'Escribí un texto o adjuntá una imagen.' });
  const a = archivoId ? await obtenerArchivo(archivoId, req.empresaId) : null;
  if (archivoId && !a) return res.status(404).json({ error: 'El archivo no existe.' });
  const { rows } = await q(
    `INSERT INTO rapidas (empresa_id,txt,ambito,sucursal,autor_id,archivo_id,media_url,media_tipo,media_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.empresaId, txt || '', ambito || 'empresa', ambito === 'sucursal' ? sucursal : null, req.user.id,
     a?.id || null, a?.url || null, a?.tipo || null, a?.nombre || null]);
  res.json({ ok: true, rapida: rows[0] });
});

r.patch('/rapidas/:id', requiere('admin', 'gerente', 'jefe'), async (req, res) => {
  const { txt, ambito, sucursal, archivoId, quitarArchivo } = req.body || {};
  const a = archivoId ? await obtenerArchivo(archivoId, req.empresaId) : null;
  await q(
    `UPDATE rapidas SET txt=COALESCE($3,txt), ambito=COALESCE($4,ambito),
       sucursal=CASE WHEN $4::text IS NULL THEN sucursal ELSE $5 END,
       archivo_id  = CASE WHEN $7 THEN NULL WHEN $6::uuid IS NOT NULL THEN $6::uuid ELSE archivo_id END,
       media_url   = CASE WHEN $7 THEN NULL WHEN $6::uuid IS NOT NULL THEN $8 ELSE media_url END,
       media_tipo  = CASE WHEN $7 THEN NULL WHEN $6::uuid IS NOT NULL THEN $9 ELSE media_tipo END,
       media_nombre= CASE WHEN $7 THEN NULL WHEN $6::uuid IS NOT NULL THEN $10 ELSE media_nombre END
     WHERE id=$1 AND empresa_id=$2`,
    [req.params.id, req.empresaId, txt, ambito, ambito === 'sucursal' ? sucursal : null,
     a?.id || null, !!quitarArchivo, a?.url || null, a?.tipo || null, a?.nombre || null]);
  res.json({ ok: true });
});

r.delete('/rapidas/:id', requiere('admin', 'gerente', 'jefe'), async (req, res) => {
  await q('DELETE FROM rapidas WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  res.json({ ok: true });
});

r.put('/rapidas-personales', requiere(), async (req, res) => {
  await q('UPDATE usuarios SET rapidas=$2 WHERE id=$1', [req.user.id, JSON.stringify(req.body?.rapidas || [])]);
  res.json({ ok: true });
});

/* ================= SALUD / AUDITORÍA ================= */
r.get('/auditoria', requiere('admin'), async (req, res) => {
  const { rows } = await q('SELECT * FROM auditoria WHERE empresa_id=$1 ORDER BY ts DESC LIMIT 200', [req.empresaId]);
  res.json(rows);
});

r.get('/cambios', requiere('admin'), async (req,res) => {
  try { res.json(await listarCambios(req,req.query)); }
  catch(e){res.status(e.status||500).json({error:e.status?e.message:'No se pudo consultar el historial.'});}
});

r.get('/cuarentena', requiere('admin'), async (req, res) => {
  const { rows } = await q(
    `SELECT i.*, c.nombre AS canal FROM inbox i LEFT JOIN canales c ON c.id=i.canal_id
      WHERE i.empresa_id=$1 AND i.estado='cuarentena' ORDER BY i.ts DESC LIMIT 100`, [req.empresaId]);
  const { rows: st } = await q(
    `SELECT
       (SELECT COUNT(*) FROM inbox WHERE empresa_id=$1 AND estado='pendiente')  AS pendientes,
       (SELECT COUNT(*) FROM inbox WHERE empresa_id=$1 AND estado='procesado')  AS procesados,
       (SELECT COUNT(*) FROM inbox WHERE empresa_id=$1 AND estado='cuarentena') AS cuarentena,
       (SELECT COUNT(*) FROM outbox WHERE empresa_id=$1 AND estado='pendiente') AS cola_salida,
       (SELECT COUNT(*) FROM outbox WHERE empresa_id=$1 AND estado='error')     AS envios_fallidos`, [req.empresaId]);
  res.json({ mensajes: rows, stats: st[0] });
});

r.post('/cuarentena/reprocesar', requiere('admin'), async (req, res) =>
  res.json({ ok: true, reprocesados: await reprocesarCuarentena(req.empresaId) }));

r.post('/outbox/reintentar', requiere('admin'), async (req, res) => {
  const { rowCount } = await q(
    `UPDATE outbox SET estado='pendiente', intentos=0, error=NULL WHERE empresa_id=$1 AND estado='error'`, [req.empresaId]);
  res.json({ ok: true, reencolados: rowCount });
});

/* ================= UBICACIONES ================= */
r.get('/ubicaciones', requiere(), async (req, res) => {
  const { rows } = await q(
    `SELECT u.*, c.nombre AS cliente, c.tel FROM ubicaciones u JOIN contactos c ON c.id=u.contacto_id
      WHERE u.empresa_id=$1 ORDER BY u.ts DESC LIMIT 200`, [req.empresaId]);
  res.json(rows);
});

export default r;
