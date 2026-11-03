/** IMPAR · Soporte interno: solicitudes de consulta, falla y mejora con aprobación gerente → admin. */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { q, tx } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { emitir } from '../realtime.mjs';
import { auditar } from '../core.mjs';
import { obtener as obtenerArchivo } from '../archivos.mjs';
import {
  TIPOS, MODULOS, IMPACTOS, ESTADOS, validarSolicitud, estadoInicial, rolesSoporte,
  puedeVer, accionesDisponibles, decidir, resumir
} from '../soporte-impar.mjs';

const r = Router();
const esUuid = v => /^[0-9a-f-]{36}$/i.test(String(v || ''));
const limiteAlta = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Enviaste muchas solicitudes seguidas. Esperá unos minutos.' } });

async function config(empresaId) {
  const { rows } = await q('SELECT aprobadores, observadores FROM soporte_config WHERE empresa_id=$1', [empresaId]);
  return rows[0] || { aprobadores: [], observadores: [] };
}

const SELECT = `SELECT s.*, a.nombre AS autor_nombre, a.rol AS autor_rol, a.sucursal AS autor_sucursal,
  g.nombre AS gerente_nombre, ad.nombre AS admin_nombre
  FROM soporte_solicitudes s
  LEFT JOIN usuarios a ON a.id=s.autor_id
  LEFT JOIN usuarios g ON g.id=s.gerente_id
  LEFT JOIN usuarios ad ON ad.id=s.admin_id`;

/** Inserta notificaciones directas (no dependen de las reglas configurables). */
async function avisar(empresaId, uids, titulo, msg, tono, ref) {
  const ids = [...new Set(uids.filter(Boolean))];
  if (!ids.length) return;
  await q(`INSERT INTO notificaciones (empresa_id,usuario_id,tipo,titulo,msg,tono,ref)
           SELECT $1,u,'soporte',$2,$3,$4,$5 FROM unnest($6::uuid[]) AS u`, [empresaId, titulo, msg, tono, ref, ids]);
  emitir(empresaId, 'noti', { tipo: 'soporte', titulo, msg, tono, ref }, ids);
}
const admins = async empresaId => (await q("SELECT id FROM usuarios WHERE empresa_id=$1 AND rol='admin' AND activo", [empresaId])).rows.map(x => x.id);
const etiqueta = s => `#${s.numero} · ${s.titulo}`;

/* Catálogos y permisos del usuario actual. */
r.get('/contexto', requiere(), async (req, res) => {
  const cfg = await config(req.empresaId);
  const roles = rolesSoporte(req.user, cfg);
  const pendientes = roles.esAdmin || roles.esAprobador
    ? Number((await q(`SELECT COUNT(*) FROM soporte_solicitudes WHERE empresa_id=$1 AND (
          (estado='gerencia' AND ($2 OR ($3 AND autor_id<>$4))) OR (estado IN ('administracion','aprobada') AND $2))`,
        [req.empresaId, roles.esAdmin, roles.esAprobador, req.user.id])).rows[0].count)
    : 0;
  const out = { roles, tipos: TIPOS, modulos: MODULOS, impactos: IMPACTOS, estados: ESTADOS, pendientes,
    hayAprobadores: cfg.aprobadores.length > 0 };
  if (roles.esAdmin) {
    const { rows } = await q("SELECT id,nombre,rol,sucursal FROM usuarios WHERE empresa_id=$1 AND activo AND NOT oculto ORDER BY lower(nombre)", [req.empresaId]);
    out.config = { aprobadores: cfg.aprobadores, observadores: cfg.observadores, usuarios: rows };
  }
  res.json(out);
});

/* Listado según quién consulta: propias, por aprobar o todas. */
r.get('/', requiere(), async (req, res) => {
  const cfg = await config(req.empresaId);
  const roles = rolesSoporte(req.user, cfg);
  const vista = String(req.query.vista || 'mias');
  let where = 's.autor_id=$2', params = [req.empresaId, req.user.id];
  if (vista === 'aprobar' && (roles.esAdmin || roles.esAprobador)) {
    if (roles.esAdmin) { where = "s.estado IN ('gerencia','administracion','aprobada')"; params = [req.empresaId]; }
    else where = "s.estado='gerencia' AND s.autor_id<>$2";
  } else if (vista === 'todas' && roles.veTodo) {
    where = 'TRUE'; params = [req.empresaId];
  }
  const { rows } = await q(`${SELECT} WHERE s.empresa_id=$1 AND ${where} ORDER BY s.actualizado DESC LIMIT 300`, params);
  res.json(rows.map(s => ({ ...s, acciones: accionesDisponibles(req.user, s, cfg) })));
});

/* Mini reportería: quienes ven todas las solicitudes. */
r.get('/resumen', requiere(), async (req, res) => {
  const cfg = await config(req.empresaId);
  if (!rolesSoporte(req.user, cfg).veTodo) return res.status(403).json({ error: 'No tenés acceso al resumen de soporte.' });
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
  const { rows } = await q(
    `SELECT id,tipo,modulo,impacto,estado,creado,gerente_ts,resuelta_ts FROM soporte_solicitudes
      WHERE empresa_id=$1 AND (creado >= now() - ($2 || ' days')::interval OR estado IN ('gerencia','administracion','aprobada'))`,
    [req.empresaId, String(dias)]);
  const semanas = await q(
    `SELECT date_trunc('week', creado) AS semana, tipo, COUNT(*)::int AS n FROM soporte_solicitudes
      WHERE empresa_id=$1 AND creado >= now() - ($2 || ' days')::interval GROUP BY 1,2 ORDER BY 1`,
    [req.empresaId, String(dias)]);
  res.json({ dias, ...resumir(rows), semanas: semanas.rows });
});

r.get('/:id', requiere(), async (req, res) => {
  if (!esUuid(req.params.id)) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  const cfg = await config(req.empresaId);
  const { rows } = await q(`${SELECT} WHERE s.id=$1 AND s.empresa_id=$2`, [req.params.id, req.empresaId]);
  const s = rows[0];
  if (!s || !puedeVer(req.user, s, cfg)) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  const ev = await q(`SELECT e.*, u.nombre AS usuario_nombre, u.rol AS usuario_rol FROM soporte_eventos e
      LEFT JOIN usuarios u ON u.id=e.usuario_id WHERE e.solicitud_id=$1 ORDER BY e.ts`, [s.id]);
  res.json({ ...s, eventos: ev.rows, acciones: accionesDisponibles(req.user, s, cfg) });
});

/* Alta: cualquier usuario. */
r.post('/', requiere(), limiteAlta, async (req, res) => {
  const v = validarSolicitud(req.body);
  if (v.error) return res.status(422).json({ error: v.error });
  let archivo = null;
  if (req.body.archivoId) {
    const a = esUuid(req.body.archivoId) ? await obtenerArchivo(req.body.archivoId, req.empresaId) : null;
    if (!a) return res.status(422).json({ error: 'No se encontró la captura adjunta. Volvé a subirla.' });
    archivo = { id: a.id, url: a.url, nombre: a.nombre, mime: a.mime };
  }
  const cfg = await config(req.empresaId);
  const estado = estadoInicial({ aprobadores: cfg.aprobadores, autorId: req.user.id, autorRol: req.user.rol });
  const d = v.datos;
  const s = await tx(async c => {
    const { rows } = await c.query(
      `INSERT INTO soporte_solicitudes (empresa_id,autor_id,tipo,titulo,descripcion,modulo,impacto,estado,archivo,contexto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.empresaId, req.user.id, d.tipo, d.titulo, d.descripcion, d.modulo, d.impacto, estado, archivo, d.contexto]);
    await c.query("INSERT INTO soporte_eventos (solicitud_id,usuario_id,tipo) VALUES ($1,$2,'creada')", [rows[0].id, req.user.id]);
    return rows[0];
  });
  const destino = estado === 'gerencia' ? cfg.aprobadores.filter(id => id !== req.user.id) : await admins(req.empresaId);
  await avisar(req.empresaId, destino, `Nueva solicitud de soporte · ${TIPOS[d.tipo]}`,
    `${req.user.nombre}: ${etiqueta(s)}`, d.tipo === 'falla' && d.impacto === 'alto' ? 'bad' : 'warn', s.id);
  emitir(req.empresaId, 'soporte', { id: s.id });
  res.json(s);
});

/* Comentario: autor y quienes intervienen en el flujo. Los observadores solo leen. */
r.post('/:id/comentarios', requiere(), async (req, res) => {
  if (!esUuid(req.params.id)) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  const cfg = await config(req.empresaId);
  const roles = rolesSoporte(req.user, cfg);
  const { rows } = await q('SELECT * FROM soporte_solicitudes WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  const s = rows[0];
  if (!s || !puedeVer(req.user, s, cfg)) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  if (s.autor_id !== req.user.id && !roles.esAdmin && !roles.esAprobador)
    return res.status(403).json({ error: 'Como observador podés leer la solicitud, pero no comentarla.' });
  const texto = String(req.body.texto || '').trim().slice(0, 2000);
  if (texto.length < 2) return res.status(422).json({ error: 'Escribí el comentario.' });
  await q("INSERT INTO soporte_eventos (solicitud_id,usuario_id,tipo,texto) VALUES ($1,$2,'comentario',$3)", [s.id, req.user.id, texto]);
  await q('UPDATE soporte_solicitudes SET actualizado=now() WHERE id=$1', [s.id]);
  const interesados = [s.autor_id, s.gerente_id, s.admin_id].filter(id => id && id !== req.user.id);
  if (s.estado === 'gerencia' && s.autor_id === req.user.id) interesados.push(...cfg.aprobadores.filter(id => id !== req.user.id));
  if (['administracion', 'aprobada'].includes(s.estado) && s.autor_id === req.user.id) interesados.push(...await admins(req.empresaId));
  await avisar(req.empresaId, interesados, 'Comentario en soporte', `${req.user.nombre} en ${etiqueta(s)}`, 'ok', s.id);
  emitir(req.empresaId, 'soporte', { id: s.id });
  res.json({ ok: true });
});

/* Decisiones del flujo. */
r.post('/:id/decision', requiere(), async (req, res) => {
  if (!esUuid(req.params.id)) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  const cfg = await config(req.empresaId);
  const accion = String(req.body.accion || '');
  const resultado = await tx(async c => {
    const { rows } = await c.query('SELECT * FROM soporte_solicitudes WHERE id=$1 AND empresa_id=$2 FOR UPDATE', [req.params.id, req.empresaId]);
    const s = rows[0];
    if (!s || !puedeVer(req.user, s, cfg)) return { status: 404, error: 'Solicitud no encontrada.' };
    const d = decidir(req.user, s, cfg, accion, req.body.nota);
    if (d.error) return { status: 409, error: d.error };
    const sets = ['estado=$3', 'actualizado=now()'];
    if (accion === 'aprobar' || (accion === 'rechazar' && s.estado === 'gerencia')) sets.push('gerente_id=$4', 'gerente_ts=now()');
    if (['confirmar', 'resolver'].includes(accion) || (accion === 'rechazar' && s.estado === 'administracion'))
      sets.push('admin_id=$4', 'admin_ts=COALESCE(admin_ts,now())');
    if (accion === 'resolver') sets.push('resuelta_ts=now()');
    if (accion === 'rechazar') sets.push(`rechazo_etapa='${s.estado === 'gerencia' ? 'gerencia' : 'administracion'}'`);
    const up = await c.query(`UPDATE soporte_solicitudes SET ${sets.join(',')} WHERE id=$1 AND empresa_id=$2 RETURNING *`,
      [s.id, req.empresaId, d.estado, req.user.id]);
    await c.query('INSERT INTO soporte_eventos (solicitud_id,usuario_id,tipo,texto) VALUES ($1,$2,$3,$4)', [s.id, req.user.id, d.evento, d.nota]);
    return { s: up.rows[0] };
  });
  if (resultado.error) return res.status(resultado.status).json({ error: resultado.error });
  const s = resultado.s;
  const titulos = {
    aprobar: ['Tu solicitud pasó a administración', 'ok'], confirmar: ['Tu solicitud fue aprobada', 'ok'],
    resolver: ['Tu solicitud fue resuelta', 'ok'], rechazar: ['Tu solicitud no fue aprobada', 'warn']
  };
  const [t, tono] = titulos[accion];
  if (s.autor_id !== req.user.id) await avisar(req.empresaId, [s.autor_id], t, etiqueta(s), tono, s.id);
  if (accion === 'aprobar') await avisar(req.empresaId, (await admins(req.empresaId)).filter(id => id !== req.user.id),
    'Solicitud de soporte para confirmar', `${req.user.nombre} aprobó ${etiqueta(s)}`, 'warn', s.id);
  auditar(req.empresaId, req.user.usuario, 'soporte:' + accion, etiqueta(s), req.ip).catch(() => {});
  emitir(req.empresaId, 'soporte', { id: s.id });
  res.json(s);
});

/* Configuración: aprobadores (solo gerentes) y observadores. Solo admin. */
r.put('/config', requiere('admin'), async (req, res) => {
  const lista = v => [...new Set((Array.isArray(v) ? v : []).filter(esUuid))];
  const ids = [...new Set([...lista(req.body.aprobadores), ...lista(req.body.observadores)])];
  const { rows } = ids.length
    ? await q('SELECT id,rol FROM usuarios WHERE empresa_id=$1 AND activo AND id = ANY($2::uuid[])', [req.empresaId, ids])
    : { rows: [] };
  const rol = new Map(rows.map(u => [u.id, u.rol]));
  const aprobadores = lista(req.body.aprobadores).filter(id => rol.get(id) === 'gerente');
  const observadores = lista(req.body.observadores).filter(id => rol.has(id));
  await q(`INSERT INTO soporte_config (empresa_id,aprobadores,observadores,actualizado) VALUES ($1,$2,$3,now())
           ON CONFLICT (empresa_id) DO UPDATE SET aprobadores=EXCLUDED.aprobadores, observadores=EXCLUDED.observadores, actualizado=now()`,
    [req.empresaId, aprobadores, observadores]);
  auditar(req.empresaId, req.user.usuario, 'soporte:config', `${aprobadores.length} aprobadores, ${observadores.length} observadores`, req.ip).catch(() => {});
  emitir(req.empresaId, 'soporte', { config: true });
  res.json({ aprobadores, observadores });
});

export default r;
