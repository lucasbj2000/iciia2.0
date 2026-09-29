import { Router } from 'express';
import { q } from '../db.mjs';
import { requiere, hash, alcanceSQL } from '../auth.mjs';
import { notificar, horasLaborales } from '../core.mjs';
import { emitir } from '../realtime.mjs';
import bcrypt from 'bcryptjs';

const r = Router();

/* ================= PERFIL ================= */
r.get('/perfil', requiere(), async (req, res) => {
  const { rows } = await q(
    `SELECT id,nombre,usuario,rol,sucursal,linea,email,tel,foto,nacimiento,disponibilidad,rapidas,prefs,empresa_id
       FROM usuarios WHERE id=$1`, [req.user.id]);
  const { rows: marcas } = await q(
    'SELECT estado, ts FROM marcaciones WHERE usuario_id=$1 ORDER BY ts DESC LIMIT 20', [req.user.id]);
  res.json({ ...rows[0], marcaciones: marcas });
});

r.patch('/perfil', requiere(), async (req, res) => {
  const b = req.body || {};
  if (req.empresa?.flags?.natalicioObligatorio && b.nacimiento === '')
    return res.status(422).json({ error: 'La fecha de nacimiento es obligatoria.' });
  await q(
    `UPDATE usuarios SET nombre=COALESCE($2,nombre), email=COALESCE($3,email), tel=COALESCE($4,tel),
       foto=COALESCE($5,foto), nacimiento=COALESCE($6,nacimiento), prefs=COALESCE($7,prefs) WHERE id=$1`,
    [req.user.id, b.nombre, b.email, b.tel, b.foto, b.nacimiento || null,
     b.prefs ? JSON.stringify(b.prefs) : null]);
  res.json({ ok: true });
});

r.post('/perfil/password', requiere(), async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!await bcrypt.compare(String(actual || ''), req.user.pass_hash))
    return res.status(403).json({ error: 'La contraseña actual es incorrecta.' });
  if (String(nueva || '').length < 4) return res.status(422).json({ error: 'Mínimo 4 caracteres.' });
  await q('UPDATE usuarios SET pass_hash=$2 WHERE id=$1', [req.user.id, await hash(nueva)]);
  res.json({ ok: true });
});

r.post('/disponibilidad', requiere(), async (req, res) => {
  const estado = String(req.body?.estado || '');
  await q('UPDATE usuarios SET disponibilidad=$2 WHERE id=$1', [req.user.id, estado]);
  await q('INSERT INTO marcaciones (empresa_id,usuario_id,estado) VALUES ($1,$2,$3)', [req.empresaId, req.user.id, estado]);
  emitir(req.empresaId, 'usuarios', {});
  res.json({ ok: true });
});

/* ================= NOTIFICACIONES ================= */
r.get('/notificaciones', requiere(), async (req, res) => {
  const { rows } = await q('SELECT * FROM notificaciones WHERE usuario_id=$1 ORDER BY ts DESC LIMIT 50', [req.user.id]);
  res.json(rows);
});

r.post('/notificaciones/leer', requiere(), async (req, res) => {
  const ids = req.body?.ids;
  if (Array.isArray(ids) && ids.length)
    await q('UPDATE notificaciones SET leida=TRUE WHERE usuario_id=$1 AND id = ANY($2::bigint[])', [req.user.id, ids]);
  else await q('UPDATE notificaciones SET leida=TRUE WHERE usuario_id=$1', [req.user.id]);
  res.json({ ok: true });
});

r.post('/notificaciones/prueba', requiere('admin'), async (req, res) => {
  await q(`INSERT INTO notificaciones (empresa_id,usuario_id,tipo,titulo,msg,tono)
           VALUES ($1,$2,'test','Prueba','Notificación de prueba generada por el admin','ok')`,
    [req.empresaId, req.user.id]);
  emitir(req.empresaId, 'noti', { titulo: 'Prueba', msg: 'Notificación de prueba', tono: 'ok' }, [req.user.id]);
  res.json({ ok: true });
});

/* ================= COMUNICACIÓN INTERNA ================= */
r.get('/com/resumen', requiere(), async (req, res) => {
  const [grupos, usuarios] = await Promise.all([
    q(`SELECT g.*, (SELECT COUNT(*) FROM mensajes_internos m
          WHERE m.grupo_id=g.id AND m.de_id<>$2 AND NOT (m.leido @> to_jsonb($2::text))) AS no_leidos
         FROM grupos g WHERE g.empresa_id=$1 AND (g.miembros @> to_jsonb($2::text) OR $3) ORDER BY g.creado`,
      [req.empresaId, req.user.id, req.user.rol === 'admin']),
    q(`SELECT u.id,u.nombre,u.rol,u.sucursal,u.foto,u.disponibilidad,
         (SELECT COUNT(*) FROM mensajes_internos m WHERE m.empresa_id=$1 AND m.de_id=u.id AND m.para_id=$2
            AND NOT (m.leido @> to_jsonb($2::text))) AS no_leidos
         FROM usuarios u WHERE u.empresa_id=$1 AND u.activo AND NOT u.oculto AND u.id<>$2 ORDER BY u.nombre`,
      [req.empresaId, req.user.id])
  ]);
  res.json({ grupos: grupos.rows, usuarios: usuarios.rows });
});

r.get('/com/mensajes', requiere(), async (req, res) => {
  const { tipo, id } = req.query;
  let rows;
  if (tipo === 'grupo') {
    ({ rows } = await q(
      `SELECT m.*, u.nombre AS autor FROM mensajes_internos m JOIN usuarios u ON u.id=m.de_id
        WHERE m.grupo_id=$1 AND m.empresa_id=$2 ORDER BY m.ts ASC LIMIT 300`, [id, req.empresaId]));
    await q(`UPDATE mensajes_internos SET leido = leido || to_jsonb($2::text)
             WHERE grupo_id=$1 AND empresa_id=$3 AND de_id<>$2 AND NOT (leido @> to_jsonb($2::text))`,
      [id, req.user.id, req.empresaId]);
  } else {
    ({ rows } = await q(
      `SELECT m.*, u.nombre AS autor FROM mensajes_internos m JOIN usuarios u ON u.id=m.de_id
        WHERE m.empresa_id=$1 AND m.grupo_id IS NULL
          AND ((m.de_id=$2 AND m.para_id=$3) OR (m.de_id=$3 AND m.para_id=$2)) ORDER BY m.ts ASC LIMIT 300`,
      [req.empresaId, req.user.id, id]));
    await q(`UPDATE mensajes_internos SET leido = leido || to_jsonb($3::text)
             WHERE empresa_id=$1 AND de_id=$2 AND para_id=$3 AND NOT (leido @> to_jsonb($3::text))`,
      [req.empresaId, id, req.user.id]);
  }
  res.json(rows);
});

r.post('/com/mensajes', requiere(), async (req, res) => {
  const { tipo, id, texto } = req.body || {};
  if (!texto?.trim()) return res.status(422).json({ error: 'texto requerido' });
  if (tipo === 'grupo') {
    const { rows } = await q('SELECT * FROM grupos WHERE id=$1 AND empresa_id=$2', [id, req.empresaId]);
    const g = rows[0];
    if (!g) return res.status(404).json({ error: 'grupo no encontrado' });
    await q(`INSERT INTO mensajes_internos (empresa_id,grupo_id,de_id,txt,leido)
             VALUES ($1,$2,$3,$4,to_jsonb(ARRAY[$3::text]))`, [req.empresaId, g.id, req.user.id, texto]);
    const otros = (g.miembros || []).filter(x => x !== req.user.id);
    await notificar(req.empresa, 'mensaje', { origenUsr: `${req.user.nombre} en #${g.nombre}`, texto: texto.slice(0, 60) }, otros);
    emitir(req.empresaId, 'com', { tipo: 'grupo', id: g.id }, otros);
  } else {
    await q(`INSERT INTO mensajes_internos (empresa_id,de_id,para_id,txt,leido)
             VALUES ($1,$2,$3,$4,to_jsonb(ARRAY[$2::text]))`, [req.empresaId, req.user.id, id, texto]);
    await notificar(req.empresa, 'mensaje', { origenUsr: req.user.nombre, texto: texto.slice(0, 60) }, [id]);
    emitir(req.empresaId, 'com', { tipo: 'dm', id: req.user.id }, [id]);
  }
  res.json({ ok: true });
});

r.post('/com/grupos', requiere(), async (req, res) => {
  if (req.user.rol !== 'admin' && !req.empresa.flags?.gruposAgente)
    return res.status(403).json({ error: 'Solo el administrador puede crear grupos.' });
  const { nombre, descripcion, miembros } = req.body || {};
  if (!nombre) return res.status(422).json({ error: 'nombre requerido' });
  const ms = Array.isArray(miembros) && miembros.length ? miembros : [req.user.id];
  const { rows } = await q(
    `INSERT INTO grupos (empresa_id,nombre,descripcion,miembros) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.empresaId, nombre, descripcion || '', JSON.stringify(ms)]);
  await q(`INSERT INTO mensajes_internos (empresa_id,grupo_id,de_id,txt,leido)
           VALUES ($1,$2,$3,$4,to_jsonb(ARRAY[$3::text]))`,
    [req.empresaId, rows[0].id, req.user.id, `Grupo creado por ${req.user.nombre}`]);
  await notificar(req.empresa, 'mensaje', { origenUsr: 'Sistema', texto: `Fuiste agregado al grupo ${nombre}` },
    ms.filter(x => x !== req.user.id));
  emitir(req.empresaId, 'com', {});
  res.json({ ok: true, grupo: rows[0] });
});

r.patch('/com/grupos/:id', requiere('admin'), async (req, res) => {
  const { nombre, descripcion, miembros } = req.body || {};
  await q(`UPDATE grupos SET nombre=COALESCE($3,nombre), descripcion=COALESCE($4,descripcion),
           miembros=COALESCE($5,miembros) WHERE id=$1 AND empresa_id=$2`,
    [req.params.id, req.empresaId, nombre, descripcion, miembros ? JSON.stringify(miembros) : null]);
  emitir(req.empresaId, 'com', {});
  res.json({ ok: true });
});

r.delete('/com/grupos/:id', requiere('admin'), async (req, res) => {
  await q('DELETE FROM grupos WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  emitir(req.empresaId, 'com', {});
  res.json({ ok: true });
});

/* ================= CALENDARIO ================= */
const FERIADOS_PY = [[1,1,'Año Nuevo'],[3,1,'Día de los Héroes'],[5,1,'Día del Trabajador'],
  [5,14,'Independencia Nacional'],[5,15,'Independencia Nacional'],[6,12,'Paz del Chaco'],
  [8,15,'Fundación de Asunción'],[9,29,'Batalla de Boquerón'],[12,8,'Virgen de Caacupé'],[12,25,'Navidad']];

r.get('/calendario', requiere(), async (req, res) => {
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const [eventos, cumples, sinNac] = await Promise.all([
    q(`SELECT * FROM eventos WHERE empresa_id=$1 AND EXTRACT(YEAR FROM fecha)=$2 ORDER BY fecha`, [req.empresaId, anio]),
    q(`SELECT id,nombre,foto,to_char(nacimiento,'MM-DD') AS md, EXTRACT(YEAR FROM nacimiento) AS anio_nac
         FROM usuarios WHERE empresa_id=$1 AND activo AND nacimiento IS NOT NULL ORDER BY md`, [req.empresaId]),
    q('SELECT nombre FROM usuarios WHERE empresa_id=$1 AND activo AND NOT oculto AND nacimiento IS NULL', [req.empresaId])
  ]);
  res.json({
    eventos: eventos.rows,
    cumples: req.empresa.flags?.cumpleanos ? cumples.rows : [],
    feriados: FERIADOS_PY.map(([m,d,t]) => ({ fecha: `${anio}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, titulo: t })),
    sinNacimiento: sinNac.rows.map(x => x.nombre)
  });
});

r.post('/calendario', requiere(), async (req, res) => {
  const b = req.body || {};
  if (!b.titulo || !b.fecha) return res.status(422).json({ error: 'Título y fecha son obligatorios.' });
  const { rows } = await q(
    `INSERT INTO eventos (empresa_id,tipo,titulo,fecha,hora,descripcion,sucursal,creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.empresaId, b.tipo || 'actividad', b.titulo, b.fecha, b.hora || '', b.descripcion || '',
     b.sucursal || '', req.user.nombre]);
  if (b.notificar) await notificar(req.empresa, 'evento',
    { evento: b.titulo, fecha: new Date(b.fecha + 'T12:00:00').toLocaleDateString('es-PY') }, []);
  emitir(req.empresaId, 'calendario', {});
  res.json({ ok: true, evento: rows[0] });
});

r.delete('/calendario/:id', requiere(), async (req, res) => {
  await q('DELETE FROM eventos WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  emitir(req.empresaId, 'calendario', {});
  res.json({ ok: true });
});

/* ================= REPORTES ================= */
r.get('/reportes', requiere(), async (req, res) => {
  const dias = Math.min(Number(req.query.dias) || 30, 730);
  const emp = req.empresa;
  const activas = (emp.etapas || []).filter(e => e.activa).map(e => e.id);
  const { where, params } = await alcanceSQL(req.user, req.empresaId, 'n', 3);
  const { where: whereSolo, params: paramsSolo } = await alcanceSQL(req.user, req.empresaId, 'n', 2);

  const { rows: negs } = await q(
    `SELECT n.*, c.nombre AS cliente, c.tel, c.frecuente, u.nombre AS agente_nombre,
            (SELECT COUNT(*) FROM transferencias t WHERE t.negociacion_id=n.id) AS n_transferencias
       FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id LEFT JOIN usuarios u ON u.id=n.agente_id
      WHERE n.empresa_id=$1 AND n.creado >= now() - ($2 || ' days')::interval ${where}
      ORDER BY n.creado DESC`, [req.empresaId, String(dias), ...params]);

  const { rows: tr } = await q(
    `SELECT AVG(EXTRACT(EPOCH FROM (m.primera - n.creado))/60) AS minutos FROM negociaciones n
       JOIN LATERAL (SELECT MIN(ts) AS primera FROM mensajes
                      WHERE negociacion_id=n.id AND dir='out' AND NOT bot) m ON TRUE
      WHERE n.empresa_id=$1 AND n.creado >= now() - ($2 || ' days')::interval
        AND m.primera IS NOT NULL ${where}`,
    [req.empresaId, String(dias), ...params]);

  const universo = req.user.rol === 'agente'
    ? [{ id: req.user.id, nombre: req.user.nombre, rol: req.user.rol, sucursal: req.user.sucursal, disponibilidad: req.user.disponibilidad }]
    : (await q(
        `SELECT id,nombre,rol,sucursal,disponibilidad FROM usuarios
          WHERE empresa_id=$1 AND activo AND NOT oculto ${req.user.rol === 'jefe' ? 'AND (equipo=$2 OR id=$3)' : ''} ORDER BY nombre`,
        req.user.rol === 'jefe' ? [req.empresaId, req.user.usuario, req.user.id] : [req.empresaId])).rows;

  const { rows: espera } = await q(
    `SELECT n.id, n.entrada_etapa, c.nombre AS cliente, c.frecuente, u.nombre AS agente
       FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id LEFT JOIN usuarios u ON u.id=n.agente_id
      WHERE n.empresa_id=$1 AND n.etapa='espera' ${whereSolo}
      ORDER BY n.entrada_etapa ASC LIMIT 15`, [req.empresaId, ...paramsSolo]);

  const { rows: porCanal } = await q(
    `SELECT COALESCE(ca.nombre,'Sin canal') AS canal, COALESCE(ca.tipo,'otro') AS tipo,
            COALESCE(s.nombre,'—') AS sucursal, COUNT(*) AS total,
            COUNT(*) FILTER (WHERE n.etapa='ganado') AS ganadas
       FROM negociaciones n LEFT JOIN canales ca ON ca.id=n.canal_id LEFT JOIN sucursales s ON s.id=ca.sucursal_id
      WHERE n.empresa_id=$1 AND n.creado >= now() - ($2 || ' days')::interval ${where}
      GROUP BY 1,2,3 ORDER BY total DESC`, [req.empresaId, String(dias), ...params]);

  const r2 = emp.reglas || {};
  res.json({
    negociaciones: negs, universo, porCanal, etapasActivas: activas,
    colaEspera: espera.map(e => ({ ...e, horasLab: Number(horasLaborales(e.entrada_etapa, new Date(), r2).toFixed(1)) })),
    primeraRespuestaMin: Math.round(Number(tr[0]?.minutos) || 0),
    slaHoras: r2.slaHoras || 24
  });
});

/* ================= CLIMA ================= */
r.get('/clima', requiere(), async (req, res) => {
  try {
    let { lat, lon, ciudad } = req.query;
    if (!lat || !lon) {
      const { rows } = await q('SELECT ciudad, lat, lon FROM sucursales WHERE empresa_id=$1 AND nombre=$2',
        [req.empresaId, req.user.sucursal]);
      const s = rows[0];
      if (s?.lat != null) { lat = s.lat; lon = s.lon; ciudad = s.ciudad; }
      else {
        const nombre = ciudad || s?.ciudad || req.empresa.ciudad || 'Asunción';
        const g = await (await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nombre)}&count=1&language=es`)).json();
        if (!g.results?.length) return res.json({ ok: false });
        lat = g.results[0].latitude; lon = g.results[0].longitude; ciudad = g.results[0].name;
      }
    }
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`)).json();
    const c = w.current;
    res.json({ ok: true, ciudad: ciudad || 'Tu ubicación', temp: Math.round(c.temperature_2m),
      cod: c.weather_code, hum: c.relative_humidity_2m, viento: Math.round(c.wind_speed_10m) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

export default r;
