/* IMPAR · Sala de control en vivo — todo en una sola pantalla.
   Cada sucursal con el plano de su distrito y su clima; cola con relojes, agentes en línea, promedio de
   respuesta de agentes y del bot por separado, ritmo del día y movimientos en vivo. Pensada para una TV. */
import { $, $$, esc, get, iniciales, DISPONIBILIDAD } from './core.js';
import { menosMovimiento, correr } from './animaciones.js';
import { iconoClima, esDeNoche } from './clima-animado.js';
import { planoCiudad } from './planos-ciudades.js';
import { hoja } from './graficos-impar.js';

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
/** Minutos a texto corto: segundos si es menos de un minuto. */
const minutos = m => {
  if (m == null || !Number.isFinite(m)) return null;
  if (m < 1) return `${Math.max(1, Math.round(m * 60))} s`;
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60), r = Math.round(m % 60); return r ? `${h} h ${r} min` : `${h} h`;
};

let E = null;

/* ---------- Datos derivados ---------- */
function sucursalesConDatos(d) {
  const por = new Map(d.porSucursal.map(x => [norm(x.sucursal), x]));
  const usadas = new Set();
  const lista = d.sucursales.map(s => {
    const k = norm(s.nombre), x = por.get(k) || {}; usadas.add(k);
    return { nombre: s.nombre, k, lat: s.lat, lon: s.lon, agentes: s.agentes, abiertas: x.abiertas || 0, espera: x.espera || 0,
      nuevos: x.nuevos || 0, ventas: x.ventas || 0, monto: x.monto || 0 };
  });
  const resto = d.porSucursal.filter(x => !usadas.has(norm(x.sucursal)));
  if (resto.length) lista.push(resto.reduce((a, x) => ({ ...a, abiertas: a.abiertas + x.abiertas, espera: a.espera + x.espera,
    nuevos: a.nuevos + x.nuevos, ventas: a.ventas + x.ventas, monto: a.monto + x.monto }),
    { nombre: 'Sin sucursal', k: '', sin: true, abiertas: 0, espera: 0, nuevos: 0, ventas: 0, monto: 0 }));
  // Sin personas asignadas y sin movimiento hoy (nuevos, esperando, ventas) la sucursal no se muestra.
  const movimiento = s => s.nuevos || s.espera || s.ventas;
  return lista.filter(s => s.sin ? movimiento(s) || s.abiertas : (s.agentes ?? 1) > 0 || movimiento(s));
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
/* Sucursales con el plano de su distrito (límites oficiales del INE), lo que espera, lo nuevo del día y el clima.
   Primero Gran Asunción (las que están a menos de 25 km entre sí), después el interior. Sin mapa. */
function htmlCiudades(lista) {
  const ubicadas = lista.filter(s => !s.sin);
  const grupos = agrupar(ubicadas).sort((a, b) => b.length - a.length);
  const metro = new Set(grupos[0] || []);
  const orden = [...ubicadas].sort((a, b) => Number(metro.has(b)) - Number(metro.has(a)) || a.nombre.localeCompare(b.nombre, 'es'));
  const max = Math.max(1, ...orden.map(s => s.espera));
  const tarjeta = (s, i) => {
    const cl = E.clima.get(norm(s.nombre));
    return `<article class="sala-pin sala-ciudad pliego${s.espera ? ' con-espera' : ''}${metro.has(s) && metro.size > 1 ? ' metro' : ''}" data-suc="${esc(s.k)}" style="--i:${i}">
      <div class="sala-ci-vista"><div class="sala-ci-dibujo" data-plano="${esc(JSON.stringify({ nombre: s.nombre, lat: s.lat, lon: s.lon }))}"></div>
        ${cl && cl.temp != null ? `<span class="sala-ci-clima" title="Clima ahora">${iconoClima(cl.cod, esDeNoche())}<b>${Math.round(cl.temp)}°</b></span>` : ''}</div>
      <svg class="sala-ci-pulso" viewBox="-100 -60 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g class="sala-ondas"></g></svg>
      <header class="sala-ci-cab"><h4 title="${esc(s.nombre)}">${esc(s.nombre)}</h4></header>
      <div class="sala-ci-datos">
        <span class="sala-ci-espera"><b>${s.espera}</b><small>${s.espera === 1 ? 'espera' : 'esperan'}</small></span>
        <span class="sala-ci-otros"><span title="Clientes nuevos hoy"><b>${s.nuevos}</b> nuevos</span><span><b>${s.abiertas}</b> abiertas</span></span>
      </div>
      <span class="sala-ci-medidor" aria-hidden="true"><i style="--w:${(s.espera / max * 100).toFixed(1)}%"></i></span>
    </article>`;
  };
  if (!orden.length) return '<p class="sala-vacio grande">Cargá las sucursales en Configuración para verlas acá.</p>';
  const enMetro = orden.filter(s => metro.has(s) && metro.size > 1), resto = orden.filter(s => !enMetro.includes(s));
  const bloque = (t, xs, ini) => xs.length ? `<section class="sala-ci-grupo"><h3 class="sala-sub">${t}</h3>
      <div class="sala-ci-grilla" style="--n:${xs.length}">${xs.map((s, i) => tarjeta(s, ini + i)).join('')}</div></section>` : '';
  return enMetro.length ? bloque('Gran Asunción', enMetro, 0) + bloque('Interior', resto, enMetro.length) : bloque('Sucursales', resto, 0);
}

/* Los planos se dibujan al tamaño real de cada tarjeta, así los textos del plano se leen a su tamaño. */
function pintarPlanos(raiz) {
  for (const el of $$('.sala-ci-dibujo[data-plano]', raiz)) {
    const r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 30) continue;
    let s; try { s = JSON.parse(el.dataset.plano); } catch { continue; }
    el.innerHTML = planoCiudad(s, { W: Math.round(r.width), H: Math.round(r.height) }) || '<span class="sala-ci-sinplano">Ubicación sin plano cargado</span>';
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
/** Promedio de respuesta con una regla de meta: la marca muestra dónde cae el promedio respecto de la meta. */
function kpiPromedio(id, titulo, r, meta, nota) {
  const v = r?.promedio, txt = minutos(v);
  const nivel = v == null ? '' : v <= meta ? 'ok' : v <= meta * 3 ? 'alerta' : 'mal';
  const pos = v == null ? 0 : Math.min(100, v / (meta * 4) * 100);
  return `<div class="sala-kpi sala-kpi-prom ${nivel}" data-kpi="${id}">
    <span class="sala-k-t">${titulo}</span>
    <b class="sala-k-v">${txt ?? '—'}</b>
    ${v == null ? '' : `<span class="sala-regla" aria-hidden="true"><i class="sala-regla-meta" style="left:25%"></i><i class="sala-regla-v" style="--x:${pos.toFixed(1)}%"></i></span>`}
    <small>${v == null ? (id === 'bot' ? 'El bot no respondió hoy' : 'Sin respuestas medidas hoy') : `${nota} · meta ${minutos(meta)}`}</small></div>`;
}
function htmlKpis(k, d) {
  const pm = d.promedios;
  return `
  <div class="sala-kpi${k.enEspera > 5 ? ' alerta' : ''}" data-kpi="espera"><span class="sala-k-t">Clientes esperando</span>
    <b class="sala-k-v" data-n>${k.enEspera}</b><small>${k.enEspera ? 'Responder primero a los de más tiempo' : 'Nadie espera ahora'}</small></div>
  ${kpiPromedio('agente', 'Respuesta de agentes', pm?.agente, pm?.metaAgenteMin ?? 10, 'Promedio de hoy en horario laboral')}
  ${kpiPromedio('bot', 'Respuesta del bot', pm?.bot, pm?.metaBotMin ?? 1, 'Promedio de hoy')}
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
          ${hoja(cx - bw - 1, y(x.entran), bw, H - y(x.entran), 'rt-in').replace('</g>', `<title>${x.h} h: entraron ${x.entran}</title></g>`)}
          ${hoja(cx + 1, y(x.responden), bw, H - y(x.responden), 'rt-out').replace('</g>', `<title>${x.h} h: respuestas ${x.responden}</title></g>`)}
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
  if (firma !== E.firmaMapa) { E.firmaMapa = firma; const m = $('#sala-mapa'); m.innerHTML = htmlCiudades(lista); pintarPlanos(m); }
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
  const kpi = { venta: 'ventas', nuevo: 'nuevos', mensaje: 'espera', respuesta: 'agente' }[tipo];
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
    nodo.classList.remove('late', 'tk-nuevo', 'tk-mensaje', 'tk-respuesta', 'tk-venta'); void nodo.offsetWidth;
    nodo.classList.add('late', 'tk-' + tipo);
    clearTimeout(nodo._late); nodo._late = setTimeout(() => nodo.classList.remove('late', 'tk-' + tipo), 1500);
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
      <section class="sala-panel sala-mapa" id="sala-mapa" aria-label="Sucursales"></section>
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
    if (!E) return; const m = $('#sala-mapa'); if (m) pintarPlanos(m);
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
