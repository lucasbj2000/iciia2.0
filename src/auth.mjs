import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { q } from './db.mjs';

const SECRET = process.env.JWT_SECRET;
const EXPIRA = process.env.JWT_EXPIRA || '12h';

export const firmar = u => jwt.sign(
  { uid: u.id, eid: u.empresa_id, rol: u.rol, usr: u.usuario }, SECRET, { expiresIn: EXPIRA });

export async function login({ empresa, usuario, password }) {
  const us = String(usuario || '').trim().toLowerCase();
  const { rows: es } = await q("SELECT * FROM empresas WHERE codigo='impar' AND activa");
  const empRow = es[0];
  if (!empRow) return { error: 'IMPAR todavía no está configurado.' };
  const { rows } = await q('SELECT * FROM usuarios WHERE empresa_id=$1 AND lower(usuario)=$2 AND activo', [empRow.id, us]);
  const user = rows[0];
  if (!user) return { error: 'Usuario o contraseña incorrectos.' };
  const ok = await bcrypt.compare(String(password || ''), user.pass_hash);
  if (!ok) return { error: 'Usuario o contraseña incorrectos.' };
  await q('UPDATE usuarios SET ultimo_login=now() WHERE id=$1', [user.id]);
  return { token: firmar(user), user, empresa: empRow };
}

export function requiere(...roles) {
  return async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const t = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
      if (!t) return res.status(401).json({ error: 'sin token' });
      const p = jwt.verify(t, SECRET);
      const { rows } = await q('SELECT * FROM usuarios WHERE id=$1 AND activo', [p.uid]);
      const user = rows[0];
      if (!user) return res.status(401).json({ error: 'usuario inactivo' });

      const { rows: es } = await q("SELECT * FROM empresas WHERE codigo='impar' AND activa");
      const empresa = es[0];
      if (!empresa || user.empresa_id !== empresa.id) return res.status(403).json({ error: 'Acceso exclusivo a IMPAR.' });
      if (roles.length && !roles.includes(user.rol)) return res.status(403).json({ error: 'sin permiso' });

      req.user = user; req.empresa = empresa;
      req.empresaId = empresa ? empresa.id : null;
      req.esAdmin = user.rol === 'admin';
      next();
    } catch (e) { res.status(401).json({ error: 'token inválido' }); }
  };
}

export const hash = p => bcrypt.hash(String(p), 12);

export async function alcanceSQL(user, empresaId, alias = 'n', desde = 2) {
  if (user.rol === 'admin' || user.rol === 'gerente') return { where: '', params: [] };
  if (user.rol === 'jefe') {
    const { rows } = await q('SELECT id FROM usuarios WHERE empresa_id=$1 AND (equipo=$2 OR id=$3)',
      [empresaId, user.usuario, user.id]);
    return { where: ` AND (${alias}.agente_id = ANY($${desde}::uuid[]) OR ${alias}.agente_id IS NULL)`, params: [rows.map(r => r.id)] };
  }
  return { where: ` AND ${alias}.agente_id = $${desde}`, params: [user.id] };
}
