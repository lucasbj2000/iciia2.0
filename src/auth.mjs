import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { q } from './db.mjs';
import crypto from 'node:crypto';
import { contextoAuditoria } from './contexto-auditoria.mjs';
import { problemaClave, minutosBloqueo, registrarIntento, verificarTOTP, descifrarSecreto } from './seguridad-impar.mjs';

// Para comparar contra algo cuando el usuario no existe: misma demora, no delata qué cuentas existen.
const SENUELO = bcrypt.hashSync(crypto.randomUUID(), 12);
const DESAFIO_2FA_SEG = 5 * 60;

const SECRET = process.env.JWT_SECRET;
// Respeta duraciones superiores, pero nunca expira antes de 8 h de sesión.
const pedir=String(process.env.JWT_EXPIRA||'12h').trim();
const partes=/^(\d+)([mhd])$/.exec(pedir);
const segundos=partes ? Number(partes[1])*({m:60,h:3600,d:86400}[partes[2]]) : 12*3600;
export const SEGUNDOS_SESION=Math.max(8*3600,Number.isFinite(segundos)?segundos:12*3600);

// «ver» es la versión de sesión: si cambia (contraseña, rol, baja, 2FA), todas las sesiones anteriores dejan de valer.
export const firmar = u => jwt.sign(
  { uid: u.id, eid: u.empresa_id, rol: u.rol, usr: u.usuario, ver: u.sesion_version || 0 }, SECRET, { expiresIn: SEGUNDOS_SESION, algorithm: 'HS256' });

const SQL_USUARIO = "SELECT u.*,row_to_json(e) AS _empresa FROM usuarios u "+
  "JOIN empresas e ON e.id=u.empresa_id AND e.codigo='impar' AND e.activa ";

/** Paso 1: usuario y contraseña. Devuelve sesión, o pide el código de dos pasos, o el error. */
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
  // Contraseñas que no cumplen la política (p. ej. «1234»): entra, pero tiene que cambiarla antes de seguir.
  if (!user.debe_cambiar_clave && problemaClave(clave, user)) {
    await q('UPDATE usuarios SET debe_cambiar_clave=TRUE WHERE id=$1', [user.id]);
    user.debe_cambiar_clave = true;
  }
  if (user.totp_activo) {
    const desafio = jwt.sign({ uid: user.id, tipo: '2fa', ver: user.sesion_version || 0 }, SECRET, { expiresIn: DESAFIO_2FA_SEG, algorithm: 'HS256' });
    return { requiere2fa: true, desafio };
  }
  return completarIngreso(user, us, ip);
}

/** Paso 2 (si tiene verificación en dos pasos): código de la app autenticadora. */
export async function login2fa({ desafio, codigo }, ip = '') {
  let p;
  try { p = jwt.verify(String(desafio || ''), SECRET, { algorithms: ['HS256'] }); } catch { p = null; }
  if (!p || p.tipo !== '2fa') return { error: 'La verificación venció. Volvé a ingresar tu usuario y contraseña.', reiniciar: true };
  const { rows } = await q(SQL_USUARIO + "WHERE u.id=$1 AND u.activo LIMIT 1", [p.uid]);
  const user = rows[0];
  if (!user || !user.totp_activo || (user.sesion_version || 0) !== p.ver) return { error: 'La verificación venció. Volvé a ingresar.', reiniciar: true };
  const us = user.usuario.toLowerCase();
  const espera = await minutosBloqueo(q, us);
  if (espera) return { error: `Por seguridad, el acceso está pausado ${espera} min por intentos fallidos.`, bloqueada: true };
  let secreto = null; try { secreto = descifrarSecreto(user.totp_secreto); } catch { secreto = null; }
  const paso = verificarTOTP(secreto, codigo, { ultimoPaso: Number(user.totp_ultimo_paso) || 0 });
  if (paso == null) {
    const recienBloqueada = await registrarIntento(q, us, ip, false);
    return { error: 'El código no es correcto o ya se usó. Probá con el código nuevo de la app.', recienBloqueada, usuario: us };
  }
  // Un código usado no sirve dos veces (aunque alguien lo vea por encima del hombro).
  const { rowCount } = await q('UPDATE usuarios SET totp_ultimo_paso=$2 WHERE id=$1 AND totp_ultimo_paso < $2', [user.id, paso]);
  if (!rowCount) return { error: 'Ese código ya se usó. Esperá el siguiente.' };
  return completarIngreso(user, us, ip);
}

async function completarIngreso(user, us, ip) {
  await registrarIntento(q, us, ip, true).catch(() => {});
  // La auditoría de último ingreso es auxiliar: su fallo nunca bloquea credenciales válidas.
  q('UPDATE usuarios SET ultimo_login=now() WHERE id=$1', [user.id])
    .catch(e => console.warn('[login] No se pudo registrar último acceso:', e.message));
  return { token: firmar(user), user, empresa: user._empresa };
}

// Con la contraseña vencida solo se puede cambiarla, ver el contexto o salir.
const PERMITIDO_SIN_CAMBIO = /^\/api\/(perfil\/password|contexto|sesion\/|stream)/;

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
      // Sesión de antes de un cambio de contraseña, rol, baja o 2FA: ya no vale.
      if ((p.ver || 0) !== (user.sesion_version || 0)) return res.status(401).json({ error: 'Tu sesión se cerró por seguridad. Ingresá de nuevo.' });
      if (user.debe_cambiar_clave && !PERMITIDO_SIN_CAMBIO.test(req.originalUrl || ''))
        return res.status(403).json({ error: 'Tenés que cambiar tu contraseña antes de continuar.', debeCambiarClave: true });
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
