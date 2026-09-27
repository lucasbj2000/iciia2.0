/**
 * Detección de direcciones y ubicaciones que envía el cliente.
 * Tres fuentes, en orden de confianza:
 *   gps   — coordenadas nativas del canal (WhatsApp/Messenger location)
 *   link  — enlace de Google/Apple/Waze/OSM con coordenadas o consulta
 *   texto — dirección escrita en el mensaje, detectada por patrones
 */
import { q } from './db.mjs';  // solo usado por registrar()

/* ---------- Palabras que anuncian una dirección ---------- */
const VIAS = '(?:calle|avenida|avda?\\.?|av\\.?|ruta|camino|pasaje|psje\\.?|autopista|boulevard|blvd\\.?|carretera)';
const REFERENCIAS = '(?:casi|esquina|esq\\.?|entre|frente a|al lado de|sobre|c/)';
const LUGARES = '(?:barrio|bº|b°|villa|km\\.?|kilometro|kilómetro|manzana|mzna?\\.?|lote|edificio|piso|depto\\.?|departamento)';

const PATRONES = [
  // "Av. Mcal. López 1234", "calle Palma 567"
  new RegExp(`\\b${VIAS}\\s+[\\p{L}0-9º°'.\\-]+(?:\\s+[\\p{L}0-9º°'.\\-]+){0,4}\\s*(?:n?[°º]?\\s*\\d{1,6})?`, 'giu'),
  // "Palma casi Chile", "Brasil esquina España"
  new RegExp(`\\b[\\p{L}][\\p{L}.'\\-]{2,}(?:\\s+[\\p{L}.'\\-]{2,}){0,2}\\s+${REFERENCIAS}\\s+[\\p{L}][\\p{L}0-9.'\\-]{2,}(?:\\s+[\\p{L}0-9.'\\-]{2,}){0,2}`, 'giu'),
  // "barrio San Roque", "km 12", "manzana 4 lote 7"
  new RegExp(`\\b${LUGARES}\\s*[:.]?\\s*[\\p{L}0-9º°'.\\-]+(?:\\s+[\\p{L}0-9º°'.\\-]+){0,3}`, 'giu'),
  // "mi dirección es ..." / "vivo en ..." / "estoy en ..."
  new RegExp(`\\b(?:mi\\s+)?(?:direcci[oó]n|domicilio|ubicaci[oó]n)\\s*(?:es|:)?\\s+(.{6,90})`, 'giu'),
  new RegExp(`\\b(?:vivo|estoy|quedo|me\\s+encuentro)\\s+en\\s+(.{6,90})`, 'giu'),
  new RegExp(`\\b(?:envi[aá]r?|mand[aá]r?|llev[aá]r?|entreg[aá]r?)(?:lo|me|melo)?\\s+a\\s+(.{6,90})`, 'giu')
];

/* Coordenadas sueltas: "-25.2867, -57.6359" */
const COORDS = /(-?\d{1,2}[.,]\d{4,})\s*[,;/ ]\s*(-?\d{1,3}[.,]\d{4,})/;

/* ---------- Enlaces de mapas ---------- */
export function coordsDeLink(texto = '') {
  const t = String(texto);
  const pruebas = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,                         // google maps /@lat,lon
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,                    // ?q=lat,lon
    /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/,                   // apple ?ll=
    /[?&]daddr=(-?\d+\.\d+),(-?\d+\.\d+)/,                // apple daddr
    /[?&]mlat=(-?\d+\.\d+).*?[?&]mlon=(-?\d+\.\d+)/,      // openstreetmap
    /waze\.com\/(?:ul\?)?ll=(-?\d+\.\d+)[,%]+(-?\d+\.\d+)/i,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/                      // formato interno de google
  ];
  for (const re of pruebas) {
    const m = t.match(re);
    if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  }
  return null;
}

export const esLinkMapa = t =>
  /(?:google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google|waze\.com|openstreetmap\.org|maps\.apple\.com|what3words)/i.test(String(t || ''));

/* ---------- Detección principal ---------- */
export function detectar(texto = '') {
  const t = String(texto).trim();
  if (!t) return null;

  // 1) Enlace de mapa
  if (esLinkMapa(t)) {
    const c = coordsDeLink(t);
    const url = (t.match(/https?:\/\/\S+/) || [])[0] || '';
    return { fuente: 'link', confianza: c ? 'alta' : 'media', texto: url || t.slice(0, 200), ...(c || {}) };
  }

  // 2) Coordenadas escritas a mano
  const mc = t.match(COORDS);
  if (mc) {
    const lat = parseFloat(mc[1].replace(',', '.')), lon = parseFloat(mc[2].replace(',', '.'));
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { fuente: 'link', confianza: 'alta', texto: mc[0], lat, lon };
    }
  }

  // 3) Dirección escrita
  const encontrados = [];
  for (const re of PATRONES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t)) !== null) {
      const frag = limpiar(m[1] || m[0]);
      if (frag && frag.length >= 6) encontrados.push(frag);
      if (!re.global) break;
    }
  }
  if (!encontrados.length) return null;

  // Se queda con el fragmento más informativo
  encontrados.sort((a, b) => puntaje(b) - puntaje(a));
  const mejor = encontrados[0];
  const tieneNumero = /\d{1,6}/.test(mejor);
  const tieneVia = new RegExp(VIAS, 'i').test(mejor);
  return {
    fuente: 'texto',
    confianza: (tieneNumero && tieneVia) ? 'alta' : tieneVia || tieneNumero ? 'media' : 'baja',
    texto: mejor
  };
}

function limpiar(s) {
  return String(s)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '')
    .replace(/\b(?:por\s+favor|porfa|gracias|graciass?|saludos)\b\.?$/i, '')
    .trim()
    .slice(0, 160);
}
function puntaje(s) {
  let p = Math.min(s.length, 70) / 10;
  if (/\d/.test(s)) p += 4;
  if (new RegExp(VIAS, 'i').test(s)) p += 5;
  if (new RegExp(REFERENCIAS, 'i').test(s)) p += 3;
  if (new RegExp(LUGARES, 'i').test(s)) p += 2;
  return p;
}

/* ---------- Geocodificación (Open-Meteo, sin API key) ---------- */
const cache = new Map();

export async function geocodificar(texto, ciudadBase = '') {
  const clave = `${texto}|${ciudadBase}`.toLowerCase();
  if (cache.has(clave)) return cache.get(clave);
  try {
    const consulta = encodeURIComponent(recortarParaBusqueda(texto));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${consulta}&count=1&language=es`,
      { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    const g = j.results?.[0];
    const res = g ? {
      lat: g.latitude, lon: g.longitude,
      direccion: [g.name, g.admin1, g.country].filter(Boolean).join(', ')
    } : null;
    cache.set(clave, res);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return res;
  } catch (e) { return null; }
}

/** El geocodificador funciona mejor con nombres de lugar que con direcciones largas. */
function recortarParaBusqueda(t) {
  return String(t)
    .replace(new RegExp(`\\b${LUGARES}\\b`, 'gi'), ' ')
    .replace(/\b(?:casi|esquina|esq\.?|entre|frente a|al lado de|c\/)\b.*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .split(/\s+/).slice(0, 6).join(' ');
}

/* ---------- Registro ---------- */
export async function registrar(empresa, { contactoId, negociacionId, det }) {
  if (!det) return null;
  let { lat, lon, direccion } = det;

  if (lat == null && empresa.flags?.geocodificarTexto && det.fuente === 'texto' && det.confianza !== 'baja') {
    const g = await geocodificar(det.texto, empresa.ciudad);
    if (g) { lat = g.lat; lon = g.lon; direccion = g.direccion; }
  }
  const { rows } = await q(
    `INSERT INTO ubicaciones (empresa_id,contacto_id,negociacion_id,fuente,texto,direccion,lat,lon,confianza)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [empresa.id, contactoId, negociacionId || null, det.fuente, det.texto || '',
     direccion || det.direccion || '', lat ?? null, lon ?? null, det.confianza || 'media']);

  // La ficha del contacto guarda siempre la más reciente
  await q(
    `UPDATE contactos SET direccion=COALESCE(NULLIF($2,''),direccion), lat=COALESCE($3,lat), lon=COALESCE($4,lon)
      WHERE id=$1`,
    [contactoId, direccion || det.texto || '', lat ?? null, lon ?? null]);

  return rows[0];
}

export const linkMapa = (lat, lon, texto) =>
  (lat != null && lon != null)
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto || '')}`;
