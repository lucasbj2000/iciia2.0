import { Router } from 'express';
import { q, telNorm } from '../db.mjs';
import { requiere, alcanceSQL } from '../auth.mjs';
import { notificar, auditar, historial, nombreEtapa, negActivaPorTel, crearContacto } from '../core.mjs';
import { emitir } from '../realtime.mjs';
import * as ubi from '../ubicaciones.mjs';

const r = Router();

r.get('/', requiere(), async (req, res) => {
  const busca = String(req.query.q || '').trim().toLowerCase();
  const cond = ['c.empresa_id = $1'], params = [req.empresaId];
  let agenteParam = '';

  if (req.user.rol === 'agente') {
    params.push(req.user.id);
    agenteParam = `$${params.length}`;
    cond.push(`(c.responsable_id = ${agenteParam}
      OR EXISTS (SELECT 1 FROM negociaciones nx
                  WHERE nx.contacto_id=c.id AND nx.empresa_id=c.empresa_id AND nx.agente_id=${agenteParam}))`);
  } else if (req.user.rol === 'jefe') {
    const { rows } = await q('SELECT id FROM usuarios WHERE empresa_id=$1 AND (equipo=$2 OR id=$3)',
      [req.empresaId, req.user.usuario, req.user.id]);
    params.push(rows.map(x => x.id));
    cond.push(`(c.responsable_id = ANY($${params.length}::uuid[]) OR c.responsable_id IS NULL)`);
  }

  if (busca) {
    params.push(`%${busca}%`);
    cond.push(`(lower(c.nombre) LIKE $${params.length} OR c.tel LIKE $${params.length}
      OR lower(c.email) LIKE $${params.length} OR lower(c.direccion) LIKE $${params.length})`);
  }

  const activas = (req.empresa.etapas || []).filter(e => e.activa).map(e => e.id);
  params.push(activas);
  const activasParam = `$${params.length}`;
  const filtroAgente = agenteParam ? ` AND n.agente_id=${agenteParam}` : '';

  const { rows } = await q(
    `SELECT c.*, u.nombre AS responsable,
            (SELECT COUNT(*) FROM negociaciones n
              WHERE n.contacto_id=c.id${filtroAgente}) AS n_negociaciones,
            (SELECT n.etapa FROM negociaciones n
              WHERE n.contacto_id=c.id AND n.etapa = ANY(${activasParam})${filtroAgente}
              ORDER BY n.creado ASC LIMIT 1) AS etapa_abierta,
            (SELECT n.id FROM negociaciones n
              WHERE n.contacto_id=c.id AND n.etapa = ANY(${activasParam})${filtroAgente}
              ORDER BY n.creado ASC LIMIT 1) AS neg_abierta_id
       FROM contactos c LEFT JOIN usuarios u ON u.id=c.responsable_id
      WHERE ${cond.join(' AND ')} ORDER BY c.creado DESC LIMIT 500`, params);
  res.json(rows);
});

r.get('/chequeo', requiere(), async (req, res) => {
  if (!req.empresa.flags?.antiDuplicado) return res.json({ duplicado: false });
  const dup = await negActivaPorTel(req.empresa, req.query.tel);
  if (!dup) return res.json({ duplicado: false });
  const { where, params } = await alcanceSQL(req.user, req.empresaId, 'n', 3);
  const { rows } = await q(
    `SELECT n.id, n.etapa, c.nombre, u.nombre AS agente FROM negociaciones n
       JOIN contactos c ON c.id=n.contacto_id LEFT JOIN usuarios u ON u.id=n.agente_id
      WHERE n.id=$1 AND n.empresa_id=$2 ${where}`, [dup.id, req.empresaId, ...params]);
  if (!rows[0] && req.user.rol === 'agente') {
    return res.json({ duplicado: true, mensaje: 'Ese cliente ya tiene una negociación abierta.' });
  }
  res.json({ duplicado: true, ...rows[0], etapaNombre: nombreEtapa(req.empresa, rows[0].etapa) });
});

r.get('/solicitudes/pendientes', requiere(), async (req, res) => {
  const { rows } = await q(
    `SELECT s.*, c.nombre, c.tel, u.nombre AS solicitante FROM solicitudes s
       JOIN contactos c ON c.id=s.contacto_id JOIN usuarios u ON u.id=s.de_id
      WHERE s.empresa_id=$1 AND s.estado='pendiente' AND ($2 OR s.para_id=$3)`,
    [req.empresaId, req.user.rol === 'admin', req.user.id]);
  res.json(rows);
});

r.get('/export/csv', requiere('admin', 'gerente'), async (req, res) => {
  if (!req.empresa.flags?.exportar) return res.status(403).json({ error: 'función desactivada' });
  const { rows } = await q(
    'SELECT nombre,tel,email,doc,ciudad,direccion,sucursal,linea,frecuente,notas FROM contactos WHERE empresa_id=$1',
    [req.empresaId]);
  const head = ['nombre', 'tel', 'email', 'doc', 'ciudad', 'direccion', 'sucursal', 'linea', 'frecuente', 'notas'];
  const csv = [head.join(';'), ...rows.map(x => head.map(h => String(x[h] ?? '').replace(/;/g, ',')).join(';'))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="contactos_${req.empresa.codigo}.csv"`);
  res.send('\ufeff' + csv);
});

r.get('/:id', requiere(), async (req, res) => {
  const { rows } = await q(
    `SELECT c.*, u.nombre AS responsable FROM contactos c LEFT JOIN usuarios u ON u.id=c.responsable_id
      WHERE c.id=$1 AND c.empresa_id=$2`, [req.params.id, req.empresaId]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'no encontrado' });
  const { where, params } = await alcanceSQL(req.user, req.empresaId, 'n', 3);
  const [negs, ubis] = await Promise.all([
    q(`SELECT n.*, u.nombre AS agente_nombre FROM negociaciones n LEFT JOIN usuarios u ON u.id=n.agente_id
        WHERE n.contacto_id=$1 AND n.empresa_id=$2 ${where} ORDER BY n.creado DESC`,
      [c.id, req.empresaId, ...params]),
    q(`SELECT ub.* FROM ubicaciones ub
          JOIN negociaciones n ON n.id=ub.negociacion_id
         WHERE ub.contacto_id=$1 AND ub.empresa_id=$2 ${where}
         ORDER BY ub.ts DESC LIMIT 20`,
      [c.id, req.empresaId, ...params])
  ]);
  if (req.user.rol === 'agente' && !negs.rows.length) {
    return res.status(404).json({ error: 'no encontrado' });
  }
  const ganadas = negs.rows.filter(n => n.etapa === 'ganado');
  res.json({
    ...c, negociaciones: negs.rows,
    ubicaciones: ubis.rows.map(u => ({ ...u, mapa: ubi.linkMapa(u.lat, u.lon, u.direccion || u.texto) })),
    resumen: { total: negs.rows.length, ganadas: ganadas.length,
      monto: ganadas.reduce((s, n) => s + Number(n.monto_cierre || n.valor || 0), 0),
      conversion: negs.rows.length ? Math.round(ganadas.length / negs.rows.length * 100) : 0 }
  });
});

r.post('/', requiere(), async (req, res) => {
  const emp = req.empresa, b = req.body || {};
  if (!b.nombre || !b.tel) return res.status(422).json({ error: 'Nombre y teléfono son obligatorios.' });
  if (b.iniciarNegociacion && emp.flags?.antiDuplicado) {
    const dup = await negActivaPorTel(emp, b.tel);
    if (dup) return res.status(409).json({ error: 'duplicado', negociacionId: dup.id,
      mensaje: `Ese cliente ya tiene una negociación abierta en ${nombreEtapa(emp, dup.etapa)}.` });
  }
  const { rows: dups } = await q('SELECT * FROM contactos WHERE empresa_id=$1 AND tel_norm=$2 LIMIT 1',
    [req.empresaId, telNorm(b.tel)]);
  let c = dups[0];
  if (emp.flags?.solicitudContacto && c && c.responsable_id && c.responsable_id !== req.user.id
      && c.sucursal === b.sucursal && c.linea === b.linea && req.user.rol !== 'admin') {
    const { rows: rs } = await q('SELECT nombre FROM usuarios WHERE id=$1', [c.responsable_id]);
    return res.status(409).json({ error: 'responsable', contactoId: c.id, responsable: rs[0]?.nombre,
      mensaje: `Contacto ya gestionado por ${rs[0]?.nombre} (misma sucursal y línea).` });
  }
  if (!c) c = await crearContacto(emp, { ...b, responsable_id: req.user.id,
    externos: { whatsapp: String(b.tel).replace(/\D/g, '') } });
  else await q(`UPDATE contactos SET nombre=$3, responsable_id=COALESCE(responsable_id,$4)
                 WHERE id=$1 AND empresa_id=$2`, [c.id, req.empresaId, b.nombre, req.user.id]);

  let negId = null;
  if (b.iniciarNegociacion) {
    const { rows } = await q(
      `INSERT INTO negociaciones (empresa_id,contacto_id,titulo,etapa,origen,agente_id,sucursal,linea,bot_activo)
       VALUES ($1,$2,'Alta manual','contactado','otro',$3,$4,$5,FALSE) RETURNING id`,
      [req.empresaId, c.id, req.user.id, b.sucursal || c.sucursal, b.linea || c.linea]);
    negId = rows[0].id;
    await historial(req.empresaId, negId, 'Negociación iniciada por carga de contacto', req.user.nombre);
    emitir(req.empresaId, 'neg:nueva', { id: negId });
  }
  await auditar(req.empresaId, req.user.nombre, 'Contacto', `Alta ${b.nombre}`, req.ip);
  res.json({ ok: true, id: c.id, negociacionId: negId });
});

r.patch('/:id', requiere(), async (req, res) => {
  const b = req.body || {};
  const { rowCount } = await q(
    `UPDATE contactos SET nombre=COALESCE($3,nombre), tel=COALESCE($4,tel), tel_norm=COALESCE($5,tel_norm),
       email=COALESCE($6,email), doc=COALESCE($7,doc), ciudad=COALESCE($8,ciudad),
       direccion=COALESCE($9,direccion), notas=COALESCE($10,notas)
     WHERE id=$1 AND empresa_id=$2`,
    [req.params.id, req.empresaId, b.nombre, b.tel, b.tel ? telNorm(b.tel) : null,
     b.email, b.doc, b.ciudad, b.direccion, b.notas]);
  if (!rowCount) return res.status(404).json({ error: 'no encontrado' });
  res.json({ ok: true });
});

r.post('/:id/solicitar', requiere(), async (req, res) => {
  const { rows } = await q('SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'no encontrado' });
  await q(`INSERT INTO solicitudes (empresa_id,contacto_id,de_id,para_id) VALUES ($1,$2,$3,$4)`,
    [req.empresaId, c.id, req.user.id, c.responsable_id]);
  await notificar(req.empresa, 'solicitud', { origenUsr: req.user.nombre, cliente: c.nombre }, [c.responsable_id]);
  res.json({ ok: true });
});

r.post('/solicitudes/:sid/resolver', requiere(), async (req, res) => {
  const aceptar = !!req.body?.aceptar;
  const { rows } = await q('SELECT * FROM solicitudes WHERE id=$1 AND empresa_id=$2', [req.params.sid, req.empresaId]);
  const s = rows[0];
  if (!s) return res.status(404).json({ error: 'no encontrada' });
  await q('UPDATE solicitudes SET estado=$3, resuelta=now() WHERE id=$1 AND empresa_id=$2',
    [s.id, req.empresaId, aceptar ? 'aceptada' : 'rechazada']);
  if (aceptar) {
    const { rows: us } = await q('SELECT * FROM usuarios WHERE id=$1', [s.de_id]);
    const u = us[0];
    const { rows: cs } = await q('SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2',
      [s.contacto_id, req.empresaId]);
    const c = cs[0];
    const { rows: ant } = await q('SELECT nombre FROM usuarios WHERE id=$1', [c.responsable_id]);
    const activas = (req.empresa.etapas || []).filter(e => e.activa).map(e => e.id);
    await q('UPDATE contactos SET responsable_id=$3, sucursal=$4, linea=$5 WHERE id=$1 AND empresa_id=$2',
      [c.id, req.empresaId, u.id, u.sucursal, u.linea]);
    const { rows: negs } = await q(
      'SELECT id, marcadores FROM negociaciones WHERE contacto_id=$1 AND etapa = ANY($2) AND empresa_id=$3',
      [c.id, activas, req.empresaId]);
    for (const n of negs) {
      const m = new Set(n.marcadores || []);
      if (req.empresa.flags?.marcadorTransferido) m.add('transferido');
      await q(`INSERT INTO transferencias (empresa_id,negociacion_id,de_nombre,a_nombre,por,nota)
               VALUES ($1,$2,$3,$4,$5,'Solicitud de contacto aceptada')`,
        [req.empresaId, n.id, ant[0]?.nombre || null, u.nombre, req.user.nombre]);
      await q('UPDATE negociaciones SET agente_id=$3, marcadores=$4 WHERE id=$1 AND empresa_id=$2',
        [n.id, req.empresaId, u.id, JSON.stringify([...m])]);
      await historial(req.empresaId, n.id, '⇄ Reasignada por solicitud de contacto aceptada', req.user.nombre);
    }
    await notificar(req.empresa, 'transfer', { origenUsr: req.user.nombre, cliente: c.nombre }, [u.id]);
    emitir(req.empresaId, 'neg:recargar', {});
  }
  res.json({ ok: true });
});

r.post('/import', requiere('admin', 'gerente'), async (req, res) => {
  if (!req.empresa.flags?.importar) return res.status(403).json({ error: 'función desactivada' });
  const filas = Array.isArray(req.body?.filas) ? req.body.filas : [];
  let nuevos = 0, actualizados = 0;
  for (const f of filas) {
    if (!f.tel && !f.nombre) continue;
    const { rows } = await q('SELECT id FROM contactos WHERE empresa_id=$1 AND tel_norm=$2', [req.empresaId, telNorm(f.tel)]);
    if (rows[0]) {
      await q(
        `UPDATE contactos SET nombre=COALESCE(NULLIF($2,''),nombre), email=COALESCE(NULLIF($3,''),email),
           doc=COALESCE(NULLIF($4,''),doc), ciudad=COALESCE(NULLIF($5,''),ciudad),
           direccion=COALESCE(NULLIF($6,''),direccion), sucursal=COALESCE(NULLIF($7,''),sucursal),
           linea=COALESCE(NULLIF($8,''),linea), notas=COALESCE(NULLIF($9,''),notas)
         WHERE id=$1 AND empresa_id=$10`,
        [rows[0].id, f.nombre || '', f.email || '', f.doc || '', f.ciudad || '', f.direccion || '',
         f.sucursal || '', f.linea || '', f.notas || '', req.empresaId]);
      actualizados++;
    } else {
      await crearContacto(req.empresa, { ...f, externos: { whatsapp: String(f.tel || '').replace(/\D/g, '') } });
      nuevos++;
    }
  }
  await auditar(req.empresaId, req.user.nombre, 'Importación', `${nuevos} nuevos / ${actualizados} actualizados`, req.ip);
  res.json({ ok: true, nuevos, actualizados });
});

export default r;
