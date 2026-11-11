/* IMPAR · Seguridad de acceso: largo de contraseña y bloqueo por intentos fallidos.
   Nada de esto registra contraseñas. */

/* ---------- Contraseñas ---------- */
/** Devuelve el motivo si la contraseña no sirve, o null si cumple (mismo mínimo que antes). */
export function problemaClave(clave, { min = 4 } = {}) {
  const c = String(clave ?? '');
  if (c.length < min) return `La contraseña necesita al menos ${min} caracteres.`;
  if (c.length > 128) return 'La contraseña es demasiado larga.';
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

