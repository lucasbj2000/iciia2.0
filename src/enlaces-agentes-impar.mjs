/** IMPAR · Enlace de WhatsApp por agente.
 * WhatsApp no informa desde qué enlace llegó un cliente: la atribución viaja en el
 * saludo precargado, que lleva el nombre completo del agente.
 * Prueba real (29/10/2026): WhatsApp mostró la marca invisible como «signos de reemplazo» y rompió el
 * emoji, por eso el saludo ya no lleva marca ni emoji. Las marcas de enlaces anteriores
 * se siguen reconociendo. Los caracteres especiales se escriben siempre como escapes.
 */
import { createHash } from 'node:crypto';

export const NUMERO_ENLACE = String(process.env.IMPAR_WA_ENLACE || '595976992667').replace(/\D/g, '');
const ZW0 = '\u200B', ZW1 = '\u200C', ZWJ = '\u200D', DANADO = '\uFFFD';
const FIN = ZWJ + ZW0 + ZWJ;
const INICIO_CORTO = ZWJ + ZW1 + ZW1 + ZWJ;
const INICIO_LARGO = ZWJ + ZW1 + ZWJ;
const MARCA_CORTA = /\u200D\u200C\u200C\u200D([\u200B\u200C]{16})\u200D\u200B\u200D/;
const MARCA_LARGA = /\u200D\u200C\u200D([\u200B\u200C]{6,600})\u200D\u200B\u200D/;
const ALFABETO = 'abcdefghijklmnopqrstuvwxyz0123456789._-';

const aMarca = bits => bits.replace(/0/g, ZW0).replace(/1/g, ZW1);
const aBits = marca => marca.replace(/\u200B/g, '0').replace(/\u200C/g, '1');

export const slugDeUsuario = usuario => String(usuario || '').trim().toLowerCase().replace(/^impar\./, '');
export const slugValido = s => /^[a-z0-9._-]{2,60}$/.test(String(s || ''));
export const codigoDe = slug => createHash('sha256').update('impar-enlace:' + String(slug)).digest().readUInt16BE(0);

// Sin tildes ni mayúsculas; una letra dañada por WhatsApp (U+FFFD) queda como un solo comodín.
const normalizar = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\uFFFD+/g, DANADO)
  .replace(/\s+/g, ' ').trim();
const empiezaCon = (texto, nombre) => {
  if (texto.length < nombre.length) return false;
  for (let i = 0; i < nombre.length; i++)
    if (texto[i] !== nombre[i] && !(texto[i] === DANADO && /[a-z]/.test(nombre[i]))) return false;
  return !/[a-z0-9]/.test(texto.charAt(nombre.length));
};

/** Marcas de enlaces anteriores (solo para reconocerlas). */
export const codificar = slug => INICIO_CORTO + aMarca(codigoDe(slug).toString(2).padStart(16, '0')) + FIN;
export function codificarLargo(slug) {
  const bits = [...String(slug)].map(c => {
    const n = ALFABETO.indexOf(c);
    if (n < 0) throw new Error('Carácter no admitido en el enlace');
    return n.toString(2).padStart(6, '0');
  }).join('');
  return INICIO_LARGO + aMarca(bits) + FIN;
}
export function leerCodigo(texto) {
  const m = String(texto || '').match(MARCA_CORTA);
  return m ? parseInt(aBits(m[1]), 2) : null;
}
export function decodificar(texto) {
  const m = String(texto || '').match(MARCA_LARGA);
  if (!m || m[1].length % 6) return null;
  const bits = aBits(m[1]);
  let slug = '';
  for (let i = 0; i < bits.length; i += 6) slug += ALFABETO[parseInt(bits.slice(i, i + 6), 2)] || '';
  return slugValido(slug) ? slug : null;
}
/** Quita solo las marcas exactas: U+200D también forma emojis compuestos. */
export const quitarMarca = texto => String(texto || '')
  .replace(new RegExp(MARCA_CORTA.source, 'g'), '').replace(new RegExp(MARCA_LARGA.source, 'g'), '');

export const saludo = nombre => `Hola, vengo de parte de ${nombre}`;
/** Texto del enlace: solo el saludo (WhatsApp corrompe caracteres invisibles y emojis precargados). */
export const textoPrecargado = usuario => saludo(usuario.nombre);
export const enlaceWhatsApp = usuario =>
  `https://wa.me/${NUMERO_ENLACE}?text=${encodeURIComponent(textoPrecargado(usuario))}`;
export const enlacePublico = (base, usuario) =>
  `${String(base || '').replace(/\/+$/, '')}/w/${encodeURIComponent(slugDeUsuario(usuario.usuario))}`;

/** Mensaje entrante → {texto limpio, agente|null, via}. Solo usuarios activos de la empresa. */
export async function leerEnlace(q, empresaId, texto) {
  const original = String(texto || '');
  const codigo = leerCodigo(original), slug = codigo === null ? decodificar(original) : null;
  const limpio = codigo !== null || slug ? quitarMarca(original).replace(/^\s+|\s+$/g, '') : original;
  if (codigo !== null) {
    const { rows } = await q('SELECT id,nombre,usuario FROM usuarios WHERE empresa_id=$1 AND activo', [empresaId]);
    const coinciden = rows.filter(u => slugValido(slugDeUsuario(u.usuario)) && codigoDe(slugDeUsuario(u.usuario)) === codigo);
    if (coinciden.length === 1) return { texto: limpio, agente: { id: coinciden[0].id, nombre: coinciden[0].nombre }, via: 'marca' };
  }
  if (slug) {
    const { rows } = await q(
      `SELECT id,nombre FROM usuarios WHERE empresa_id=$1 AND activo
          AND (lower(usuario)=$2 OR lower(usuario)='impar.'||$2) LIMIT 1`, [empresaId, slug]);
    if (rows[0]) return { texto: limpio, agente: rows[0], via: 'marca' };
  }
  // El saludo conserva el nombre completo del agente.
  const n = normalizar(limpio), clave = 'vengo de parte de ';
  const i = n.indexOf(clave);
  if (i < 0) return { texto: limpio, agente: null, via: null };
  const resto = n.slice(i + clave.length);
  const { rows } = await q('SELECT id,nombre FROM usuarios WHERE empresa_id=$1 AND activo', [empresaId]);
  const candidatos = rows.map(u => ({ u, nombre: normalizar(u.nombre) }))
    .filter(x => x.nombre.length >= 5 && empiezaCon(resto, x.nombre))
    .sort((a, b) => b.nombre.length - a.nombre.length);
  const mejor = candidatos[0];
  if (!mejor || candidatos.filter(x => x.nombre === mejor.nombre).length > 1) return { texto: limpio, agente: null, via: null };
  return { texto: limpio, agente: mejor.u, via: 'nombre' };
}
