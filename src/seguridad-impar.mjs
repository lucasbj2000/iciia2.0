/* IMPAR · Seguridad de acceso: política de contraseñas, bloqueo por intentos fallidos y verificación
   en dos pasos (TOTP, compatible con Google Authenticator, Microsoft Authenticator, Authy…).
   Nada de esto registra contraseñas, códigos ni secretos. */
import crypto from 'node:crypto';

/* ---------- Política de contraseñas ---------- */
const COMUNES = new Set(['12345678', '123456789', '1234567890', 'password', 'contraseña', 'contrasena', 'qwerty123', 'impar123', 'impar2026',
  'iciia123', 'paraguay', 'paraguay1', 'asuncion', 'admin123', 'abc12345', '11111111', '00000000', 'password1', 'imparpapeles']);
export const CLAVE_MIN = 10;
/** Devuelve el motivo si la contraseña no sirve, o null si cumple. */
export function problemaClave(clave, { usuario = '', nombre = '' } = {}) {
  const c = String(clave ?? '');
  if (c.length < CLAVE_MIN) return `La contraseña necesita al menos ${CLAVE_MIN} caracteres.`;
  if (c.length > 128) return 'La contraseña es demasiado larga.';
  if (!/[a-záéíóúñ]/i.test(c) || !/\d/.test(c)) return 'La contraseña tiene que combinar letras y números.';
  const baja = c.toLowerCase();
  if (COMUNES.has(baja) || new Set(baja).size < 5 || /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/.test(baja.replace(/[^a-z0-9]/g, '')) && baja.replace(/[^a-z]/g, '').length < 5) return 'Esa contraseña es demasiado común o fácil de adivinar. Elegí otra.';
  const u = String(usuario).toLowerCase().trim();
  if (u.length >= 3 && baja.includes(u)) return 'La contraseña no puede contener el nombre de usuario.';
  for (const parte of String(nombre).toLowerCase().split(/\s+/)) if (parte.length >= 4 && baja.includes(parte)) return 'La contraseña no puede contener tu nombre.';
  return null;
}

/* ---------- Bloqueo por intentos fallidos ---------- */
export const BLOQUEO = { intentos: 5, minutos: 15 };
/** ¿La cuenta (por nombre de usuario, exista o no) está bloqueada? Devuelve minutos restantes o 0. */
export async function minutosBloqueo(q, usuario) {
  const { rows } = await q(
    `SELECT count(*)::int AS n, max(ts) AS ultimo FROM login_intentos
      WHERE usuario=$1 AND NOT ok AND ts > now() - make_interval(mins => $2)
        AND ts > COALESCE((SELECT max(ts) FROM login_intentos WHERE usuario=$1 AND ok), '-infinity')`,
    [String(usuario).toLowerCase(), BLOQUEO.minutos]);
  if (rows[0].n < BLOQUEO.intentos) return 0;
  return Math.max(1, Math.ceil(BLOQUEO.minutos - (Date.now() - new Date(rows[0].ultimo).getTime()) / 60000));
}
/** Registra el intento; devuelve true si con este fallo la cuenta quedó bloqueada recién. */
export async function registrarIntento(q, usuario, ip, ok) {
  await q('INSERT INTO login_intentos(usuario,ip,ok) VALUES($1,$2,$3)', [String(usuario).toLowerCase().slice(0, 120), String(ip || '').slice(0, 64), !!ok]);
  if (Math.random() < 0.02) q("DELETE FROM login_intentos WHERE ts < now() - interval '30 days'").catch(() => {});
  if (ok) return false;
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM login_intentos WHERE usuario=$1 AND NOT ok AND ts > now() - make_interval(mins => $2)
        AND ts > COALESCE((SELECT max(ts) FROM login_intentos WHERE usuario=$1 AND ok), '-infinity')`,
    [String(usuario).toLowerCase(), BLOQUEO.minutos]);
  return rows[0].n === BLOQUEO.intentos;
}

/* ---------- Verificación en dos pasos (TOTP, RFC 6238) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0, valor = 0, out = '';
  for (const b of buf) { valor = (valor << 8) | b; bits += 8; while (bits >= 5) { out += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(valor << (5 - bits)) & 31];
  return out;
}
function desdeBase32(txt) {
  let bits = 0, valor = 0; const out = [];
  for (const ch of String(txt).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    valor = (valor << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const nuevoSecretoTOTP = () => base32(crypto.randomBytes(20));
export function codigoTOTP(secreto, paso) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(paso));
  const h = crypto.createHmac('sha1', desdeBase32(secreto)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
/** Verifica el código con ±1 intervalo de 30 s. Devuelve el paso usado (para impedir reutilizarlo) o null. */
export function verificarTOTP(secreto, codigo, { ahora = Date.now(), ultimoPaso = -1 } = {}) {
  const c = String(codigo || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secreto) return null;
  const actual = Math.floor(ahora / 30000);
  for (const d of [0, -1, 1]) {
    const paso = actual + d;
    if (paso <= ultimoPaso) continue;
    const esperado = codigoTOTP(secreto, paso);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(c))) return paso;
  }
  return null;
}
export const uriTOTP = (secreto, cuenta) =>
  `otpauth://totp/${encodeURIComponent('IMPAR CRM:' + cuenta)}?secret=${secreto}&issuer=${encodeURIComponent('IMPAR CRM')}&algorithm=SHA1&digits=6&period=30`;

/* Secreto TOTP cifrado en la base (AES-256-GCM con clave derivada de JWT_SECRET). */
const claveTOTP = () => crypto.hkdfSync('sha256', String(process.env.JWT_SECRET || ''), 'impar-totp', 'secreto-2fa', 32);
export function cifrarSecreto(s) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', Buffer.from(claveTOTP()), iv);
  const enc = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
  return 'totp:v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}
export function descifrarSecreto(s) {
  if (!String(s || '').startsWith('totp:v1:')) return null;
  const all = Buffer.from(String(s).slice(8), 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(claveTOTP()), all.subarray(0, 12));
  d.setAuthTag(all.subarray(12, 28));
  return Buffer.concat([d.update(all.subarray(28)), d.final()]).toString('utf8');
}

