import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { q } from './db.mjs';
import crypto from 'node:crypto';
import { contextoAuditoria } from './contexto-auditoria.mjs';
import { minutosBloqueo, registrarIntento } from './seguridad-impar.mjs';

// Para comparar contra algo cuando el usuario no existe: misma demora, no delata qué cuentas existen.
const SENUELO = bcrypt.hashSync(crypto.randomUUID(), 12);

const SECRET = process.env.JWT_SECRET;
// Respeta duraciones superiores, pero nunca expira antes de 8 h de sesión.
const pedir=String(process.env.JWT_EXPIRA||'12h').trim();
const partes=/^(\d+)([mhd])$/.exec(pedir);
const segundos=partes ? Number(partes[1])*({m:60,h:3600,d:86400}[partes[2]]) : 12*3600;
export const SEGUNDOS_SESION=Math.max(8*3600,Number.isFinite(segundos)?segundos:12*3600);

// «ver» es la versión de sesión: si cambia (contraseña, rol, baja), todas las sesiones anteriores dejan de valer.
export const firmar = u => jwt.sign(
  { uid: u.id, eid: u.empresa_id, rol: u.rol, usr: u.usuario, ver: u.sesion_version || 0 }, SECRET, { expiresIn: SEGUNDOS_SESION, algorithm: 'HS256' });

const SQL_USUARIO = "SELECT u.*,row_to_json(e) AS _empresa FROM usuarios u "+
  "JOIN empresas e ON e.id=u.empresa_id AND e.codigo='impar' AND e.activa ";

/** Usuario y contraseña: devuelve la sesión o el error. */
export async function login({ usuario, password }, ip = '') {
  const us = String(usuario || '').trim().toLowerCase().slice(0, 120);
  const clave = String(password || '');
  // Bloqueo por cuenta (exista o no): 5 fallos en 15 minutos frenan la prueba de contraseñas.
  const espera = await minutosBloqueo(q, us);
  if (espera) return { error: `Por seguridad, el acceso a esta cuenta está pausado ${espera} min por intentos fallidos. Si no fuiste vos, avisá al administrador.`, bloqueada: true };
  const { rows } = await q(SQL_USUARIO + "WHERE lower(u.usuario)=$1 AND u.activo LIMIT 1", [us]);
  const user = rows[0];
  const ok = await bcrypt.compare(clave, user?.pass_hash || SENUELO);
  if (!user || !ok) {
    const recienBloqueada = await registrarIntento(q, us, ip, false);
    return { error: 'Usuario o contraseña incorrectos.', recienBloqueada, usuario: us };
  }
  return completarIngreso(user, us, ip);
}

async function completarIngreso(user, us, ip) {
  await registrarIntento(q, us, ip, true).catch(() => {});
  // La auditoría de último ingreso es auxiliar: su fallo nunca bloquea credenciales válidas.
  q('UPDATE usuarios SET ultimo_login=now() WHERE id=$1', [user.id])
    .catch(e => console.warn('[login] No se pudo registrar último acceso:', e.message));
  return { token: firmar(user), user, empresa: user._empresa };
}

export function requiere(...roles) {
  return async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      // El token por dirección solo se acepta en el canal en vivo (EventSource no permite cabeceras).
      const t = h.startsWith('Bearer ') ? h.slice(7)
        : (String(req.originalUrl || '').startsWith('/api/stream') ? String(req.query.token || '') : '');
      if (!t) return res.status(401).json({ error: 'sin token' });
      let p;
      try { p = jwt.verify(t, SECRET, { algorithms: ['HS256'] }); }
      catch { return res.status(401).json({ error: 'token inválido' }); }
      // Una sola ida a PostgreSQL por petición protegida (antes eran dos).
      // Sin caché de privilegios: bloqueos y cambios de rol se aplican inmediatamente.
      const { rows } = await q(
        "SELECT u.*,row_to_json(e) AS _empresa FROM usuarios u "+
        "LEFT JOIN empresas e ON e.id=u.empresa_id AND e.codigo='impar' AND e.activa "+
        "WHERE u.id=$1 AND u.activo LIMIT 1", [p.uid]);
      const user = rows[0];
      if (!user) return res.status(401).json({ error: 'usuario inactivo' });
      const empresa = user._empresa;
      if (!empresa || user.empresa_id !== empresa.id || p.eid !== user.empresa_id)
        return res.status(403).json({ error: 'Acceso exclusivo a IMPAR.' });
      // Sesión de antes de un cambio de contraseña, rol o baja: ya no vale.
      if ((p.ver || 0) !== (user.sesion_version || 0)) return res.status(401).json({ error: 'Tu sesión se cerró por seguridad. Ingresá de nuevo.' });
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
