/**
 * Edición completa para el administrador: empleados, clientes y negociaciones.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, telNorm } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { auditar, historial } from '../core.mjs';
import { emitir } from '../realtime.mjs';

const r = Router();
const ROLES = ['gerente', 'jefe', 'soporte', 'agente'];
const vacioANull = v => (v === '' || v === undefined ? null : v);

/* ================= EMPLEADOS ================= */
r.get('/usuarios', requiere('admin'), async (req, res) => {
  const { rows } = await q(
    `SELECT u.id, u.nombre, u.usuario, u.rol, u.sucursal, u.linea, u.equipo, u.email, u.tel,
            u.nacimiento, u.activo, u.ultimo_login,
            j.nombre AS jefe_nombre,
            (SELECT COUNT(*) FROM usuarios x WHERE x.empresa_id=u.empresa_id AND x.equipo=u.usuario) AS a_cargo
       FROM usuarios u
       LEFT JOIN usuarios j ON j.empresa_id=u.empresa_id AND j.usuario=u.equipo
      WHERE u.empresa_id=$1 AND NOT u.oculto
      ORDER BY u.rol, u.nombre`, [req.empresaId]);
  res.json(rows);
});

r.put('/usuarios/:id', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  const { rows } = await q('SELECT * FROM usuarios WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  const u = rows[0];
  if (!u) return res.status(404).json({ error: 'Empleado no encontrado.' });

  const usuario = String(b.usuario ?? u.usuario).trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(usuario))
    return res.status(422).json({ error: 'El usuario solo admite letras, números, punto, guion y guion bajo.' });
  if (usuario !== u.usuario) {
    const { rows: d } = await q('SELECT 1 FROM usuarios WHERE empresa_id=$1 AND lower(usuario)=$2 AND id<>$3',
      [req.empresaId, usuario, u.id]);
    if (d.length) return res.status(409).json({ error: 'Ese nombre de usuario ya existe en la empresa.' });
  }
  const rol = b.rol ?? u.rol;
  if (!ROLES.includes(rol)) return res.status(422).json({ error: 'Rol inválido.' });

  let equipo = b.equipo === undefined ? u.equipo : vacioANull(b.equipo);
  if (equipo) {
    if (equipo === usuario) return res.status(422).json({ error: 'Un empleado no puede ser su propio jefe.' });
    const { rows: j } = await q(
      `SELECT 1 FROM usuarios WHERE empresa_id=$1 AND usuario=$2 AND rol='jefe' AND activo`, [req.empresaId, equipo]);
    if (!j.length) return res.status(422).json({ error: 'El jefe seleccionado no existe o no tiene rol de jefe.' });
  }

  await q(
    `UPDATE usuarios SET nombre=$3, usuario=$4, email=$5, tel=$6, rol=$7, sucursal=$8, linea=$9,
       equipo=$10, nacimiento=$11, activo=$12
     WHERE id=$1 AND empresa_id=$2`,
    [u.id, req.empresaId, String(b.nombre ?? u.nombre).trim() || u.nombre, usuario,
     b.email ?? u.email, b.tel ?? u.tel, rol, b.sucursal ?? u.sucursal, b.linea ?? u.linea,
     equipo, b.nacimiento === undefined ? u.nacimiento : vacioANull(b.nacimiento),
     typeof b.activo === 'boolean' ? b.activo : u.activo]);

  let reasignados = 0;
  // Si cambió el nombre de usuario de un jefe, sus agentes lo siguen
  if (usuario !== u.usuario) {
    const r2 = await q('UPDATE usuarios SET equipo=$3 WHERE empresa_id=$1 AND equipo=$2', [req.empresaId, u.usuario, usuario]);
    reasignados = r2.rowCount;
  }
  // Si dejó de ser jefe, su equipo queda sin jefe
  let liberados = 0;
  if (u.rol === 'jefe' && rol !== 'jefe') {
    const r3 = await q('UPDATE usuarios SET equipo=NULL WHERE empresa_id=$1 AND equipo=$2', [req.empresaId, usuario]);
    liberados = r3.rowCount;
  }
  if (b.password) {
    if (String(b.password).length < 4) return res.status(422).json({ error: 'La contraseña necesita al menos 4 caracteres.' });
    await q('UPDATE usuarios SET pass_hash=$3 WHERE id=$1 AND empresa_id=$2',
      [u.id, req.empresaId, await bcrypt.hash(String(b.password), 12)]);
  }
  await auditar(req.empresaId, req.user.nombre, 'Edición de empleado', `${u.nombre} (${u.usuario})`, req.ip);
  emitir(req.empresaId, 'usuarios', {});
  res.json({ ok: true, reasignados, liberados });
});

/* ================= CLIENTES ================= */
r.get('/contactos', requiere('admin'), async (req, res) => {
  const busca = String(req.query.q || '').trim().toLowerCase();
  const dig = telNorm(busca);
  const { rows } = await q(
    `SELECT c.*, u.nombre AS responsable,
            (SELECT COUNT(*) FROM negociaciones n WHERE n.contacto_id=c.id) AS n_negociaciones
       FROM contactos c LEFT JOIN usuarios u ON u.id=c.responsable_id
      WHERE c.empresa_id=$1
        AND ($2='' OR lower(c.nombre) LIKE '%'||$2||'%' OR lower(c.email) LIKE '%'||$2||'%'
             OR ($3<>'' AND c.tel_norm LIKE '%'||$3||'%'))
      ORDER BY c.creado DESC LIMIT 150`, [req.empresaId, busca, dig]);
  res.json(rows);
});

r.put('/contactos/:id', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  const { rows } = await q('SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const tel = String(b.tel ?? c.tel).trim();
  const norm = telNorm(tel);
  if (norm && norm !== c.tel_norm) {
    const { rows: d } = await q('SELECT nombre FROM contactos WHERE empresa_id=$1 AND tel_norm=$2 AND id<>$3',
      [req.empresaId, norm, c.id]);
    if (d.length) return res.status(409).json({ error: `Ese teléfono ya pertenece a «${d[0].nombre}».` });
  }
  const resp = b.responsableId === undefined ? c.responsable_id : vacioANull(b.responsableId);
  if (resp) {
    const { rows: u } = await q('SELECT 1 FROM usuarios WHERE id=$1 AND empresa_id=$2', [resp, req.empresaId]);
    if (!u.length) return res.status(422).json({ error: 'El responsable no pertenece a esta empresa.' });
  }
  const externos = { ...(c.externos || {}) };
  if (norm) externos.whatsapp = tel.replace(/\D/g, '');

  await q(
    `UPDATE contactos SET nombre=$3, tel=$4, tel_norm=$5, email=$6, doc=$7, ciudad=$8, direccion=$9,
       sucursal=$10, linea=$11, responsable_id=$12, frecuente=$13, notas=$14, externos=$15
     WHERE id=$1 AND empresa_id=$2`,
    [c.id, req.empresaId, String(b.nombre ?? c.nombre).trim() || c.nombre, tel, norm,
     b.email ?? c.email, b.doc ?? c.doc, b.ciudad ?? c.ciudad, b.direccion ?? c.direccion,
     b.sucursal ?? c.sucursal, b.linea ?? c.linea, resp,
     typeof b.frecuente === 'boolean' ? b.frecuente : c.frecuente, b.notas ?? c.notas, JSON.stringify(externos)]);

  // Si cambió el responsable, las negociaciones abiertas lo siguen
  if (b.moverNegociaciones && resp && resp !== c.responsable_id) {
    await q(`UPDATE negociaciones SET agente_id=$3, actualizado=now()
              WHERE contacto_id=$1 AND empresa_id=$2 AND etapa IN ('nuevo','contactado','espera')`,
      [c.id, req.empresaId, resp]);
    emitir(req.empresaId, 'neg:recargar', {});
  }
  await auditar(req.empresaId, req.user.nombre, 'Edición de cliente', c.nombre, req.ip);
  res.json({ ok: true });
});

/* ================= NEGOCIACIONES ================= */
r.get('/negociaciones', requiere('admin'), async (req, res) => {
  const busca = String(req.query.q || '').trim().toLowerCase();
  const dig = telNorm(busca);
  const { rows } = await q(
    `SELECT n.id, n.titulo, n.etapa, n.origen, n.valor, n.monto_cierre, n.motivo, n.creado, n.actualizado,
            n.sucursal, n.linea, n.agente_id, c.nombre AS cliente, c.tel, u.nombre AS agente
       FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id
       LEFT JOIN usuarios u ON u.id=n.agente_id
      WHERE n.empresa_id=$1
        AND ($2='' OR lower(c.nombre) LIKE '%'||$2||'%' OR lower(n.titulo) LIKE '%'||$2||'%'
             OR ($3<>'' AND c.tel_norm LIKE '%'||$3||'%'))
      ORDER BY n.actualizado DESC LIMIT 150`, [req.empresaId, busca, dig]);
  res.json(rows);
});

r.put('/negociaciones/:id', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  const { rows } = await q('SELECT * FROM negociaciones WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  const n = rows[0];
  if (!n) return res.status(404).json({ error: 'Negociación no encontrada.' });

  const agente = b.agenteId === undefined ? n.agente_id : vacioANull(b.agenteId);
  if (agente) {
    const { rows: u } = await q('SELECT nombre FROM usuarios WHERE id=$1 AND empresa_id=$2', [agente, req.empresaId]);
    if (!u.length) return res.status(422).json({ error: 'El responsable no pertenece a esta empresa.' });
  }
  let creado = n.creado;
  if (b.creado) {
    const f = new Date(b.creado);
    if (isNaN(f)) return res.status(422).json({ error: 'Fecha de creación inválida.' });
    creado = f;
  }
  const monto = b.montoCierre === undefined ? n.monto_cierre : Number(b.montoCierre) || 0;
  if (n.etapa === 'ganado' && req.empresa.flags?.montoObligatorio && monto <= 0)
    return res.status(422).json({ error: 'Una negociación ganada necesita monto de cierre.' });

  await q(
    `UPDATE negociaciones SET titulo=$3, origen=$4, agente_id=$5, sucursal=$6, linea=$7,
       valor=$8, monto_cierre=$9, motivo=$10, creado=$11, actualizado=now()
     WHERE id=$1 AND empresa_id=$2`,
    [n.id, req.empresaId, b.titulo ?? n.titulo, b.origen ?? n.origen, agente,
     b.sucursal ?? n.sucursal, b.linea ?? n.linea,
     b.valor === undefined ? n.valor : Number(b.valor) || 0, monto,
     b.motivo === undefined ? n.motivo : vacioANull(b.motivo), creado]);

  const cambios = [];
  if (agente !== n.agente_id) cambios.push('responsable');
  if (String(creado) !== String(n.creado)) cambios.push('fecha de creación');
  await historial(req.empresaId, n.id,
    `✏ Editada por el administrador${cambios.length ? ' (' + cambios.join(', ') + ')' : ''}`, req.user.nombre);
  await auditar(req.empresaId, req.user.nombre, 'Edición de negociación', n.id, req.ip);
  emitir(req.empresaId, 'neg:patch', { id: n.id });
  res.json({ ok: true });
});

export default r;
