/** IMPAR · Enlace de WhatsApp por agente.
 * WhatsApp no informa desde qué enlace llegó un cliente: la atribución viaja en el
 * mensaje precargado. Va una marca invisible (U+200B/U+200C entre delimitadores con
 * U+200D) y, como respaldo visible, el nombre del agente en el saludo. */
export const NUMERO_ENLACE = String(process.env.IMPAR_WA_ENLACE || '595976992667').replace(/\D/g, '');
const ALFABETO = 'abcdefghijklmnopqrstuvwxyz0123456789._-';
const INICIO = '‍‌‍', FIN = '‍​‍';
const MARCA = /‍‌‍([​‌]{6,600})‍​‍/;

export const slugDeUsuario = usuario => String(usuario || '').trim().toLowerCase().replace(/^impar\./, '');
export const slugValido = s => /^[a-z0-9._-]{2,60}$/.test(String(s || ''));
const normalizar = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim();

export function codificar(slug) {
  const bits = [...String(slug)].map(c => {
    const n = ALFABETO.indexOf(c);
    if (n < 0) throw new Error('Carácter no admitido en el enlace');
    return n.toString(2).padStart(6, '0');
  }).join('');
  return INICIO + bits.replace(/0/g, '​').replace(/1/g, '‌') + FIN;
}

export function decodificar(texto) {
  const m = String(texto || '').match(MARCA);
  if (!m || m[1].length % 6) return null;
  const bits = m[1].replace(/​/g, '0').replace(/‌/g, '1');
  let slug = '';
  for (let i = 0; i < bits.length; i += 6) slug += ALFABETO[parseInt(bits.slice(i, i + 6), 2)] || '';
  return slugValido(slug) ? slug : null;
}

/** Quita solo la marca exacta: U+200D también forma emojis compuestos. */
export const quitarMarca = texto => String(texto || '').replace(new RegExp(MARCA.source, 'g'), '');

export const saludo = nombre => `Hola, vengo de parte de ${nombre} 👋`;
export function textoPrecargado(usuario) {
  const s = saludo(usuario.nombre);
  return s.replace('Hola,', 'Hola,' + codificar(slugDeUsuario(usuario.usuario)));
}
export const enlaceWhatsApp = usuario =>
  `https://wa.me/${NUMERO_ENLACE}?text=${encodeURIComponent(textoPrecargado(usuario))}`;
export const enlacePublico = (base, usuario) =>
  `${String(base || '').replace(/\/+$/, '')}/w/${encodeURIComponent(slugDeUsuario(usuario.usuario))}`;

/** Mensaje entrante → {texto limpio, agente|null, via}. Solo usuarios activos de la empresa. */
export async function leerEnlace(q, empresaId, texto) {
  const original = String(texto || '');
  const slug = decodificar(original);
  const limpio = slug ? quitarMarca(original).replace(/^\s+|\s+$/g, '') : original;
  if (slug) {
    const { rows } = await q(
      `SELECT id,nombre FROM usuarios WHERE empresa_id=$1 AND activo
          AND (lower(usuario)=$2 OR lower(usuario)='impar.'||$2) LIMIT 1`, [empresaId, slug]);
    if (rows[0]) return { texto: limpio, agente: rows[0], via: 'marca' };
  }
  // Respaldo: el saludo visible conserva el nombre completo del agente.
  const n = normalizar(limpio), clave = 'vengo de parte de ';
  const i = n.indexOf(clave);
  if (i < 0) return { texto: limpio, agente: null, via: null };
  const resto = n.slice(i + clave.length);
  const { rows } = await q('SELECT id,nombre FROM usuarios WHERE empresa_id=$1 AND activo', [empresaId]);
  const candidatos = rows.map(u => ({ u, nombre: normalizar(u.nombre) }))
    .filter(x => x.nombre.length >= 5 && resto.startsWith(x.nombre) && !/[a-z0-9]/.test(resto.charAt(x.nombre.length)))
    .sort((a, b) => b.nombre.length - a.nombre.length);
  const mejor = candidatos[0];
  if (!mejor || candidatos.filter(x => x.nombre === mejor.nombre).length > 1) return { texto: limpio, agente: null, via: null };
  return { texto: limpio, agente: mejor.u, via: 'nombre' };
}
