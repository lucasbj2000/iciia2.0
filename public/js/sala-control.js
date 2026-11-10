/* IMPAR · Sala de control en vivo — todo en una sola pantalla.
   Mapa real de Paraguay con las sucursales, calor de clientes y clima por ciudad; cola con relojes,
   agentes en línea, tasa de respuesta, ritmo del día y movimientos en vivo. Pensada para una TV. */
import { $, $$, esc, get, iniciales, DISPONIBILIDAD } from './core.js';
import { menosMovimiento, correr } from './animaciones.js';
import { iconoClima, esDeNoche } from './clima-animado.js';
import { CONTORNOS } from './mapa-paraguay.js';

const REFRESCO_MS = 30000, CLIMA_MS = 600000;
const PULSOS = {
  nuevo: { t: 'Cliente nuevo' },
  mensaje: { t: 'Mensaje de cliente' },
  respuesta: { t: 'Respuesta del equipo' },
  venta: { t: 'Venta cerrada' }
};
const ESTADO_WA = {
  conectado: { t: 'WhatsApp conectado', c: 'ok' },
  reconectando: { t: 'WhatsApp reconectando', c: 'alerta' },
  conectando: { t: 'WhatsApp conectando', c: 'alerta' }
};

/* ---------- Proyección ---------- */
const LON0 = -63.25, LAT0 = -18.85, LON1 = -53.85, LAT1 = -28.05, ESC = 100, COS = Math.cos(23.5 * Math.PI / 180);
const px = ([lon, lat]) => [(lon - LON0) * ESC * COS, (LAT0 - lat) * ESC];
const ANCHO = (LON1 - LON0) * ESC * COS, ALTO = (LAT0 - LAT1) * ESC;
const ruta = (pts, cerrar = false) => pts.map((p, i) => (i ? 'L' : 'M') + px(p).map(v => v.toFixed(1)).join(' ')).join('') + (cerrar ? 'Z' : '');
const PAIS = CONTORNOS.paraguay.map(r => ruta(r, true)).join('');

const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^impar\s+/, '').trim();
const km = (a, b) => { const r = x => x * Math.PI / 180, dl = r(b.lat - a.lat), dn = r(b.lon - a.lon);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };

/* ---------- Formatos ---------- */
const gsCorto = n => {
  n = Number(n) || 0;
  if (n >= 1e9) return 'Gs ' + (n / 1e9).toLocaleString('es-PY', { maximumFractionDigits: 1 }) + ' mil M';
  if (n >= 1e6) return 'Gs ' + (n / 1e6).toLocaleString('es-PY', { maximumFractionDigits: 1 }) + ' M';
  return 'Gs ' + n.toLocaleString('es-PY');
};
const duracion = seg => {
  if (seg == null) return '—';
  seg = Math.max(0, Math.round(seg));
  if (seg < 60) return `${seg} s`;
  if (seg < 3600) return `${Math.round(seg / 60)} min`;
  const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
};
const reloj = d => d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Asuncion' });
const fechaLarga = d => d.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Asuncion' });
const espera = desde => { const s = Math.max(0, (Date.now() - new Date(desde)) / 1000); const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const horaAsu = () => Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Asuncion' })) % 24;
const disp = id => DISPONIBILIDAD.find(x => x.id === id) || DISPONIBILIDAD[DISPONIBILIDAD.length - 1];
/** Ícono de clima animado dentro del mapa (SVG anidado). */
const climaEn = (cod, x, y, t) => iconoClima(cod, esDeNoche()).replace('<svg ', `<svg x="${x}" y="${y}" width="${t}" height="${t}" `);

let E = null;

/* ---------- Datos derivados ---------- */
function sucursalesConDatos(d) {
  const por = new Map(d.porSucursal.map(x => [norm(x.sucursal), x]));
  const usadas = new Set();
  const lista = d.sucursales.map(s => {
    const k = norm(s.nombre), x = por.get(k) || {}; usadas.add(k);
    return { nombre: s.nombre, k, lat: s.lat, lon: s.lon, abiertas: x.abiertas || 0, espera: x.espera || 0,
      nuevos: x.nuevos || 0, ventas: x.ventas || 0, monto: x.monto || 0 };
  });
  const resto = d.porSucursal.filter(x => !usadas.has(norm(x.sucursal)));
  if (resto.length) lista.push(resto.reduce((a, x) => ({ ...a, abiertas: a.abiertas + x.abiertas, espera: a.espera + x.espera,
    nuevos: a.nuevos + x.nuevos, ventas: a.ventas + x.ventas, monto: a.monto + x.monto }),
    { nombre: 'Sin sucursal', k: '', sin: true, abiertas: 0, espera: 0, nuevos: 0, ventas: 0, monto: 0 }));
  return lista;
}
function agrupar(lista) {
  const grupos = [];
  for (const s of lista.filter(s => s.lat != null && s.lon != null)) {
    const g = grupos.find(g => g.some(o => km(o, s) < 25));
    if (g) g.push(s); else grupos.push([s]);
  }
  return grupos;
}

/* ---------- Mapa ---------- */
function etiqueta(s, izq) {
  const cl = E.clima.get(norm(s.nombre));
  const linea2 = s.espera ? `${s.espera} ${s.espera === 1 ? 'espera' : 'esperan'} · ${s.nuevos} hoy` : `${s.nuevos} nuevos hoy · ${s.abiertas} abiertas`;
  return `<g class="sala-etiqueta${izq ? ' izq' : ''}" data-izq="${izq ? 1 : 0}">
    <rect class="sala-e-fondo" rx="10" height="58"/>
    <text class="sala-nombre" y="25">${esc(s.nombre)}</text>
    <text class="sala-dato${s.espera ? ' espera' : ''}" y="47">${linea2}</text>
    ${cl && cl.temp != null ? `<g class="sala-e-clima">${climaEn(cl.cod, 0, 8, 34)}<text class="sala-temp" x="38" y="34">${Math.round(cl.temp)}°</text></g>` : ''}
  </g>`;
}
/* Plano tipo red de metro: Gran Asunción es un anillo con sus sucursales como estaciones y cada sucursal
   lejana es una línea que sale en su dirección real (redondeada a 45°), con la distancia anotada.
   Sin recuadros ampliados: todo se lee a la misma escala. La silueta de Paraguay queda de fondo. */
const RW = 900, RH = 640, HX = 420, HY = 320, RA = 92, COL_X = 270, COL_PASO = 92;
const COLORES_LINEA = ['#7CC24F', '#5FA8F0', '#F0B44C', '#B79AE6', '#5CCBBE', '#F08FB0', '#E8E06A'];
function rumbo(desde, hasta) {
  const y = Math.sin((hasta.lon - desde.lon) * Math.PI / 180) * Math.cos(hasta.lat * Math.PI / 180);
  const x = Math.cos(desde.lat * Math.PI / 180) * Math.sin(hasta.lat * Math.PI / 180) - Math.sin(desde.lat * Math.PI / 180) * Math.cos(hasta.lat * Math.PI / 180) * Math.cos((hasta.lon - desde.lon) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; // 0 = norte, 90 = este
}
function planoRed(lista) {
  const ubicadas = lista.filter(s => !s.sin);
  const conGeo = ubicadas.filter(s => s.lat != null && s.lon != null);
  const grupos = agrupar(conGeo);
  const anillo = (grupos.sort((a, b) => b.length - a.length)[0] || []).slice();
  const centro = anillo.length ? { lat: anillo.reduce((a, s) => a + s.lat, 0) / anillo.length, lon: anillo.reduce((a, s) => a + s.lon, 0) / anillo.length }
    : { lat: -25.3, lon: -57.6 };
  // Sucursales sin coordenadas también van al anillo (no se pierden).
  ubicadas.filter(s => s.lat == null || s.lon == null).forEach(s => anillo.push(s));
  const lejanas = conGeo.filter(s => !anillo.includes(s)).map(s => ({ s, ang: rumbo(centro, s), km: Math.round(km(centro, s)) }));
  // Estaciones del anillo: repartidas parejo sobre el lado oeste, en el orden real norte → sur.
  const metro = anillo.map(s => ({ s, ang: s.lat != null ? rumbo(centro, s) : 270 })).sort((a, b) => (b.s.lat ?? -99) - (a.s.lat ?? -99));
  const n = metro.length, abre = Math.min(150, 40 * Math.max(1, n - 1));
  metro.forEach((m, i) => {
    const a = (n === 1 ? 270 : 270 - abre / 2 + abre * i / (n - 1)) * Math.PI / 180; // grados de brújula
    m.x = HX + RA * Math.sin(a); m.y = HY - RA * Math.cos(a);
  });
  // Líneas lejanas: salen del anillo a 45°, luego horizontales hasta la terminal.
  lejanas.sort((a, b) => a.ang - b.ang);
  const usados = new Map();
  lejanas.forEach(l => {
    let q = Math.round(l.ang / 45) * 45 % 360;
    if (q > 180 && q < 360) q = q <= 270 ? 180 : 0; // hacia el oeste no hay lugar: se pliegan al norte o al sur
    while (usados.get(q)) q = (q + 45) % 360;
    usados.set(q, true); l.q = q;
    const r = q * Math.PI / 180, dx = Math.sin(r), dy = -Math.cos(r);
    const x0 = HX + RA * dx, y0 = HY + RA * dy;
    const diag = q === 0 || q === 180 ? 170 : q % 90 ? 190 : 150;
    const x1 = x0 + dx * diag, y1 = y0 + dy * diag;
    const xt = q === 0 || q === 180 || q === 90 ? x1 : x1 + 40, yt = y1;
    l.x = xt; l.y = yt;
    const recta = q % 90 === 0;
    l.d = recta ? `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`
      : `M${x0.toFixed(1)} ${y0.toFixed(1)}L${(x1 - 14 * dx).toFixed(1)} ${(y1 - 14 * dy).toFixed(1)}Q${x1.toFixed(1)} ${y1.toFixed(1)} ${(x1 + 16).toFixed(1)} ${y1.toFixed(1)}L${xt.toFixed(1)} ${yt.toFixed(1)}`;
    if (recta) { l.mx = (x0 + x1) / 2 + (q === 90 ? 0 : 34); l.my = (y0 + y1) / 2 + (q === 90 ? 0 : 16); }
    else { l.mx = (x0 + x1) / 2 + 16; l.my = (y0 + y1) / 2 + 5; l.ini = true; }
  });
  return { metro, lejanas, centro };
}
function estacion(s, x, y, color, izq, rotulo) {
  const tam = 9 + Math.min(9, Math.sqrt(s.nuevos) * 2.2);
  // rotulo = punto (absoluto) donde va el rótulo; si no hay, va pegado a la estación.
  const rx = rotulo ? rotulo[0] - x : (izq ? -(tam + 16) : tam + 16), ry = rotulo ? rotulo[1] - y : 0;
  const guia = rotulo ? `<path class="sala-guia-r" d="M${(izq ? -tam - 4 : tam + 4).toFixed(1)} 0L${(rx + (izq ? 22 : -22)).toFixed(1)} ${ry.toFixed(1)}L${rx.toFixed(1)} ${ry.toFixed(1)}"/>` : '';
  return `<g class="sala-pin sala-est${s.espera ? ' con-espera' : ''}" data-suc="${esc(s.k)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" style="--linea:${color}">
    ${guia}<g class="sala-ondas"></g>
    ${s.espera ? `<circle class="sala-radar" r="${tam}"/>` : ''}
    <circle class="sala-est-halo" r="${(tam + 7).toFixed(1)}"/>
    <circle class="sala-est-nodo" r="${tam.toFixed(1)}"/>
    <text class="sala-est-n" y="5" text-anchor="middle">${s.espera || ''}</text>
    <g transform="translate(${rx.toFixed(1)} ${(ry - 29).toFixed(1)})">${etiqueta(s, izq)}</g></g>`;
}
function htmlMapa(lista) {
  const { metro, lejanas, centro } = planoRed(lista);
  // Silueta de fondo: Asunción real queda debajo del anillo, así las líneas apuntan hacia donde están las ciudades.
  const esc2 = (RH * 1.05) / ALTO, [cx, cy] = px([centro.lon, centro.lat]), ox = HX - cx * esc2, oy = HY - cy * esc2;
  const activo = s => Math.min(1, (s.nuevos + s.espera * 2) / 12);
  return `<svg class="sala-svg sala-red" viewBox="0 0 ${RW} ${RH}" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Red de sucursales de IMPAR: ${metro.length} en Gran Asunción y ${lejanas.length} en el interior, con clientes en espera y clima">
    <defs><filter id="sala-brillo" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter></defs>
    <path class="sala-silueta" d="${PAIS}" transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)}) scale(${esc2.toFixed(4)})"/>
    <g class="sala-red-cont">
    ${lejanas.map((l, i) => { const c = COLORES_LINEA[(i + 1) % COLORES_LINEA.length];
      return `<g class="sala-linea" style="--linea:${c};--vel:${(6 - activo(l.s) * 4).toFixed(1)}s">
        <path class="sala-l-brillo" d="${l.d}" filter="url(#sala-brillo)"/>
        <path class="sala-l-via" id="sala-via-${esc(l.s.k)}" d="${l.d}"/>
        <path class="sala-l-flujo" d="${l.d}"/>
        <text class="sala-l-km" x="${l.mx.toFixed(1)}" y="${(l.my - (l.ini ? 0 : 12)).toFixed(1)}" text-anchor="${l.ini ? 'start' : 'middle'}">${l.km.toLocaleString('es-PY')} km</text></g>`; }).join('')}
    <g class="sala-anillo-red" style="--linea:${COLORES_LINEA[0]}">
      <circle class="sala-l-brillo" cx="${HX}" cy="${HY}" r="${RA}" filter="url(#sala-brillo)"/>
      <circle class="sala-l-via" cx="${HX}" cy="${HY}" r="${RA}"/>
      <circle class="sala-l-flujo anillo" cx="${HX}" cy="${HY}" r="${RA}"/>
      <text class="sala-hub-t" x="${HX}" y="${HY - 4}" text-anchor="middle">Gran</text>
      <text class="sala-hub-t" x="${HX}" y="${HY + 16}" text-anchor="middle">Asunción</text></g>
    ${metro.map((m, i) => estacion(m.s, m.x, m.y, COLORES_LINEA[0], true, [COL_X, HY + (i - (metro.length - 1) / 2) * COL_PASO])).join('')}
    ${lejanas.map((l, i) => estacion(l.s, l.x, l.y, COLORES_LINEA[(i + 1) % COLORES_LINEA.length], false)).join('')}
    </g>
  </svg>
  <div class="sala-leyenda-mapa">
    <span class="sala-ley-i"><i class="sala-ley-nodo"></i>Tamaño: clientes nuevos hoy</span>
    <span class="sala-ley-i"><i class="sala-ley-radar"></i>Número y onda: clientes esperando</span>
    <span class="sala-ley-i"><i class="sala-ley-tren"></i>Cada mensaje viaja hasta su sucursal</span>
  </div>`;
}
/** Encuadra el plano al contenido real (con los rótulos ya medidos) para que se lea grande en cualquier pantalla. */
function encuadrar(raiz) {
  const svg = raiz.querySelector('.sala-red'), cont = svg?.querySelector('.sala-red-cont'); if (!cont) return;
  const b = cont.getBBox(); if (!b.width) return;
  const m = 34, caja = raiz.getBoundingClientRect(), prop = caja.width / Math.max(1, caja.height - 50);
  let w = b.width + m * 2, h = b.height + m * 2;
  // Si el panel es más alto que el plano, se agrega aire arriba y abajo en vez de achicarlo.
  if (w / h > prop) h = w / prop; else w = h * prop;
  svg.setAttribute('viewBox', `${(b.x + b.width / 2 - w / 2).toFixed(1)} ${(b.y + b.height / 2 - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
}
/** Un «tren» recorre la línea de la sucursal (o el anillo) cuando entra un mensaje. */
function tren(k, tipo) {
  const svg = $('#sala-mapa .sala-red'); if (!svg) return;
  const via = svg.querySelector(`#sala-via-${CSS.escape(k)}`);
  const est = svg.querySelector(`.sala-est[data-suc="${CSS.escape(k)}"]`); if (!est) return;
  const ns = 'http://www.w3.org/2000/svg', punto = document.createElementNS(ns, 'circle');
  punto.setAttribute('r', tipo === 'venta' ? 7 : 5); punto.setAttribute('class', 'sala-tren tk-' + tipo);
  svg.appendChild(punto);
  const dur = via ? 1600 : 900, t0 = performance.now();
  const m = est.transform.baseVal.consolidate()?.matrix, fin = m ? [m.e, m.f] : [HX, HY];
  const largo = via ? via.getTotalLength() : 0;
  const paso = t => {
    const k2 = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k2, 3);
    let x, y;
    if (via) { const p = via.getPointAtLength(e * largo); x = p.x; y = p.y; }
    else { const a0 = Math.atan2(fin[1] - HY, fin[0] - HX) + Math.PI * 1.2, a = a0 - e * Math.PI * 1.2; x = HX + RA * Math.cos(a); y = HY + RA * Math.sin(a); }
    punto.setAttribute('cx', x.toFixed(1)); punto.setAttribute('cy', y.toFixed(1));
    if (k2 < 1) requestAnimationFrame(paso); else punto.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).onfinish = () => punto.remove();
  };
  requestAnimationFrame(paso);
}
/* Los rótulos se miden después de dibujarse para que el fondo calce justo. */
function ajustarEtiquetas(raiz) {
  for (const e of $$('.sala-etiqueta', raiz)) {
    const n = e.querySelector('.sala-nombre'), d = e.querySelector('.sala-dato'), cl = e.querySelector('.sala-e-clima'), r = e.querySelector('.sala-e-fondo');
    const texto = Math.max(n.getComputedTextLength(), d.getComputedTextLength());
    const ancho = 14 + texto + (cl ? 92 : 14);
    n.setAttribute('x', 14); d.setAttribute('x', 14);
    if (cl) cl.setAttribute('transform', `translate(${(14 + texto + 12).toFixed(1)} 0)`);
    r.setAttribute('width', ancho.toFixed(1));
    if (e.dataset.izq === '1') e.setAttribute('transform', `translate(${(-ancho).toFixed(1)} 0)`);
  }
}

/* ---------- Paneles ---------- */
function kpis(d, lista) {
  const enEspera = lista.reduce((a, s) => a + s.espera, 0);
  const nuevos = lista.reduce((a, s) => a + s.nuevos, 0), ventas = lista.reduce((a, s) => a + s.ventas, 0);
  const monto = lista.reduce((a, s) => a + s.monto, 0);
  const pr = d.primeraRespuesta, tasa = pr.total ? Math.round(pr.n / pr.total * 100) : null;
  const enLinea = d.equipo.filter(u => u.enLinea).length, reciben = d.equipo.filter(u => u.enLinea && disp(u.disponibilidad).recibe).length;
  return { enEspera, nuevos, ventas, monto, tasa, enLinea, reciben, pr };
}
function htmlKpis(k, d) {
  const nivel = k.tasa == null ? '' : k.tasa >= 90 ? 'ok' : k.tasa >= 70 ? 'alerta' : 'mal';
  const C = 2 * Math.PI * 30;
  return `
  <div class="sala-kpi${k.enEspera > 5 ? ' alerta' : ''}" data-kpi="espera"><span class="sala-k-t">Clientes esperando</span>
    <b class="sala-k-v" data-n>${k.enEspera}</b><small>${k.enEspera ? 'Responder primero a los de más tiempo' : 'Nadie espera ahora'}</small></div>
  <div class="sala-kpi sala-kpi-tasa ${nivel}" data-kpi="tasa">
    <svg class="sala-anillo" viewBox="0 0 72 72" aria-hidden="true"><circle class="sala-a-fondo" cx="36" cy="36" r="30"/>
      <circle class="sala-a-valor" cx="36" cy="36" r="30" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - (k.tasa || 0) / 100)).toFixed(1)}"/></svg>
    <div><span class="sala-k-t">Tasa de respuesta</span><b class="sala-k-v">${k.tasa == null ? '—' : k.tasa + '%'}</b>
    <small>${k.pr.total ? `${k.pr.n} de ${k.pr.total} conversaciones de hoy` : 'Sin mensajes de clientes hoy'}</small></div></div>
  <div class="sala-kpi" data-kpi="resp"><span class="sala-k-t">Primera respuesta</span><b class="sala-k-v">${duracion(k.pr.mediana)}</b><small>Mediana de hoy</small></div>
  <div class="sala-kpi" data-kpi="nuevos"><span class="sala-k-t">Clientes nuevos hoy</span><b class="sala-k-v" data-n>${k.nuevos}</b><small>En todas las sucursales</small></div>
  <div class="sala-kpi sala-kpi-oro" data-kpi="ventas"><span class="sala-k-t">Ventas cerradas hoy</span><b class="sala-k-v" data-n>${k.ventas}</b><small>${gsCorto(k.monto)}</small></div>
  <div class="sala-kpi" data-kpi="linea"><span class="sala-k-t">Agentes en línea</span><b class="sala-k-v">${k.enLinea}<span class="sala-k-de">/${d.equipo.length}</span></b>
    <small>${k.reciben} ${k.reciben === 1 ? 'recibe' : 'reciben'} clientes ahora</small></div>`;
}
function htmlCola(d, total) {
  const items = d.cola.map(c => {
    const min = (Date.now() - new Date(c.desde)) / 60000;
    return `<li class="${min >= 30 ? 'tarde' : min >= 10 ? 'atento' : ''}"><span class="sala-c-reloj" data-desde="${esc(c.desde)}">${espera(c.desde)}</span>
      <span class="sala-c-nom">${esc(c.cliente)}</span>
      <span class="sala-c-meta">${esc(c.sucursal || 'Sin sucursal')} · ${c.agente ? esc(c.agente) : '<em>sin asignar</em>'}</span></li>`;
  }).join('');
  return `<h3 class="sala-sub">Esperando respuesta <span class="sala-cuenta">${total}</span></h3>
    ${items ? `<ol class="sala-cola">${items}</ol>` : '<p class="sala-vacio grande">Ningún cliente espera respuesta. Buen trabajo, equipo.</p>'}`;
}
function htmlAgentes(d) {
  const orden = [...d.equipo].sort((a, b) => Number(b.enLinea) - Number(a.enLinea)
    || Number(disp(b.disponibilidad).recibe) - Number(disp(a.disponibilidad).recibe) || b.respuestas - a.respuestas);
  return `<h3 class="sala-sub">Agentes</h3><ul class="sala-agentes">${orden.map(u => { const x = disp(u.disponibilidad);
    return `<li class="${u.enLinea ? 'en-linea' : 'fuera'}${x.recibe ? '' : ' pausa'}" data-uid="${esc(u.id)}">
      <span class="sala-a-av" style="--d:${x.c}">${u.foto ? `<img src="${esc(u.foto)}" alt="">` : esc(iniciales(u.nombre))}<i class="sala-a-punto" title="${u.enLinea ? 'Con el CRM abierto' : 'Sin conexión'}"></i></span>
      <span class="sala-a-nom">${esc(u.nombre)}<small>${u.enLinea ? esc(x.t) : 'Sin conexión'}</small></span>
      <span class="sala-a-num" title="Respuestas de hoy"><b>${u.respuestas}</b><small>resp.</small></span>
      <span class="sala-a-num" title="Negociaciones abiertas"><b>${u.carga}</b><small>abiertas</small></span></li>`; }).join('')
    || '<li class="sala-vacio">Sin agentes activos en tu equipo.</li>'}</ul>`;
}
function htmlRitmo(d) {
  const ahora = horaAsu();
  const desde = Math.min(7, ...d.ritmo.map(x => x.h)), hasta = Math.max(20, ahora, ...d.ritmo.map(x => x.h));
  const por = new Map(d.ritmo.map(x => [x.h, x])), horas = [];
  for (let h = desde; h <= hasta; h++) horas.push(por.get(h) || { h, entran: 0, responden: 0 });
  const max = Math.max(1, ...horas.map(x => Math.max(x.entran, x.responden)));
  const W = 600, H = 150, paso = W / horas.length, bw = Math.min(14, paso * .34);
  const y = v => H - v / max * (H - 8);
  const tot = horas.reduce((a, x) => ({ e: a.e + x.entran, r: a.r + x.responden }), { e: 0, r: 0 });
  return `<h3 class="sala-sub">Ritmo del día <span class="sala-ley"><i class="ley-in"></i>Entran ${tot.e}<i class="ley-out"></i>Respuestas ${tot.r}</span></h3>
    <svg class="sala-ritmo" viewBox="0 -4 ${W} ${H + 26}" preserveAspectRatio="none" role="img" aria-label="Mensajes que entran y respuestas por hora de hoy">
      <line class="rt-base" x1="0" x2="${W}" y1="${H}" y2="${H}"/>
      ${horas.map((x, i) => { const cx = i * paso + paso / 2, ah = x.h === ahora;
        return `<g class="${ah ? 'rt-ahora' : ''}" style="--i:${i}">${ah ? `<rect class="rt-fondo" x="${(i * paso + 1).toFixed(1)}" y="-4" width="${(paso - 2).toFixed(1)}" height="${H + 4}" rx="4"/>` : ''}
          <rect class="rt-in" x="${(cx - bw - 1).toFixed(1)}" y="${y(x.entran).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - y(x.entran)).toFixed(1)}" rx="2"><title>${x.h} h: entraron ${x.entran}</title></rect>
          <rect class="rt-out" x="${(cx + 1).toFixed(1)}" y="${y(x.responden).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - y(x.responden)).toFixed(1)}" rx="2"><title>${x.h} h: respuestas ${x.responden}</title></rect>
          ${i % 2 === 0 || ah ? `<text class="rt-eje" x="${cx.toFixed(1)}" y="${H + 19}" text-anchor="middle">${x.h}</text>` : ''}</g>`; }).join('')}
    </svg>`;
}
function htmlSucursales(lista) {
  const orden = [...lista].sort((a, b) => (b.nuevos + b.ventas * 3) - (a.nuevos + a.ventas * 3) || b.abiertas - a.abiertas);
  const max = Math.max(1, ...orden.map(s => s.nuevos));
  return `<h3 class="sala-sub">Sucursales hoy</h3><p class="sala-r-ley" aria-hidden="true"><span></span><span></span><span>Nuevos</span><span>Esperan</span><span>Ventas</span></p><ol class="sala-ranking">${orden.map(s => `
    <li data-suc="${esc(s.k)}"><span class="sala-r-nom">${esc(s.nombre)}</span>
      <span class="sala-r-barra"><i style="--p:${(s.nuevos / max * 100).toFixed(0)}%"></i></span>
      <span class="sala-r-num" title="Clientes nuevos hoy"><b>${s.nuevos}</b></span>
      <span class="sala-r-num${s.espera ? ' espera' : ''}" title="Esperando respuesta"><b>${s.espera}</b></span>
      <span class="sala-r-num${s.ventas ? ' oro' : ''}" title="Ventas cerradas hoy"><b>${s.ventas}</b></span></li>`).join('')}</ol>`;
}
const htmlMov = x => `<li class="tk-${x.tipo}"><i></i><b>${PULSOS[x.tipo].t}</b><span>${esc(x.sucursal || 'Sin sucursal')}</span><small>${reloj(x.ts)}</small></li>`;

/* Lista en movimiento: si no entra en el panel, sube sola en bucle continuo y muestra todos los casos.
   Se pausa al pasar el mouse o con el foco; con «reducir movimiento» queda con barra de desplazamiento. */
function desplazar(panel, sel) {
  const lista = panel?.querySelector(sel); if (!lista) return;
  const caja = document.createElement('div'); caja.className = 'sala-desliza';
  lista.replaceWith(caja); caja.appendChild(lista);
  requestAnimationFrame(() => {
    if (lista.scrollHeight <= caja.clientHeight + 2) return;
    if (menosMovimiento()) { caja.classList.add('con-barra'); return; }
    const copia = lista.cloneNode(true); copia.setAttribute('aria-hidden', 'true'); copia.classList.add('copia');
    copia.querySelectorAll('[data-uid]').forEach(el => el.removeAttribute('data-uid'));
    const pista = document.createElement('div'); pista.className = 'sala-pista';
    caja.appendChild(pista); pista.append(lista, copia);
    const filas = lista.children.length;
    pista.style.setProperty('--dur', Math.max(12, filas * 3.2) + 's');
    caja.classList.add('mueve');
  });
}

/* ---------- Pintado ---------- */
function pintar() {
  if (!E?.datos) return;
  const d = E.datos, lista = sucursalesConDatos(d), k = kpis(d, lista);
  const kp = $('#sala-kpis'), antes = E.kpis;
  kp.innerHTML = htmlKpis(k, d);
  if (!menosMovimiento()) $$('[data-kpi] [data-n]', kp).forEach(el => {
    const clave = el.closest('[data-kpi]').dataset.kpi, previo = antes?.[clave];
    if (previo == null || String(previo) !== el.textContent) correr(el);
  });
  E.kpis = { espera: String(k.enEspera), nuevos: String(k.nuevos), ventas: String(k.ventas) };
  // El mapa solo se redibuja si cambió algo (así no se reinician sus animaciones).
  const firma = JSON.stringify([lista.map(s => [s.k, s.espera, s.nuevos, s.abiertas]), d.calor, [...E.clima.values()]]);
  if (firma !== E.firmaMapa) { E.firmaMapa = firma; const m = $('#sala-mapa'); m.innerHTML = htmlMapa(lista); ajustarEtiquetas(m); encuadrar(m); }
  // Las listas se redibujan solo si cambió su contenido: así el desplazamiento no vuelve a empezar.
  const firmaCola = JSON.stringify(d.cola.map(c => [c.id, c.desde, c.agente])) + k.enEspera;
  if (firmaCola !== E.firmaCola) { E.firmaCola = firmaCola; $('#sala-cola').innerHTML = htmlCola(d, k.enEspera); desplazar($('#sala-cola'), '.sala-cola'); }
  const firmaEq = JSON.stringify(d.equipo.map(u => [u.id, u.enLinea, u.disponibilidad, u.respuestas, u.carga]));
  if (firmaEq !== E.firmaEq) { E.firmaEq = firmaEq; $('#sala-agentes').innerHTML = htmlAgentes(d); desplazar($('#sala-agentes'), '.sala-agentes'); }
  $('#sala-ritmo').innerHTML = htmlRitmo(d);
  $('#sala-sucursales').innerHTML = htmlSucursales(lista);
}

async function refrescar() {
  if (!E) return;
  try {
    E.datos = await get('/sala-control');
    if (!E) return;
    pintar();
    $('#sala-estado').textContent = `Actualizado ${reloj(new Date())}`;
    $('#sala').classList.remove('sin-conexion');
  } catch {
    if (!E) return;
    $('#sala-estado').textContent = 'Sin conexión con el CRM · reintentando';
    $('#sala').classList.add('sin-conexion');
  }
}
const refrescarPronto = () => { if (!E) return; clearTimeout(E.pronto); E.pronto = setTimeout(refrescar, 2500); };

async function cargarClima() {
  if (!E) return;
  try {
    const lista = await get('/sala-control/clima');
    if (!E) return;
    E.clima = new Map(lista.filter(c => c.temp != null).map(c => [norm(c.nombre), c]));
    E.climaLista = lista.filter(c => c.temp != null);
    E.firmaMapa = null; pintar(); girarClima(true);
  } catch { /* sin clima no se rompe nada */ }
}
/** El clima del encabezado recorre las ciudades de las sucursales. */
function girarClima(reiniciar = false) {
  const chip = $('#sala-clima'), l = E?.climaLista || [];
  if (!chip) return;
  if (!l.length) { chip.hidden = true; return; }
  chip.hidden = false;
  if (reiniciar) E.iClima = Math.max(0, l.findIndex(c => norm(c.nombre) === 'asuncion'));
  const c = l[E.iClima % l.length];
  chip.innerHTML = `${iconoClima(c.cod, esDeNoche())}<span class="sala-cl-t"><b>${Math.round(c.temp)}°</b><small>${esc(c.nombre)}</small></span>`;
  chip.setAttribute('aria-label', `Clima en ${c.nombre}: ${Math.round(c.temp)} grados`);
  if (!menosMovimiento() && !reiniciar) chip.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)' });
}

/** Estado de WhatsApp en el encabezado. */
export function estadoWASala(estado) {
  const chip = $('#sala-wa'); if (!chip) return;
  const x = ESTADO_WA[estado] || { t: estado ? 'WhatsApp sin conexión' : 'WhatsApp sin datos', c: estado ? 'mal' : '' };
  chip.className = 'sala-chip sala-wa ' + x.c;
  chip.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z"/></svg><span>${x.t}</span><i class="sala-wa-punto"></i>`;
}

/** Pulso en vivo desde el servidor: tinta en la sucursal, movimiento y destello del indicador. Sin datos del cliente. */
export function pulsoSala({ sucursal, tipo }) {
  if (!E || !PULSOS[tipo]) return;
  const mov = { sucursal, tipo, ts: new Date() };
  E.ticker.unshift(mov); E.ticker.length = Math.min(E.ticker.length, 12);
  const ul = $('#sala-mov');
  if (ul) {
    ul.querySelector('.sala-vacio')?.remove();
    ul.insertAdjacentHTML('afterbegin', htmlMov(mov));
    while (ul.children.length > 12) ul.lastElementChild.remove();
    if (!menosMovimiento()) ul.firstElementChild.animate([{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
  refrescarPronto();
  if (menosMovimiento()) return;
  const k = norm(sucursal);
  const kpi = { venta: 'ventas', nuevo: 'nuevos', mensaje: 'espera', respuesta: 'tasa' }[tipo];
  const kv = $(`[data-kpi="${kpi}"]`); if (kv) { kv.classList.remove('destella'); void kv.offsetWidth; kv.classList.add('destella'); }
  $(`.sala-ranking [data-suc="${CSS.escape(k)}"]`)?.animate([{ background: 'var(--sala-destello)' }, { background: 'transparent' }], { duration: 1600 });
  for (const nodo of $$(`.sala-pin[data-suc="${CSS.escape(k)}"]`)) {
    const ondas = nodo.querySelector('.sala-ondas');
    const vueltas = tipo === 'venta' ? 3 : tipo === 'nuevo' ? 2 : 1;
    for (let i = 0; i < vueltas; i++) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', 8); c.setAttribute('class', 'sala-onda tk-' + tipo); ondas.appendChild(c);
      const a = c.animate([{ r: 8, opacity: .95, strokeWidth: tipo === 'venta' ? 6 : 4 }, { r: tipo === 'venta' ? 70 : 50, opacity: 0, strokeWidth: .5 }],
        { duration: tipo === 'venta' ? 2400 : 1700, delay: i * 340, easing: 'cubic-bezier(.2,.7,.2,1)' });
      a.onfinish = () => c.remove();
    }
    nodo.querySelector('.sala-est-nodo')?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 520, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  }
  tren(k, tipo);
}
/** Un agente cambió su disponibilidad: actualizar pronto. */
export const cambioEquipo = () => refrescarPronto();

export function abrirSala() {
  if (E) return;
  document.body.classList.remove('nav-open');
  const raiz = document.createElement('div');
  raiz.id = 'sala'; raiz.dataset.tema = 'oscuro';
  raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-modal', 'true'); raiz.setAttribute('aria-labelledby', 'sala-titulo');
  raiz.innerHTML = `<header class="sala-top">
      <span class="logo-impar sala-logo" aria-hidden="true"><img src="/assets/impar-logo-color.png" alt=""><span class="logo-tinta"></span></span>
      <div class="sala-titulos"><h2 id="sala-titulo">Sala de control <span class="sala-vivo"><i></i>En vivo</span></h2><span id="sala-fecha"></span></div>
      <div class="sala-estados">
        <div class="sala-chip sala-clima" id="sala-clima" hidden role="img"></div>
        <div class="sala-chip sala-wa" id="sala-wa" role="status"></div>
      </div>
      <div class="sala-hora" id="sala-hora"></div>
      <div class="sala-ctrl">
        <button class="sala-btn" id="sala-pantalla" title="Pantalla completa (F)" aria-label="Pantalla completa">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg></button>
        <button class="sala-btn" id="sala-cerrar" title="Cerrar la sala (Esc)" aria-label="Cerrar la sala de control">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg></button>
      </div></header>
    <div class="sala-kpis" id="sala-kpis"><div class="sala-kpi"><span class="sala-k-t">Cargando la sala…</span></div></div>
    <main class="sala-cuerpo">
      <section class="sala-panel sala-mapa" id="sala-mapa" aria-label="Mapa de sucursales"></section>
      <section class="sala-panel sala-p-cola" id="sala-cola" aria-label="Clientes esperando respuesta"></section>
      <section class="sala-panel sala-p-ritmo" id="sala-ritmo" aria-label="Ritmo del día"></section>
      <section class="sala-panel sala-p-agentes" id="sala-agentes" aria-label="Agentes"></section>
      <section class="sala-panel sala-p-suc" id="sala-sucursales" aria-label="Sucursales hoy"></section>
    </main>
    <footer class="sala-pie"><span class="sala-pie-t">Movimientos</span>
      <ul class="sala-mov" id="sala-mov" aria-live="off"><li class="sala-vacio">Los mensajes, clientes nuevos y ventas aparecen acá en cuanto ocurren.</li></ul>
      <span id="sala-estado">Conectando…</span></footer>`;
  document.body.appendChild(raiz);
  document.body.classList.add('sala-abierta');
  E = { datos: null, ticker: [], clima: new Map(), climaLista: [], iClima: 0, foco: document.activeElement };
  const tic = () => {
    const d = new Date(); $('#sala-hora').textContent = reloj(d); $('#sala-fecha').textContent = fechaLarga(d);
    $$('.sala-c-reloj').forEach(el => {
      el.textContent = espera(el.dataset.desde);
      const min = (Date.now() - new Date(el.dataset.desde)) / 60000, li = el.parentElement;
      li.classList.toggle('tarde', min >= 30); li.classList.toggle('atento', min >= 10 && min < 30);
    });
  };
  tic(); E.reloj = setInterval(tic, 1000);
  E.refresco = setInterval(refrescar, REFRESCO_MS);
  E.climaT = setInterval(cargarClima, CLIMA_MS);
  E.giro = setInterval(() => { if (E) { E.iClima++; girarClima(); } }, 7000);
  $('#sala-pantalla').onclick = pantallaCompleta;
  $('#sala-cerrar').onclick = cerrarSala;
  E.teclas = e => {
    if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); cerrarSala(); }
    else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) pantallaCompleta();
  };
  document.addEventListener('keydown', E.teclas);
  // Al cambiar el tamaño (pantalla completa, girar el celular) se reencuadra el plano y se recalcula qué lista se mueve.
  E.medida = () => { clearTimeout(E.medidaT); E.medidaT = setTimeout(() => {
    if (!E) return; const m = $('#sala-mapa'); if (m) encuadrar(m);
    E.firmaCola = E.firmaEq = null; pintar(); }, 250); };
  addEventListener('resize', E.medida);
  estadoWASala(null);
  get('/canales/estado-whatsapp').then(r => estadoWASala(r.estado)).catch(() => {});
  refrescar(); cargarClima();
  $('#sala-cerrar').focus({ preventScroll: true });
}

function pantallaCompleta() {
  const raiz = $('#sala'); if (!raiz) return;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else raiz.requestFullscreen?.().catch(() => {});
}

export function cerrarSala() {
  if (!E) return;
  for (const t of ['reloj', 'refresco', 'climaT', 'giro']) clearInterval(E[t]);
  clearTimeout(E.pronto); clearTimeout(E.medidaT);
  document.removeEventListener('keydown', E.teclas);
  removeEventListener('resize', E.medida);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  const foco = E.foco; E = null;
  $('#sala')?.remove(); document.body.classList.remove('sala-abierta');
  foco?.focus?.({ preventScroll: true });
}
export const salaAbierta = () => !!E;
