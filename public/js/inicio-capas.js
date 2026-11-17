/* IMPAR · Fondo del inicio de sesión: capas de papel recortado que ondulan despacio.
   - Solo corre mientras se ve el inicio de sesión; al entrar al CRM se detiene.
   - Tiene colores propios para el modo claro y el oscuro, y cambia si cambia el tema.
   - Con «movimiento reducido» queda quieto. */
import { saludoHora } from './clima-animado.js';

const NS = 'http://www.w3.org/2000/svg';
const PALETAS = {
  claro: {
    abajo: ['#E4F0D8', '#CFE6BB', '#B3D894', '#94C96C', '#73BC45', '#5A9F33', '#3F7F22', '#2E6416'],
    arriba: ['#EDF3E6', '#DDEBCF', '#C9E0B4'],
    sombra: '#1D3A0E', fuerza: [.22, .13], grano: .05,
  },
  oscuro: {
    abajo: ['#142012', '#182915', '#1D3318', '#233F1B', '#2A4D1F', '#335E24', '#3E722A', '#4F8E33'],
    arriba: ['#121B10', '#162214', '#1A2A17'],
    sombra: '#000000', fuerza: [.45, .35], grano: .07,
  },
};

const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let semilla = 11;
const rnd = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;

let escena = null, svg = null, capas = [], grupos = [], paths = [];
let corriendo = false, cuadro = 0, ultimo = 0, inicioMs = 0;
let mx = 0, my = 0, tx = 0, ty = 0;

function tema() { return document.documentElement.dataset.tema === 'oscuro' ? 'oscuro' : 'claro'; }

function borde(c, t) {
  const pts = [], pasos = 72, fase = c.fase + t * c.vel;
  for (let k = 0; k <= pasos; k++) {
    const a = c.ini + (c.fin - c.ini) * k / pasos;
    const r = c.r * (1 + c.amp * Math.sin(a * c.ondas + fase) + c.amp * .45 * Math.sin(a * c.ondas * 2.3 - fase * 1.3));
    pts.push([c.cx + Math.cos(a) * r, c.cy + Math.sin(a) * r]);
  }
  let d = `M${c.cx.toFixed(1)},${c.cy.toFixed(1)} L${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let k = 1; k < pts.length - 1; k++) {
    const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
    d += ` Q${x1.toFixed(1)},${y1.toFixed(1)} ${((x1 + x2) / 2).toFixed(1)},${((y1 + y2) / 2).toFixed(1)}`;
  }
  return d + ' Z';
}

function el(tag, attrs = {}, padre) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (padre) padre.append(e);
  return e;
}

function montar(conEntrada) {
  if (!escena) {
    escena = document.createElement('div');
    escena.id = 'pc-escena';
    escena.setAttribute('aria-hidden', 'true');
    document.body.prepend(escena);
  }
  semilla = 11;
  const W = innerWidth, H = innerHeight, movil = W < 960;
  const base = Math.hypot(W, H) * (movil ? .5 : .64);
  const p = PALETAS[tema()];
  const cx = movil ? W * .55 : W, cy = H * 1.04;
  capas = [];
  p.abajo.forEach((color, i) => capas.push({ color, cx, cy, r: base * (1 - i * .094), ini: Math.PI, fin: Math.PI * 2,
    ondas: 5 + (i % 3), amp: .04 + rnd() * .02, fase: rnd() * 6.28, vel: (.10 + rnd() * .08) * (i % 2 ? 1 : -1),
    prof: (i + 1) / p.abajo.length, filtro: 'pcA', i }));
  p.arriba.forEach((color, i) => capas.push({ color, cx: -W * .02, cy: -H * .05, r: base * (.40 - i * .095), ini: 0, fin: Math.PI / 2,
    ondas: 6, amp: .05, fase: rnd() * 6.28, vel: .08 * (i % 2 ? 1 : -1), prof: .15 + i * .1, filtro: 'pcB', i, arriba: true }));

  escena.textContent = '';
  svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' }, escena);
  const defs = el('defs', {}, svg);
  [['pcA', -6, 9, p.fuerza[0]], ['pcB', 6, 8, p.fuerza[1]]].forEach(([id, dy, desvio, op]) => {
    const f = el('filter', { id, x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    el('feDropShadow', { dx: 0, dy, stdDeviation: desvio, 'flood-color': p.sombra, 'flood-opacity': op }, f);
  });
  const g = el('filter', { id: 'pcGrano' }, defs);
  el('feTurbulence', { type: 'fractalNoise', baseFrequency: '.9', numOctaves: 2, stitchTiles: 'stitch' }, g);
  el('feColorMatrix', { values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${p.grano} 0` }, g);

  grupos = []; paths = [];
  capas.forEach((c, n) => {
    const grupo = el('g', { class: 'pc-capa' }, svg);
    const path = el('path', { fill: c.color, filter: `url(#${c.filtro})` }, grupo);
    if (conEntrada && !reducido()) {
      grupo.classList.add('oculta');
      grupo.style.transform = c.arriba ? 'translate(-40px,-60px)' : `translateY(${120 + c.i * 26}px)`;
      grupo.style.transitionDelay = `${(c.arriba ? n - p.abajo.length : n) * 90}ms`;
    }
    grupos.push(grupo); paths.push(path);
  });
  el('rect', { width: W, height: H, filter: 'url(#pcGrano)', class: 'pc-grano' }, svg);
  pintar(performance.now() / 1000);
  if (conEntrada) requestAnimationFrame(() => requestAnimationFrame(() => grupos.forEach(gr => {
    gr.classList.remove('oculta'); gr.style.transform = 'none';
  })));
  inicioMs = performance.now();
}

function pintar(t) { capas.forEach((c, i) => paths[i]?.setAttribute('d', borde(c, t))); }

function bucle(ms) {
  if (!corriendo) return;
  cuadro = requestAnimationFrame(bucle);
  if (reducido() || ms - ultimo < 33) return;  // 30 cuadros por segundo alcanzan para ondas lentas
  ultimo = ms;
  pintar(ms / 1000);
  mx += (tx - mx) * .06; my += (ty - my) * .06;
  if (ms - inicioMs > 2600) grupos.forEach((gr, i) => {
    const p = capas[i].prof;
    gr.style.transition = 'opacity 1s ease';
    gr.style.transitionDelay = '0ms';
    gr.style.transform = `translate(${(-mx * 26 * p).toFixed(1)}px,${(-my * 18 * p).toFixed(1)}px)`;
  });
}

function saludo() {
  const caja = document.getElementById('l-saludo');
  if (!caja) return;
  const h = new Date().getHours();
  caja.classList.toggle('noche', h < 6 || h >= 19);
  const txt = caja.querySelector('span');
  if (txt) txt.textContent = saludoHora();
}

function encender() {
  if (corriendo) return;
  document.documentElement.classList.add('en-acceso');
  saludo();
  montar(true);
  corriendo = true;
  cuadro = requestAnimationFrame(bucle);
}
function apagar() {
  if (!corriendo && !escena) return;
  corriendo = false;
  cancelAnimationFrame(cuadro);
  // classList.remove escribe el atributo aunque no cambie: sin esta guarda el observador se dispara en bucle.
  if (document.documentElement.classList.contains('en-acceso')) document.documentElement.classList.remove('en-acceso');
  if (escena) { escena.remove(); escena = null; svg = null; }
}

export function iniciarInicioCapas() {
  const login = document.getElementById('login');
  if (!login) return;
  const revisar = () => {
    const visible = !login.classList.contains('hidden') &&
      !document.documentElement.classList.contains('sesion-verificando');
    visible ? encender() : apagar();
  };
  new MutationObserver(revisar).observe(login, { attributes: true, attributeFilter: ['class'] });
  let temaActual = tema();
  new MutationObserver(() => {
    revisar();
    // Cambio de tema: repintar con la otra paleta.
    if (tema() !== temaActual) { temaActual = tema(); if (corriendo && escena) montar(false); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-tema'] });
  addEventListener('pointermove', e => { tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5; }, { passive: true });
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (corriendo) montar(false); }, 150); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(cuadro); }
    else if (corriendo) cuadro = requestAnimationFrame(bucle);
  });
  revisar();
}
