/* IMPAR · Sala de control en vivo — todo en una sola pantalla.
   Mapa real de Paraguay con las sucursales, calor de clientes y clima por ciudad; cola con relojes,
   agentes en línea, tasa de respuesta, ritmo del día y movimientos en vivo. Pensada para una TV. */
import { $, $$, esc, get, iniciales, DISPONIBILIDAD } from './core.js';
import { menosMovimiento, correr } from './animaciones.js';
import { iconoClima, esDeNoche } from './clima-animado.js';
import { CONTORNOS, RIO_PARAGUAY, CIUDADES_REFERENCIA } from './mapa-paraguay.js';

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
const VECINOS = ['argentina', 'bolivia', 'brasil'].map(k => ({ k, d: CONTORNOS[k].map(r => ruta(r, true)).join('') }));

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
function pin(s, x, y, escala = 1) {
  const izq = s._izq;
  return `<g class="sala-pin${s.espera ? ' con-espera' : ''}" data-suc="${esc(s.k)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${escala})">
    <g class="sala-ondas"></g>
    ${s.espera ? '<circle class="sala-radar" r="10"/>' : ''}
    <ellipse class="sala-sombra" rx="9" ry="3.5"/>
    <path class="sala-gota" d="M0 0C-3-7-13-13-13-25a13 13 0 1 1 26 0C13-13 3-7 0 0z"/>
    <circle class="sala-ojo" cy="-25" r="5.5"/>
    ${s.sinEtiqueta ? '' : `<g transform="translate(${izq ? -20 : 20} -46) scale(${(1 / escala).toFixed(3)})">${etiqueta(s, izq)}</g>`}</g>`;
}
function calorSVG(zonas, max, transformar, factor = 1) {
  return zonas.map(z => {
    const p = transformar(z); if (!p) return '';
    const f = Math.sqrt(z.n / max);
    return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${((16 + 46 * f) * factor).toFixed(1)}" fill="url(#sala-calor)" opacity="${(.3 + .6 * f).toFixed(2)}"/>`;
  }).join('');
}
function htmlMapa(lista, calor) {
  const zonas = calor?.zonas || [], max = Math.max(1, ...zonas.map(z => z.n));
  const grupos = agrupar(lista);
  let pins = '', lupa = '', guia = '';
  for (const g of grupos) {
    if (g.length === 1) { const [x, y] = px([g[0].lon, g[0].lat]); g[0]._izq = x > ANCHO * .58; pins += pin(g[0], x, y, 1.35); continue; }
    // Detalle de Gran Asunción: tarjeta en la esquina libre del mapa, con mini mapa, su calor y rótulos en columna.
    const c = { lat: g.reduce((a, s) => a + s.lat, 0) / g.length, lon: g.reduce((a, s) => a + s.lon, 0) / g.length };
    const [cx, cy] = px([c.lon, c.lat]);
    const TX = 12, TY = 450, TW = 448, TH = 300, MX = 78, MY = 172, R = 60;
    const lejos = Math.max(.02, ...g.map(s => Math.hypot((s.lon - c.lon) * COS, s.lat - c.lat)));
    const z = (R - 16) / lejos;
    const dentro = p => { const x = (p.lon - c.lon) * COS * z, y = (c.lat - p.lat) * z; return Math.hypot(x, y) < R + 30 ? [x, y] : null; };
    const nombre = g.some(s => s.k === 'asuncion') ? 'Gran Asunción' : `${g[0].nombre} y alrededores`;
    const orden = g.map(s => ({ s, x: (s.lon - c.lon) * COS * z, y: (c.lat - s.lat) * z })).sort((a, b) => a.y - b.y);
    const paso = Math.min(78, (TH - 70) / orden.length), y0 = 60 + (TH - 60 - paso * orden.length) / 2;
    guia = `<circle class="sala-zona" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="16"/>
      <path class="sala-guia" d="M${(cx - 12).toFixed(1)} ${(cy + 10).toFixed(1)}L${(TX + TW - 30).toFixed(1)} ${TY}"/>`;
    lupa = `<g class="sala-detalle" transform="translate(${TX} ${TY})">
      <rect class="sala-lupa" width="${TW}" height="${TH}" rx="16"/>
      <text class="sala-region lupa-t" x="20" y="34">${nombre}</text>
      <clipPath id="sala-lupa-clip"><circle cx="${MX}" cy="${MY}" r="${R + 30}"/></clipPath>
      <g clip-path="url(#sala-lupa-clip)"><circle class="sala-mini" cx="${MX}" cy="${MY}" r="${R + 30}"/>
        <g class="sala-calor" transform="translate(${MX} ${MY})">${calorSVG(zonas, max, dentro, .75)}</g></g>
      ${orden.map((o, i) => { const ly = y0 + i * paso; o.s._izq = false;
        return `<path class="sala-lider" d="M${(MX + o.x).toFixed(1)} ${(MY + o.y - 22).toFixed(1)}C${(MX + o.x + 50).toFixed(1)} ${(MY + o.y - 22).toFixed(1)} 140 ${(ly + 29).toFixed(1)} 162 ${(ly + 29).toFixed(1)}"/>
          <g transform="translate(162 ${ly.toFixed(1)})">${etiqueta(o.s, false)}</g>`; }).join('')}
      ${orden.map(o => pin({ ...o.s, sinEtiqueta: true }, MX + o.x, MY + o.y, .9)).join('')}</g>`;
  }
  const refs = CIUDADES_REFERENCIA.filter(([n]) => !lista.some(s => norm(s.nombre) === norm(n)))
    .map(([n, lon, lat]) => { const [x, y] = px([lon, lat]); return `<g class="sala-ref" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle r="3.2"/><text x="7" y="5">${esc(n)}</text></g>`; }).join('');
  const [ax, ay] = px([-57.7, -27.82]), [bx, by] = px([-55.1, -20.0]), [ox, oy] = px([-62.6, -19.4]);
  return `<svg class="sala-svg" viewBox="0 0 ${ANCHO.toFixed(0)} ${ALTO.toFixed(0)}" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Mapa de Paraguay con las sucursales de IMPAR, clientes en espera, clima por ciudad y zonas con más clientes">
    <defs>
      <radialGradient id="sala-calor"><stop offset="0" stop-color="#F3C55B" stop-opacity=".95"/><stop offset=".35" stop-color="#E39A3A" stop-opacity=".6"/>
        <stop offset=".7" stop-color="#7CC24F" stop-opacity=".25"/><stop offset="1" stop-color="#7CC24F" stop-opacity="0"/></radialGradient>
      <filter id="sala-luz" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <clipPath id="sala-pais-clip"><path d="${PAIS}"/></clipPath>
    </defs>
    <g class="sala-vecinos">${VECINOS.map(v => `<path class="sala-vecino" d="${v.d}"/>`).join('')}
      <text class="sala-pais-nom" x="${ax.toFixed(0)}" y="${ay.toFixed(0)}">Argentina</text>
      <text class="sala-pais-nom" x="${bx.toFixed(0)}" y="${by.toFixed(0)}">Brasil</text>
      <text class="sala-pais-nom" x="${ox.toFixed(0)}" y="${oy.toFixed(0)}">Bolivia</text></g>
    <path class="sala-pais-luz" d="${PAIS}" filter="url(#sala-luz)"/>
    <path class="sala-pais" d="${PAIS}"/>
    <g clip-path="url(#sala-pais-clip)" class="sala-calor">${calorSVG(zonas, max, z => px([z.lon, z.lat]))}</g>
    <path class="sala-rio" d="${ruta(RIO_PARAGUAY)}"/><path class="sala-rio-flujo" d="${ruta(RIO_PARAGUAY)}"/>
    <text class="sala-region" x="${px([-60.7, -22.2])[0].toFixed(0)}" y="${px([-60.7, -22.2])[1].toFixed(0)}">Chaco</text>
    ${refs}${guia}${pins}${lupa}
  </svg>
  <div class="sala-leyenda-mapa">
    <span class="sala-l-grad" aria-hidden="true"></span><span>Menos</span><span>Más clientes</span>
    <small>${(calor?.ubicados || 0).toLocaleString('es-PY')} clientes ubicados · últimos 90 días</small>
  </div>`;
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
  if (firma !== E.firmaMapa) { E.firmaMapa = firma; const m = $('#sala-mapa'); m.innerHTML = htmlMapa(lista, d.calor); ajustarEtiquetas(m); }
  $('#sala-cola').innerHTML = htmlCola(d, k.enEspera);
  $('#sala-agentes').innerHTML = htmlAgentes(d);
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
    const gota = nodo.querySelector('.sala-gota');
    gota?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }], { duration: 520, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  }
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
  clearTimeout(E.pronto);
  document.removeEventListener('keydown', E.teclas);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  const foco = E.foco; E = null;
  $('#sala')?.remove(); document.body.classList.remove('sala-abierta');
  foco?.focus?.({ preventScroll: true });
}
export const salaAbierta = () => !!E;
