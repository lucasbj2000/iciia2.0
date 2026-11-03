/* IMPAR · Sala de control en vivo.
   Pantalla completa para gerencia o una TV de la oficina: mapa de sucursales con pulsos de
   tinta, clientes esperando, equipo y ritmo del día. Rota sola cada 30 s. */
import { $, $$, S, esc, get, iniciales, DISPONIBILIDAD } from './core.js';
import { menosMovimiento, correr } from './animaciones.js';

const ROTA_MS = 30000, REFRESCO_MS = 45000;
const VISTAS = [
  { id: 'mapa', t: 'Mapa de sucursales', b: 'Mapa' },
  { id: 'cola', t: 'Clientes esperando y equipo', b: 'Cola y equipo' },
  { id: 'ritmo', t: 'Ritmo del día', b: 'Ritmo' }
];
const PULSOS = {
  nuevo: { t: 'Cliente nuevo', c: 'var(--sala-verde)' },
  mensaje: { t: 'Mensaje de cliente', c: 'var(--sala-verde)' },
  respuesta: { t: 'Respuesta del equipo', c: 'var(--sala-tinta)' },
  venta: { t: 'Venta cerrada', c: 'var(--sala-oro)' }
};

/* ---------- Geografía: silueta esquemática de Paraguay (lon, lat) ---------- */
const PARAGUAY = [[-62.65,-22.23],[-62.27,-21.06],[-61.74,-19.63],[-60.6,-19.45],[-59.1,-19.29],[-58.16,-20.17],[-58.0,-20.7],
  [-57.86,-21.5],[-57.92,-22.09],[-57.3,-22.2],[-56.6,-22.25],[-56.0,-22.25],[-55.8,-22.4],[-55.7,-22.6],[-55.6,-23.0],
  [-55.5,-23.6],[-55.4,-24.0],[-54.9,-23.95],[-54.3,-24.05],[-54.4,-24.6],[-54.6,-25.6],[-54.7,-26.4],[-55.4,-27.0],
  [-55.9,-27.35],[-56.5,-27.5],[-57.3,-27.45],[-58.0,-27.3],[-58.6,-27.3],[-58.3,-26.9],[-58.1,-26.3],[-57.8,-25.7],
  [-57.6,-25.3],[-58.2,-24.95],[-58.8,-24.75],[-59.6,-24.3],[-60.4,-23.9],[-61.2,-23.3],[-62.0,-22.6]];
const RIO = [[-58.16,-20.17],[-58.0,-20.7],[-57.86,-21.5],[-57.92,-22.09],[-57.9,-22.6],[-57.6,-23.3],[-57.5,-24.0],[-57.55,-24.8],
  [-57.6,-25.3],[-57.8,-25.7],[-58.1,-26.3],[-58.3,-26.9],[-58.6,-27.3]];
const LON0 = -62.9, LAT0 = -19.05, ESC = 92, COS = Math.cos(23.4 * Math.PI / 180);
const px = ([lon, lat]) => [(lon - LON0) * ESC * COS, (LAT0 - lat) * ESC];
const ruta = pts => pts.map((p, i) => (i ? 'L' : 'M') + px(p).map(v => v.toFixed(1)).join(' ')).join('') ;
const ANCHO = 8.6 * ESC * COS, ALTO = 8.75 * ESC;

const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^impar\s+/, '').trim();
const km = (a, b) => { const r = x => x * Math.PI / 180, dl = r(b.lat - a.lat), dn = r(b.lon - a.lon);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };

/* ---------- Estado ---------- */
let E = null; // { datos, vista, pausa, timers, ticker[] }

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

/* ---------- Datos derivados ---------- */
function sucursalesConDatos(d) {
  const por = new Map(d.porSucursal.map(x => [norm(x.sucursal), x]));
  const usadas = new Set();
  const lista = d.sucursales.map(s => {
    const k = norm(s.nombre), x = por.get(k) || {}; usadas.add(k);
    return { nombre: s.nombre, lat: s.lat, lon: s.lon, abiertas: x.abiertas || 0, espera: x.espera || 0,
      nuevos: x.nuevos || 0, ventas: x.ventas || 0, monto: x.monto || 0 };
  });
  const resto = d.porSucursal.filter(x => !usadas.has(norm(x.sucursal)));
  if (resto.length) lista.push(resto.reduce((a, x) => ({ ...a, abiertas: a.abiertas + x.abiertas, espera: a.espera + x.espera,
    nuevos: a.nuevos + x.nuevos, ventas: a.ventas + x.ventas, monto: a.monto + x.monto }),
    { nombre: 'Sin sucursal', sin: true, abiertas: 0, espera: 0, nuevos: 0, ventas: 0, monto: 0 }));
  return lista;
}
/** Sucursales a menos de 25 km entre sí se ven juntas en el recuadro ampliado. */
function agrupar(lista) {
  const ub = lista.filter(s => s.lat != null && s.lon != null);
  const grupos = [];
  for (const s of ub) {
    const g = grupos.find(g => g.some(o => km(o, s) < 25));
    if (g) g.push(s); else grupos.push([s]);
  }
  return grupos;
}

/* ---------- Pintado ---------- */
function kpis(d, lista) {
  const enEspera = lista.reduce((a, s) => a + s.espera, 0);
  const nuevos = lista.reduce((a, s) => a + s.nuevos, 0), ventas = lista.reduce((a, s) => a + s.ventas, 0);
  const monto = lista.reduce((a, s) => a + s.monto, 0);
  const recibe = new Set(DISPONIBILIDAD.filter(x => x.recibe).map(x => x.id));
  const activos = d.equipo.filter(u => recibe.has(u.disponibilidad)).length;
  return [
    { k: 'espera', t: 'Clientes esperando', v: enEspera, nota: enEspera ? 'Responder primero a los de más tiempo' : 'Nadie espera ahora', alerta: enEspera > 5 },
    { k: 'resp', t: 'Primera respuesta (mediana de hoy)', v: duracion(d.primeraRespuesta.mediana), nota: `${d.primeraRespuesta.n} conversaciones medidas`, texto: true },
    { k: 'nuevos', t: 'Clientes nuevos hoy', v: nuevos },
    { k: 'ventas', t: 'Ventas cerradas hoy', v: ventas, nota: gsCorto(monto) },
    { k: 'equipo', t: 'Equipo recibiendo clientes', v: `${activos}/${d.equipo.length}`, texto: true }
  ];
}

function htmlMapa(lista) {
  const grupos = agrupar(lista);
  const maxA = Math.max(1, ...lista.map(s => s.abiertas));
  const radio = s => 7 + 13 * Math.sqrt(s.abiertas / maxA);
  const nodo = (s, x, y, chico = false) => {
    const r = radio(s) * (chico ? .85 : 1);
    // Cerca del borde este (o a la derecha en el recuadro), el rótulo va a la izquierda del punto.
    const izq = chico ? x < 0 : x > ANCHO * .6, lx = izq ? -(r + 8) : r + 8, ancla = izq ? ' text-anchor="end"' : '';
    return `<g class="sala-nodo${s.espera ? ' con-espera' : ''}" data-suc="${esc(norm(s.nombre))}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <circle class="sala-halo" r="${(r + 9).toFixed(1)}"/><circle class="sala-punto" r="${r.toFixed(1)}"/>
      <g class="sala-ondas"></g>
      <text class="sala-nombre" x="${lx.toFixed(1)}" y="-2"${ancla}>${esc(s.nombre)}</text>
      <text class="sala-dato" x="${lx.toFixed(1)}" y="20"${ancla}>${s.espera ? `${s.espera} ${s.espera === 1 ? 'espera' : 'esperan'}` : `${s.abiertas} abiertas`}</text></g>`;
  };
  let svg = `<path class="sala-pais" d="${ruta(PARAGUAY)}Z"/><path class="sala-rio" d="${ruta(RIO)}"/>
    <text class="sala-region" x="${px([-61.2, -21.7])[0]}" y="${px([-61.2, -21.7])[1]}">Chaco</text>
    <text class="sala-region" x="${px([-56.7, -26.35])[0]}" y="${px([-56.7, -26.35])[1]}">Región Oriental</text>`;
  let recuadro = '';
  for (const g of grupos) {
    if (g.length === 1) { const [x, y] = px([g[0].lon, g[0].lat]); svg += nodo(g[0], x, y); continue; }
    // Recuadro ampliado para la zona con varias sucursales juntas (Gran Asunción).
    const c = { lat: g.reduce((a, s) => a + s.lat, 0) / g.length, lon: g.reduce((a, s) => a + s.lon, 0) / g.length };
    const [cx, cy] = px([c.lon, c.lat]);
    const [rx, ry] = px([-61.1, -25.55]), R = 140;
    const lejos = Math.max(.02, ...g.map(s => Math.hypot((s.lon - c.lon) * COS, s.lat - c.lat)));
    const z = (R - 34) / lejos;
    const nombreGrupo = g.some(s => norm(s.nombre) === 'asuncion') ? 'Gran Asunción' : `${g[0].nombre} y alrededores`;
    svg += `<circle class="sala-zona" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="12"/>
      <path class="sala-guia" d="M${(cx - 10).toFixed(1)} ${(cy + 6).toFixed(1)}L${(rx + R * .72).toFixed(1)} ${(ry - R * .7).toFixed(1)}"/>`;
    recuadro += `<g class="sala-recuadro" transform="translate(${rx.toFixed(1)} ${ry.toFixed(1)})">
      <circle class="sala-lupa" r="${R}"/><text class="sala-region" y="${-R - 12}" text-anchor="middle">${nombreGrupo}</text>
      ${g.map(s => nodo(s, (s.lon - c.lon) * COS * z, (c.lat - s.lat) * z, true)).join('')}</g>`;
  }
  return `<svg class="sala-svg" viewBox="-40 -30 ${(ANCHO + 80).toFixed(0)} ${(ALTO + 60).toFixed(0)}" role="img"
    aria-label="Mapa de sucursales de IMPAR con clientes abiertos y en espera">${svg}${recuadro}</svg>`;
}

function htmlRanking(lista) {
  const orden = [...lista].sort((a, b) => (b.nuevos + b.ventas * 3) - (a.nuevos + a.ventas * 3) || b.abiertas - a.abiertas);
  const max = Math.max(1, ...orden.map(s => s.nuevos));
  return `<h3 class="sala-sub">Hoy por sucursal</h3><ol class="sala-ranking">${orden.map(s => `
    <li data-suc="${esc(norm(s.nombre))}"><span class="sala-r-nom">${esc(s.nombre)}</span>
      <span class="sala-r-barra"><i style="--p:${(s.nuevos / max * 100).toFixed(0)}%"></i></span>
      <span class="sala-r-num"><b>${s.nuevos}</b> nuevos</span>
      <span class="sala-r-num${s.ventas ? ' oro' : ''}"><b>${s.ventas}</b> ${s.ventas === 1 ? 'venta' : 'ventas'}</span></li>`).join('')}</ol>`;
}

function htmlTicker() {
  const t = E.ticker;
  return `<h3 class="sala-sub">Últimos movimientos</h3>${t.length ? `<ul class="sala-ticker">${t.map(x => `
    <li class="tk-${x.tipo}"><i></i><span>${PULSOS[x.tipo].t}</span><small>${esc(x.sucursal || 'Sin sucursal')} · ${reloj(x.ts)}</small></li>`).join('')}</ul>`
    : '<p class="sala-vacio">Los movimientos aparecen acá en cuanto entran mensajes o se cierran ventas.</p>'}`;
}

function htmlCola(d) {
  const lista = d.cola.length ? `<ol class="sala-cola">${d.cola.map(c => {
    const min = (Date.now() - new Date(c.desde)) / 60000;
    return `<li class="${min >= 30 ? 'tarde' : min >= 10 ? 'atento' : ''}"><span class="sala-c-reloj" data-desde="${esc(c.desde)}">${espera(c.desde)}</span>
      <span class="sala-c-nom">${esc(c.cliente)}</span>
      <span class="sala-c-meta">${esc(c.sucursal || 'Sin sucursal')} · ${c.agente ? esc(c.agente) : '<em>sin asignar</em>'}</span></li>`; }).join('')}</ol>`
    : '<p class="sala-vacio grande">Ningún cliente está esperando respuesta. Buen trabajo, equipo.</p>';
  const disp = id => DISPONIBILIDAD.find(x => x.id === id) || DISPONIBILIDAD[DISPONIBILIDAD.length - 1];
  const equipo = [...d.equipo].sort((a, b) => Number(disp(b.disponibilidad).recibe) - Number(disp(a.disponibilidad).recibe) || b.respuestas - a.respuestas);
  return `<section class="sala-panel"><h3 class="sala-sub">Esperando respuesta · los de más tiempo primero</h3>${lista}</section>
    <section class="sala-panel"><h3 class="sala-sub">Equipo ahora</h3><ul class="sala-equipo">${equipo.map(u => { const x = disp(u.disponibilidad);
      return `<li class="${x.recibe ? '' : 'pausa'}"><span class="sala-e-av" style="--d:${x.c}">${u.foto ? `<img src="${esc(u.foto)}" alt="">` : esc(iniciales(u.nombre))}</span>
        <span class="sala-e-nom">${esc(u.nombre)}<small>${esc(x.t)}${u.sucursal ? ' · ' + esc(u.sucursal) : ''}</small></span>
        <span class="sala-e-num"><b>${u.respuestas}</b> respuestas</span><span class="sala-e-num"><b>${u.carga}</b> abiertas</span></li>`; }).join('')
      || '<li class="sala-vacio">Sin agentes activos en tu equipo.</li>'}</ul></section>`;
}

function htmlRitmo(d) {
  const ahora = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Asuncion' }));
  const desde = Math.min(7, ...d.ritmo.map(x => x.h)), hasta = Math.max(20, ahora, ...d.ritmo.map(x => x.h));
  const por = new Map(d.ritmo.map(x => [x.h, x])), horas = [];
  for (let h = desde; h <= hasta; h++) horas.push(por.get(h) || { h, entran: 0, responden: 0 });
  const max = Math.max(1, ...horas.map(x => Math.max(x.entran, x.responden)));
  const W = 960, H = 340, paso = W / horas.length, bw = Math.min(26, paso * .32);
  const y = v => H - v / max * (H - 24);
  const marcas = [0, .5, 1].map(f => Math.round(max * f));
  const total = horas.reduce((a, x) => ({ e: a.e + x.entran, r: a.r + x.responden }), { e: 0, r: 0 });
  return `<section class="sala-panel ancho"><h3 class="sala-sub">Mensajes por hora · hoy</h3>
    <p class="sala-leyenda"><span class="ley-in"></span>Entran de clientes <b>${total.e}</b><span class="ley-out"></span>Respuestas del equipo <b>${total.r}</b></p>
    <svg class="sala-ritmo" viewBox="-40 -10 ${W + 50} ${H + 46}" role="img" aria-label="Mensajes que entran y respuestas del equipo por hora de hoy">
      ${marcas.map(v => `<line class="rt-grilla" x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="rt-eje" x="-10" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}
      ${horas.map((x, i) => { const cx = i * paso + paso / 2;
        return `<g class="${x.h === ahora ? 'rt-ahora' : ''}">${x.h === ahora ? `<rect class="rt-fondo" x="${(i * paso + 2).toFixed(1)}" y="0" width="${(paso - 4).toFixed(1)}" height="${H}" rx="6"/>` : ''}
          <rect class="rt-in" x="${(cx - bw - 1).toFixed(1)}" y="${y(x.entran).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - y(x.entran)).toFixed(1)}" rx="3"><title>${x.h} h: ${x.entran} mensajes entraron</title></rect>
          <rect class="rt-out" x="${(cx + 1).toFixed(1)}" y="${y(x.responden).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - y(x.responden)).toFixed(1)}" rx="3"><title>${x.h} h: ${x.responden} respuestas</title></rect>
          <text class="rt-eje" x="${cx.toFixed(1)}" y="${H + 22}" text-anchor="middle">${x.h}${x.h === ahora ? ' · ahora' : ''}</text></g>`; }).join('')}
    </svg></section>`;
}

function pintar() {
  if (!E?.datos) return;
  const d = E.datos, lista = sucursalesConDatos(d), raiz = $('#sala');
  $('#sala-kpis').innerHTML = kpis(d, lista).map(k => `<div class="sala-kpi${k.alerta ? ' alerta' : ''}" data-kpi="${k.k}">
    <span class="sala-k-t">${k.t}</span><b class="sala-k-v"${k.texto ? '' : ` data-n="${k.v}"`}>${esc(String(k.v))}</b>${k.nota ? `<small>${esc(k.nota)}</small>` : ''}</div>`).join('');
  const v = VISTAS[E.vista].id, cuerpo = $('#sala-cuerpo');
  cuerpo.dataset.vista = v;
  cuerpo.innerHTML = v === 'mapa'
    ? `<section class="sala-panel sala-mapa">${htmlMapa(lista)}</section><section class="sala-panel sala-lado">${htmlRanking(lista)}<div id="sala-tk">${htmlTicker()}</div></section>`
    : v === 'cola' ? htmlCola(d) : htmlRitmo(d);
  $$('[data-sala-ir]', raiz).forEach(b => b.setAttribute('aria-current', String(Number(b.dataset.salaIr) === E.vista)));
  $('#sala-vista-t').textContent = VISTAS[E.vista].t;
}

async function refrescar() {
  if (!E) return;
  try { E.datos = await get('/sala-control'); E.error = false; pintar(); $('#sala-estado').textContent = `Actualizado ${reloj(new Date())}`; }
  catch (e) { E.error = true; $('#sala-estado').textContent = 'Sin conexión con el CRM · reintentando'; }
}
const refrescarPronto = () => { clearTimeout(E?.pronto); if (E) E.pronto = setTimeout(refrescar, 2500); };

function irA(i) {
  if (!E) return;
  const n = (i + VISTAS.length) % VISTAS.length, cuerpo = $('#sala-cuerpo');
  const cambiar = () => { E.vista = n; pintar(); };
  if (!menosMovimiento() && cuerpo) {
    cambiar();
    cuerpo.animate([{ clipPath: 'inset(0 0 0 100%)', opacity: .5 }, { clipPath: 'inset(0)', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.2,.7,.2,1)' });
  } else cambiar();
  programarRotacion();
}
function programarRotacion() {
  clearTimeout(E.rota);
  const barra = $('#sala-progreso');
  barra.classList.remove('corre'); void barra.offsetWidth;
  if (E.pausa) { $('#sala-pausa').setAttribute('aria-pressed', 'true'); $('#sala-pausa').title = 'Reanudar la rotación'; return; }
  $('#sala-pausa').setAttribute('aria-pressed', 'false'); $('#sala-pausa').title = 'Pausar la rotación';
  barra.classList.add('corre');
  E.rota = setTimeout(() => irA(E.vista + 1), ROTA_MS);
}

/** Pulso en vivo: tinta que se expande desde la sucursal. Sin datos del cliente. */
export function pulsoSala({ sucursal, tipo }) {
  if (!E || !PULSOS[tipo]) return;
  E.ticker.unshift({ sucursal, tipo, ts: new Date() });
  E.ticker.length = Math.min(E.ticker.length, 6);
  const tk = $('#sala-tk'); if (tk) tk.innerHTML = htmlTicker();
  refrescarPronto();
  const k = norm(sucursal);
  const fila = $(`.sala-ranking [data-suc="${CSS.escape(k)}"]`);
  if (fila && !menosMovimiento()) fila.animate([{ background: 'var(--sala-destello)' }, { background: 'transparent' }], { duration: 1600 });
  if (tipo === 'venta') { const kv = $('[data-kpi="ventas"]'); kv?.classList.remove('festeja'); void kv?.offsetWidth; kv?.classList.add('festeja'); }
  const nodo = $(`.sala-nodo[data-suc="${CSS.escape(k)}"]`);
  if (!nodo || menosMovimiento()) return;
  const ondas = nodo.querySelector('.sala-ondas'), r = Number(nodo.querySelector('.sala-punto').getAttribute('r'));
  const vueltas = tipo === 'venta' ? 3 : tipo === 'nuevo' ? 2 : 1;
  for (let i = 0; i < vueltas; i++) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('r', r); c.setAttribute('class', 'sala-onda tk-' + tipo);
    ondas.appendChild(c);
    const a = c.animate([{ r: r, opacity: .9, strokeWidth: tipo === 'venta' ? 5 : 3 }, { r: r * (tipo === 'venta' ? 5 : 3.6), opacity: 0, strokeWidth: .5 }],
      { duration: tipo === 'venta' ? 2200 : 1600, delay: i * 320, easing: 'cubic-bezier(.2,.7,.2,1)' });
    a.onfinish = () => c.remove();
  }
  nodo.classList.remove('late'); void nodo.getBoundingClientRect(); nodo.classList.add('late');
}

export function abrirSala() {
  if (E) return;
  document.body.classList.remove('nav-open');
  const raiz = document.createElement('div');
  raiz.id = 'sala'; raiz.dataset.tema = 'oscuro';
  raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-modal', 'true'); raiz.setAttribute('aria-labelledby', 'sala-titulo');
  raiz.innerHTML = `<header class="sala-top">
      <span class="logo-impar sala-logo" aria-hidden="true"><img src="/assets/impar-logo-color.png" alt=""><span class="logo-tinta"></span></span>
      <div class="sala-titulos"><h2 id="sala-titulo">Sala de control</h2><span id="sala-fecha"></span></div>
      <div class="sala-hora" id="sala-hora" aria-live="off"></div>
      <nav class="sala-ctrl" aria-label="Vistas de la sala">
        ${VISTAS.map((v, i) => `<button class="sala-btn sala-vista-btn" data-sala-ir="${i}" title="${v.t} (tecla ${i + 1})">${v.b}</button>`).join('')}
        <button class="sala-btn" id="sala-pausa" aria-label="Pausar o reanudar la rotación" aria-pressed="false">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path class="ic-pausa" d="M5 3v10M11 3v10"/><path class="ic-sigue" d="M5 3l8 5-8 5z"/></svg></button>
        <button class="sala-btn" id="sala-pantalla" title="Pantalla completa (F)" aria-label="Pantalla completa">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg></button>
        <button class="sala-btn" id="sala-cerrar" title="Cerrar la sala (Esc)" aria-label="Cerrar la sala de control">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg></button>
      </nav></header>
    <div class="sala-kpis" id="sala-kpis"><div class="sala-kpi"><span class="sala-k-t">Cargando la sala…</span></div></div>
    <main class="sala-cuerpo" id="sala-cuerpo" aria-live="off"></main>
    <footer class="sala-pie"><span id="sala-vista-t"></span><span class="sala-progreso"><i id="sala-progreso"></i></span><span id="sala-estado">Conectando…</span></footer>`;
  document.body.appendChild(raiz);
  document.body.classList.add('sala-abierta');
  E = { datos: null, vista: 0, pausa: false, ticker: [], foco: document.activeElement };
  const hora = () => { const d = new Date(); $('#sala-hora').textContent = reloj(d); $('#sala-fecha').textContent = fechaLarga(d);
    $$('.sala-c-reloj').forEach(el => { el.textContent = espera(el.dataset.desde); }); };
  hora(); E.reloj = setInterval(hora, 1000);
  E.refresco = setInterval(refrescar, REFRESCO_MS);
  $$('[data-sala-ir]', raiz).forEach(b => b.onclick = () => irA(Number(b.dataset.salaIr)));
  $('#sala-pausa').onclick = () => { E.pausa = !E.pausa; programarRotacion(); };
  $('#sala-pantalla').onclick = pantallaCompleta;
  $('#sala-cerrar').onclick = cerrarSala;
  E.teclas = e => {
    if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); cerrarSala(); }
    else if (e.key === 'ArrowRight') irA(E.vista + 1);
    else if (e.key === 'ArrowLeft') irA(E.vista - 1);
    else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); E.pausa = !E.pausa; programarRotacion(); }
    else if (/^[1-3]$/.test(e.key)) irA(Number(e.key) - 1);
    else if (e.key.toLowerCase() === 'f') pantallaCompleta();
  };
  document.addEventListener('keydown', E.teclas);
  programarRotacion();
  refrescar().then(() => {
    if (!E || menosMovimiento()) return;
    $$('#sala-kpis [data-n]').forEach(correr);
  });
  $('#sala-cerrar').focus({ preventScroll: true });
}

function pantallaCompleta() {
  const raiz = $('#sala'); if (!raiz) return;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else raiz.requestFullscreen?.().catch(() => {});
}

export function cerrarSala() {
  if (!E) return;
  clearInterval(E.reloj); clearInterval(E.refresco); clearTimeout(E.rota); clearTimeout(E.pronto);
  document.removeEventListener('keydown', E.teclas);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  const foco = E.foco; E = null;
  $('#sala')?.remove(); document.body.classList.remove('sala-abierta');
  foco?.focus?.({ preventScroll: true });
}
export const salaAbierta = () => !!E;
