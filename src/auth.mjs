import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { q } from './db.mjs';
import { contextoAuditoria } from './contexto-auditoria.mjs';

const SECRET = process.env.JWT_SECRET;
// Respeta duraciones superiores, pero nunca expira antes de 8 h de sesión.
const pedir=String(process.env.JWT_EXPIRA||'12h').trim();
const partes=/^(\d+)([mhd])$/.exec(pedir);
const segundos=partes ? Number(partes[1])*({m:60,h:3600,d:86400}[partes[2]]) : 12*3600;
export const SEGUNDOS_SESION=Math.max(8*3600,Number.isFinite(segundos)?segundos:12*3600);

export const firmar = u => jwt.sign(
  { uid: u.id, eid: u.empresa_id, rol: u.rol, usr: u.usuario }, SECRET, { expiresIn: SEGUNDOS_SESION });

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
  // La auditoría de último ingreso es auxiliar: su fallo nunca bloquea credenciales válidas.
  q('UPDATE usuarios SET ultimo_login=now() WHERE id=$1', [user.id])
    .catch(e => console.warn('[login] No se pudo registrar último acceso:', e.message));
  return { token: firmar(user), user, empresa: empRow };
}

export function requiere(...roles) {
  return async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const t = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
      if (!t) return res.status(401).json({ error: 'sin token' });
      let p;
      try { p = jwt.verify(t, SECRET); }
      catch { return res.status(401).json({ error: 'token inválido' }); }
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
      contextoAuditoria.run({ usuario: user.usuario, id: user.id, ip: req.ip || '' }, next);
    } catch (e) {
      // Un fallo de PostgreSQL o un reinicio temporal NO invalida el JWT.
      // El controlador general responde 500/503 y el navegador puede reintentar.
      next(e);
    }
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
