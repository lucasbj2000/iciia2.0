/* IMPAR · Ícono de clima animado (SVG + CSS). La animación vive en impar-diseno.css
   (.wxa-*) y se detiene con «reducir movimiento». Sin imágenes externas. */

const NUBE = 'M14 34h20a7 7 0 000-14 10 10 0 00-19.2-2.6A7.5 7.5 0 0014 34z';

const sol = (extra = '') => `<g class="wxa-sol ${extra}">
  <g class="wxa-rayos">${Array.from({ length: 8 }, (_, i) =>
    `<line x1="24" y1="5" x2="24" y2="9.5" transform="rotate(${i * 45} 24 24)"/>`).join('')}</g>
  <circle class="wxa-nucleo" cx="24" cy="24" r="8"/></g>`;
const luna = () => `<g class="wxa-luna"><path class="wxa-creciente" d="M30 9a13 13 0 1 0 9 22.5A11 11 0 0 1 30 9z"/>
  <path class="wxa-estrella e1" d="M12 10l1 2.2 2.2 1-2.2 1L12 16.4l-1-2.2-2.2-1 2.2-1z"/>
  <path class="wxa-estrella e2" d="M8 26l.7 1.4 1.4.7-1.4.7L8 30.2l-.7-1.4-1.4-.7 1.4-.7z"/>
  <circle class="wxa-estrella e3" cx="19" cy="6" r="1"/></g>`;
const nube = (cls = '') => `<path class="wxa-nube ${cls}" d="${NUBE}"/>`;
const gotas = (n, cls = 'wxa-gota') => Array.from({ length: n }, (_, i) =>
  `<line class="${cls} g${i + 1}" x1="${17 + i * 7}" y1="37" x2="${15.5 + i * 7}" y2="41"/>`).join('');
const copos = () => [16, 24, 32].map((x, i) => `<circle class="wxa-copo c${i + 1}" cx="${x}" cy="39" r="1.6"/>`).join('');

/** Códigos de clima de Open-Meteo → escena animada. */
export function escenaClima(cod) {
  const c = Number(cod);
  if (c <= 1) return 'despejado';
  if (c === 2) return 'parcial';
  if (c === 3) return 'nublado';
  if (c === 45 || c === 48) return 'niebla';
  if (c >= 51 && c <= 57) return 'llovizna';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'lluvia';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'nieve';
  if (c >= 95) return 'tormenta';
  return 'nublado';
}
export const esDeNoche = (fecha = new Date()) => { const h = fecha.getHours(); return h < 6 || h >= 19; };

export function iconoClima(cod, noche = esDeNoche()) {
  const e = escenaClima(cod);
  const astro = noche ? luna() : sol();
  const cuerpo = {
    despejado: astro,
    parcial: `<g class="wxa-atras">${noche ? luna() : sol('chico')}</g>${nube('delante')}`,
    nublado: `${nube('atras2')}${nube('delante')}`,
    niebla: `${nube('atras2')}<line class="wxa-bruma b1" x1="8" y1="38" x2="34" y2="38"/><line class="wxa-bruma b2" x1="14" y1="43" x2="40" y2="43"/>`,
    llovizna: `${nube('delante')}${gotas(2, 'wxa-gota lenta')}`,
    lluvia: `${nube('delante')}${gotas(3)}`,
    nieve: `${nube('delante')}${copos()}`,
    tormenta: `${nube('delante oscura')}<path class="wxa-rayo" d="M25 30l-5 8h4.5l-2.5 7 7-10h-4.6l2.6-5z"/>${gotas(2)}`
  }[e];
  return `<svg class="wxa wxa-${e}${noche ? ' wxa-noche' : ''}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${cuerpo}</svg>`;
}

export function saludoHora(fecha = new Date()) {
  const h = fecha.getHours();
  return h < 12 ? 'Buen día' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}
