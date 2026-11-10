/* IMPAR · Plano del distrito donde está cada sucursal, con límites oficiales del INE (Censo 2022).
   Estilo cartográfico sobrio: distrito destacado, distritos vecinos con su nombre, ubicación exacta de la
   sucursal con marca de registro, flecha de norte y escala gráfica en kilómetros. */
import { DISTRITOS, PLANOS, ESCALA } from './distritos-py.js';

const cache = new Map();
function anillos(clave) {
  if (cache.has(clave)) return cache.get(clave);
  const d = DISTRITOS[clave];
  const rs = d.r.map(enc => { const out = []; let x = 0, y = 0;
    for (let i = 0; i < enc.length; i += 2) { x += enc[i]; y += enc[i + 1]; out.push([x / ESCALA, y / ESCALA]); } return out; });
  cache.set(clave, rs); return rs;
}
const caja = clave => DISTRITOS[clave].b.map(v => v / ESCALA);
function dentro([x, y], ring) {
  let s = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) s = !s;
  }
  return s;
}
const sinAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^impar\s+/, '').trim();
const ALIAS = { 'madame lynch': 'fernando de la mora', 'barrio obrero': 'asuncion', matriz: 'asuncion', central: 'asuncion', cde: 'ciudad del este', pjc: 'pedro juan caballero' };

/** Distrito (clave INE) de una sucursal: por su nombre (o el nombre conocido de la zona) y, si no, por su ubicación. */
export function distritoDe({ nombre, lat, lon }) {
  const n = sinAcento(nombre), buscado = ALIAS[n] || n;
  const porNombre = Object.keys(PLANOS).find(k => sinAcento(DISTRITOS[k].n) === buscado);
  if (porNombre) return porNombre;
  if (lat != null && lon != null) {
    for (const k of Object.keys(PLANOS)) {
      const b = caja(k);
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (anillos(k).some(r => dentro([lon, lat], r))) return k;
    }
  }
  return null;
}

const kmEntre = (a, b) => { const r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const f1 = v => v.toFixed(1);

/** SVG del plano. W×H fija la proporción del dibujo. */
export function planoCiudad(s, { W = 320, H = 190 } = {}) {
  const clave = distritoDe(s);
  if (!clave) return '';
  const d = DISTRITOS[clave], b = caja(clave);
  const cos = Math.cos((b[1] + b[3]) / 2 * Math.PI / 180);
  // Encuadre: el distrito con 12 % de aire, respetando la proporción del lienzo.
  let w = (b[2] - b[0]) * cos, h = b[3] - b[1];
  const m = 1.24; w *= m; h *= m;
  if (w / h > W / H) h = w * H / W; else w = h * W / H;
  const cx = (b[0] + b[2]) / 2 * cos, cy = (b[1] + b[3]) / 2, k = W / w;
  const P = ([lon, lat]) => [(lon * cos - cx) * k + W / 2, (cy - lat) * k + H / 2];
  const ruta = rs => rs.map(r => r.map((p, i) => (i ? 'L' : 'M') + P(p).map(f1).join(' ')).join('') + 'Z').join('');
  const vista = [cx / cos - w / 2 / cos, cy - h / 2, cx / cos + w / 2 / cos, cy + h / 2];

  // Vecinos con nombre donde caben: el rótulo va en el centro de la parte visible si queda dentro del distrito.
  const vecinos = PLANOS[clave].map(v => {
    const rs = anillos(v), bb = caja(v);
    const ix = [Math.max(bb[0], vista[0]), Math.max(bb[1], vista[1]), Math.min(bb[2], vista[2]), Math.min(bb[3], vista[3])];
    let rot = null;
    if (ix[0] < ix[2] && ix[1] < ix[3]) {
      const c = [(ix[0] + ix[2]) / 2, (ix[1] + ix[3]) / 2], [px, py] = P(c);
      const ancho = (ix[2] - ix[0]) * cos * k;
      if (rs.some(r => dentro(c, r)) && ancho > 46 && px > 24 && px < W - 24 && py > 16 && py < H - 22) rot = [px, py];
    }
    return { v, d: ruta(rs), rot, nom: DISTRITOS[v].n };
  });

  // Rótulos sin encimarse entre sí ni sobre la sucursal (primero los nombres cortos).
  const fuente = `${d.d === d.n ? 'Distrito Capital' : 'Dpto. ' + d.d} · INE 2022`;
  // Lugares ocupados: rótulo de fuente (arriba a la izquierda), norte (arriba a la derecha) y escala (abajo).
  const puestos = [[8 + fuente.length * 2.6, 12, fuente.length * 5.2], [W - 16, 18, 24], [60, H - 14, 120]];
  const choca = (x, y, w) => puestos.some(q => Math.abs(q[0] - x) < (q[2] + w) / 2 + 4 && Math.abs(q[1] - y) < 14);
  vecinos.filter(x => x.rot).sort((a, b) => a.nom.length - b.nom.length).forEach(x => {
    const w = x.nom.length * 5.8;
    if (x.rot[0] - w / 2 < 4 || x.rot[0] + w / 2 > W - 4 || choca(x.rot[0], x.rot[1], w)) x.rot = null;
    else puestos.push([x.rot[0], x.rot[1], w]);
  });
  // Escala gráfica: largo redondo cercano a un cuarto del ancho.
  const kmAncho = kmEntre([vista[0], cy], [vista[2], cy]);
  const largo = [0.5, 1, 2, 3, 5, 10, 20, 25, 50].reduce((a, x) => Math.abs(x - kmAncho / 4) < Math.abs(a - kmAncho / 4) ? x : a, 1);
  const px = largo / kmAncho * W;
  const enVista = s.lat != null && s.lon != null && s.lon > vista[0] && s.lon < vista[2] && s.lat > vista[1] && s.lat < vista[3];
  const pin = enVista ? P([s.lon, s.lat]) : null;
  if (pin) vecinos.forEach(x => { if (x.rot && Math.abs(x.rot[0] - pin[0]) < x.nom.length * 3 + 14 && Math.abs(x.rot[1] - pin[1]) < 16) x.rot = null; });

  return `<svg class="plano" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Plano del distrito de ${d.n} (${d.d})${pin ? ' con la ubicación de la sucursal' : ''}">
    <defs><clipPath id="pl-${clave}"><rect width="${W}" height="${H}"/></clipPath>
      <pattern id="pl-tr-${clave}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6" class="plano-trama"/></pattern></defs>
    <g clip-path="url(#pl-${clave})">
      <rect class="plano-fondo" width="${W}" height="${H}" fill="url(#pl-tr-${clave})"/>
      ${vecinos.map(x => `<path class="plano-vecino" d="${x.d}"/>`).join('')}
      <path class="plano-distrito" d="${ruta(anillos(clave))}"/>
      ${vecinos.filter(x => x.rot).map(x => `<text class="plano-rot-v" x="${f1(x.rot[0])}" y="${f1(x.rot[1])}" text-anchor="middle">${x.nom}</text>`).join('')}
      ${pin ? `<g class="plano-pin" transform="translate(${f1(pin[0])} ${f1(pin[1])})"><g class="sala-ondas"></g>
        <circle class="plano-pin-halo" r="9"/><circle class="plano-pin-c" r="4.2"/><path class="plano-pin-cruz" d="M-11 0H-6M6 0H11M0 -11V-6M0 6V11"/></g>` : ''}
    </g>
    <g class="plano-norte" transform="translate(${W - 16} 16)"><path d="M0 -10L4.5 4L0 1.5L-4.5 4Z"/><text y="15" text-anchor="middle">N</text></g>
    <g class="plano-escala" transform="translate(10 ${H - 10})">
      <rect width="${f1(px / 2)}" height="3.5" class="lleno"/><rect x="${f1(px / 2)}" width="${f1(px / 2)}" height="3.5"/>
      <text x="0" y="-4">0</text><text x="${f1(px)}" y="-4" text-anchor="middle">${String(largo).replace('.', ',')} km</text></g>
    <text class="plano-fuente" x="8" y="15">${fuente}</text>
  </svg>`;
}
