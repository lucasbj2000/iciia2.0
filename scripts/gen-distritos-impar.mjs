// Genera public/js/distritos-py.js a partir de la Cartografía Censal 2022 del INE (GeoJSON de distritos).
// Uso: node scripts/gen-distritos-impar.mjs /ruta/DISTRITOS_PY_CNPV2022.geojson
// Guarda cada distrito una sola vez, simplificado (Douglas-Peucker) y cuantizado a 1e-4° con deltas enteros.
import { readFileSync, writeFileSync } from 'node:fs';

const origen = process.argv[2];
if (!origen) { console.error('Indicá la ruta del GeoJSON de distritos del INE.'); process.exit(1); }
const geo = JSON.parse(readFileSync(origen, 'utf8'));

// Distritos con plano propio: Asunción, todo Central y las ciudades principales del interior.
const CIUDADES = ['CIUDAD DEL ESTE', 'HERNANDARIAS', 'PRESIDENTE FRANCO', 'MINGA GUAZU', 'ENCARNACION', 'CAMBYRETA',
  'PEDRO JUAN CABALLERO', 'CONCEPCION', 'CORONEL OVIEDO', 'CAAGUAZU', 'VILLARRICA', 'PILAR', 'SAN JUAN BAUTISTA',
  'CAACUPE', 'PARAGUARI', 'CAAZAPA', 'SALTO DEL GUAIRA', 'SAN PEDRO DE YCUAMANDIYU',
  'SAN ESTANISLAO', 'SANTA RITA', 'HORQUETA'];
const conPlano = f => ['ASUNCION', 'CENTRAL'].includes(f.properties.DPTO_DESC) || CIUDADES.includes(f.properties.DIST_DESC_);

const ACENTOS = { asuncion: 'Asunción', lambare: 'Lambaré', itaugua: 'Itauguá', ita: 'Itá', capiata: 'Capiatá', aregua: 'Areguá',
  ypacarai: 'Ypacaraí', ypane: 'Ypané', guarambare: 'Guarambaré', saldivar: 'Saldívar', encarnacion: 'Encarnación', concepcion: 'Concepción',
  caaguazu: 'Caaguazú', caacupe: 'Caacupé', paraguari: 'Paraguarí', caazapa: 'Caazapá', guaira: 'Guairá', guazu: 'Guazú',
  ycuamandiyu: 'Ycuamandiyú', cambyreta: 'Cambyretá', itakyry: 'Itakyry', tomas: 'Tomás', jose: 'José', maria: 'María',
  limpio: 'Limpio', chaco: 'Chaco', aceval: 'Aceval', yaguaron: 'Yaguarón', piribebuy: 'Piribebuy', tobati: 'Tobatí',
  emboscada: 'Emboscada', atyra: 'Atyrá', ñemby: 'Ñemby', nemby: 'Ñemby', fram: 'Fram', obligado: 'Obligado', hohenau: 'Hohenau',
  belen: 'Belén', loreto: 'Loreto', yby: 'Yby', ramon: 'Ramón', martin: 'Martín', cristobal: 'Cristóbal',
  parana: 'Paraná', capitan: 'Capitán', cora: 'Corá', itapua: 'Itapúa', canindeyu: 'Canindeyú', 'ñeembucu': 'Ñeembucú', martinez: 'Martínez',
  leon: 'León', moises: 'Moisés', baez: 'Báez', felix: 'Félix', perez: 'Pérez', alvarez: 'Álvarez', morinigo: 'Morínigo', diaz: 'Díaz',
  humaita: 'Humaitá', jesus: 'Jesús', falcon: 'Falcón', espiritu: 'Espíritu', liberacion: 'Liberación', lopez: 'López', mbaracayu: 'Mbaracayú',
  raul: 'Raúl', repatriacion: 'Repatriación', gonzalez: 'González', joaquin: 'Joaquín', simon: 'Simón', bolivar: 'Bolívar', union: 'Unión',
  vaqueria: 'Vaquería', yau: 'Yaú', yguazu: 'Yguazú', yhu: 'Yhú', caapucu: 'Caapucú', carapegua: 'Carapeguá', pucu: 'Pucú', umbu: 'Umbú',
  itacurubi: 'Itacurubí', itape: 'Itapé', maracana: 'Maracaná', pirayu: 'Pirayú', sapucai: 'Sapucaí', tacuati: 'Tacuatí', tavai: 'Tavaí',
  ybycui: 'Ybycuí', ybytymi: 'Ybytymí', yrybucua: 'Yrybucuá', cua: 'Cuá', guajayvi: 'Guajayví', ycuamandyyu: 'Ycuamandyyú', abai: 'Abaí',
  benjamin: 'Benjamín', 'dr.': 'Dr.', 'gral.': 'Gral.', "o'leary": "O'Leary", 'kaã‘y': 'Cañy', 'kañy': 'Cañy', iruña: 'Iruña' };
const MENORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'el']);
const nombre = t => String(t).toLowerCase().split(/\s+/).map((w, i) => {
  if (i && MENORES.has(w)) return w;
  return ACENTOS[w] || (w.includes('.') ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
}).join(' ');

const bbox = rings => rings.flat().reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
const anillos = f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map(p => p[0]); // solo el contorno exterior
const corta = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const amplia = (b, k) => { const w = (b[2] - b[0]) * k, h = (b[3] - b[1]) * k; return [b[0] - w, b[1] - h, b[2] + w, b[3] + h]; };

function simplificar(pts, eps) {
  if (pts.length < 4) return pts;
  const cos = Math.cos(pts[0][1] * Math.PI / 180);
  const d = (p, a, b) => { const ax = a[0] * cos, bx = b[0] * cos, px = p[0] * cos, dx = bx - ax, dy = b[1] - a[1];
    const l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (p[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), p[1] - (a[1] + t * dy)); };
  const marca = new Uint8Array(pts.length); marca[0] = marca[pts.length - 1] = 1;
  const pila = [[0, pts.length - 1]];
  while (pila.length) { const [i, j] = pila.pop(); let m = 0, k = -1;
    for (let x = i + 1; x < j; x++) { const v = d(pts[x], pts[i], pts[j]); if (v > m) { m = v; k = x; } }
    if (m > eps) { marca[k] = 1; pila.push([i, k], [k, j]); } }
  return pts.filter((_, i) => marca[i]);
}
const Q = 1e4;
const codificar = ring => { let px = 0, py = 0; const out = [];
  for (const [x, y] of ring) { const qx = Math.round(x * Q), qy = Math.round(y * Q); if (out.length && qx === px && qy === py) continue; out.push(qx - px, qy - py); px = qx; py = qy; }
  return out; };

const feats = geo.features.map(f => ({ f, clave: f.properties.CLAVE, rings: anillos(f) })).map(x => ({ ...x, b: bbox(x.rings) }));
const objetivos = feats.filter(x => conPlano(x.f));
// Recorte de un anillo a un rectángulo (Sutherland-Hodgman): lo que queda fuera del plano no se guarda.
function recortar(ring, [x0, y0, x1, y1]) {
  const lados = [[p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
    [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]];
  let out = ring;
  for (const [dentro, cruce] of lados) {
    const ent = out; out = [];
    for (let i = 0; i < ent.length; i++) { const a = ent[i], b = ent[(i + 1) % ent.length];
      if (dentro(b)) { if (!dentro(a)) out.push(cruce(a, b)); out.push(b); } else if (dentro(a)) out.push(cruce(a, b)); }
    if (!out.length) break;
  }
  if (out.length) out.push(out[0]);
  return out;
}
const usados = new Map(); // clave -> { x, zona (unión), eps }
const planos = {};
for (const o of objetivos) {
  // El plano muestra el distrito con aire alrededor; se guarda un margen más para que nada se corte a la vista.
  const zona = amplia(o.b, 0.45);
  const eps = Math.max(0.00025, Math.hypot(o.b[2] - o.b[0], o.b[3] - o.b[1]) * 0.003);
  const vecinos = feats.filter(x => x !== o && corta(x.b, amplia(o.b, 0.3)));
  planos[o.clave] = vecinos.map(v => v.clave);
  for (const x of [o, ...vecinos]) {
    const u = usados.get(x.clave);
    const z = x === o ? x.b : zona;
    if (!u) usados.set(x.clave, { x, zona: z, eps });
    else { u.zona = [Math.min(u.zona[0], z[0]), Math.min(u.zona[1], z[1]), Math.max(u.zona[2], z[2]), Math.max(u.zona[3], z[3])]; u.eps = Math.min(u.eps, eps); }
  }
}
const DIST = {};
for (const [clave, { x, zona, eps }] of usados) {
  const rings = x.rings.map(r => simplificar(recortar(r, zona), eps)).filter(r => r.length >= 4)
    .sort((a, b) => b.length - a.length).slice(0, 6); // islas mínimas fuera
  DIST[clave] = { n: nombre(x.f.properties.DIST_DESC_), d: nombre(x.f.properties.DPTO_DESC), b: x.b.map(v => Math.round(v * Q)), r: rings.map(codificar) };
}
const js = `/* Distritos de Paraguay para los planos de la sala de control. GENERADO por scripts/gen-distritos-impar.mjs: no editar a mano.
   Fuente: Instituto Nacional de Estadística (INE), Paraguay — Cartografía Censal 2022 (límites distritales).
   Coordenadas en 1e-4 grados, anillo exterior con deltas enteros; b = [oeste, sur, este, norte]. */
export const ESCALA = ${Q};
export const DISTRITOS = ${JSON.stringify(DIST)};
/** Distritos con plano propio y los vecinos que se dibujan alrededor. */
export const PLANOS = ${JSON.stringify(planos)};
`;
writeFileSync(new URL('../public/js/distritos-py.js', import.meta.url), js);
console.log(`Listo: ${objetivos.length} planos, ${usados.size} distritos, ${(js.length / 1024).toFixed(0)} KB`);
