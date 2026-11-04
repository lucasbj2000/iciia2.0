/* ============ Reportes IMPAR ============
   Mismos datos y mismo alcance de permisos que antes (los define el servidor según el rol):
   admin/gerente ven toda la empresa, jefe su equipo y agente sus propias negociaciones. */
import { $, $$, esc, S, get, gs, fd, fdate, fx, etapa, bajar, vacio, skeleton, toast, DISPONIBILIDAD } from './core.js';
import { fichaNeg } from './ficha.js';
import { ic } from './iconos.js';

let RANGO = 30;
let ORDEN = { col: 'ganadas', dir: -1 };
let FILTRO = { q: '', etapa: '' };

const ALCANCE = {
  admin: 'Toda la empresa', gerente: 'Toda la empresa', jefe: 'Tu equipo', agente: 'Tus negociaciones'
};
const montoDe = n => Number(n.monto_cierre || n.valor || 0);
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const tiempo = min => min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`;

/** Variación frente al período anterior. masEsMejor decide el color. */
function delta(actual, previo, { masEsMejor = true, puntos = false } = {}) {
  if (previo == null) return '';
  let txt, dir;
  if (puntos) {
    const d = Math.round(actual - previo);
    dir = Math.sign(d); txt = `${d > 0 ? '+' : ''}${d} pts`;
  } else {
    if (!previo && !actual) return `<span class="rep-delta">Sin cambios</span>`;
    if (!previo) return `<span class="rep-delta sube">Nuevo en este período</span>`;
    const d = Math.round((actual - previo) / previo * 100);
    dir = Math.sign(d); txt = `${d > 0 ? '+' : ''}${d}%`;
  }
  if (!dir) return `<span class="rep-delta">Igual que el período anterior</span>`;
  const bueno = (dir > 0) === masEsMejor;
  return `<span class="rep-delta ${bueno ? 'bien' : 'mal'}"><span aria-hidden="true">${dir > 0 ? '▲' : '▼'}</span> ${txt}
    <span class="rep-delta-ref">vs. ${RANGO} días anteriores</span></span>`;
}

/* ---------- Evolución: ingresos (barras) y ganadas (línea), en un solo eje ---------- */
function cubetas(ns, dias) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const modo = dias <= 31 ? 'dia' : dias <= 120 ? 'semana' : 'mes';
  const out = [];
  if (modo === 'dia') {
    for (let i = dias - 1; i >= 0; i--) {
      const d = new Date(hoy); d.setDate(d.getDate() - i);
      const h = new Date(d); h.setDate(h.getDate() + 1);
      out.push({ desde: d, hasta: h, etiqueta: `${d.getDate()}/${d.getMonth() + 1}`, largo: d.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long' }) });
    }
  } else if (modo === 'semana') {
    const n = Math.ceil(dias / 7);
    for (let i = n - 1; i >= 0; i--) {
      const h = new Date(hoy); h.setDate(h.getDate() + 1 - i * 7);
      const d = new Date(h); d.setDate(d.getDate() - 7);
      out.push({ desde: d, hasta: h, etiqueta: `${d.getDate()}/${d.getMonth() + 1}`, largo: `Semana del ${d.toLocaleDateString('es-PY', { day: 'numeric', month: 'long' })}` });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1), h = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 1);
      out.push({ desde: d, hasta: h, etiqueta: d.toLocaleDateString('es-PY', { month: 'short' }).replace('.', ''), largo: d.toLocaleDateString('es-PY', { month: 'long', year: 'numeric' }) });
    }
  }
  const dentro = (t, c) => { const x = new Date(t); return x >= c.desde && x < c.hasta; };
  out.forEach(c => {
    c.ingresos = ns.filter(n => dentro(n.creado, c)).length;
    c.ganadas = ns.filter(n => n.etapa === 'ganado' && dentro(n.actualizado, c)).length;
  });
  return { modo, cubetas: out };
}

function graficoEvolucion(ns, ancho0 = 720) {
  const { modo, cubetas: cs } = cubetas(ns, RANGO);
  const W = Math.max(280, Math.round(ancho0)), H = ancho0 < 500 ? 190 : 220, izq = 34, der = 10, arr = 12, abj = 26;
  const max = Math.max(1, ...cs.map(c => Math.max(c.ingresos, c.ganadas)));
  const paso = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 60 ? 10 : Math.ceil(max / 5 / 10) * 10;
  const tope = Math.ceil(max / paso) * paso;
  const y = v => arr + (H - arr - abj) * (1 - v / tope);
  const banda = (W - izq - der) / cs.length;
  const ancho = Math.min(24, Math.max(3, banda * 0.62));
  const cx = i => izq + banda * i + banda / 2;
  const cadaCuanto = Math.max(1, Math.ceil(cs.length / Math.max(3, Math.floor((W - izq - der) / 54))));
  const ticks = []; for (let v = 0; v <= tope; v += paso) ticks.push(v);
  const barra = (c, i) => {
    if (!c.ingresos) return '';
    const x = cx(i) - ancho / 2, yt = y(c.ingresos), h = y(0) - yt, r = Math.min(4, h, ancho / 2);
    return `<path class="rep-bar" d="M${x},${y(0)} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + ancho - r} Q${x + ancho},${yt} ${x + ancho},${yt + r} V${y(0)} Z"/>`;
  };
  const linea = cs.map((c, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(c.ganadas).toFixed(1)}`).join(' ');
  const ultimo = cs.length - 1;
  const totalIng = cs.reduce((s, c) => s + c.ingresos, 0), totalGan = cs.reduce((s, c) => s + c.ganadas, 0);
  return `<div class="rep-chart" data-modo="${modo}">
    <div class="rep-leyenda" aria-hidden="true">
      <span><i class="k-bar"></i>Ingresadas <b>${totalIng}</b></span>
      <span><i class="k-line"></i>Ganadas <b>${totalGan}</b></span>
      <small>${modo === 'dia' ? 'Por día' : modo === 'semana' ? 'Por semana' : 'Por mes'}</small></div>
    <div class="rep-svgwrap">
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="Negociaciones ingresadas y ganadas en los últimos ${RANGO} días: ${totalIng} ingresadas y ${totalGan} ganadas.">
      ${ticks.map(v => `<line class="rep-gl" x1="${izq}" x2="${W - der}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="rep-ytick" x="${izq - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      ${cs.map(barra).join('')}
      <path class="rep-line" d="${linea}" pathLength="1"/>
      ${cs.map((c, i) => c.ganadas || i === ultimo ? `<circle class="rep-dot" cx="${cx(i)}" cy="${y(c.ganadas)}" r="4"/>` : '').join('')}
      ${cs.map((c, i) => i % cadaCuanto === 0 || i === ultimo
        ? `<text class="rep-xtick" x="${cx(i)}" y="${H - 8}" text-anchor="middle">${esc(c.etiqueta)}</text>` : '').join('')}
      ${cs.map((c, i) => `<rect class="rep-hit" x="${izq + banda * i}" y="${arr}" width="${banda}" height="${H - arr - abj}" data-i="${i}"/>`).join('')}
    </svg>
    <div class="rep-tip" hidden></div></div>
    <script type="application/json" class="rep-datos">${JSON.stringify(cs.map(c => ({ l: c.largo, i: c.ingresos, g: c.ganadas }))).replace(/</g, '\\u003c')}</script>
  </div>`;
}

function conectarGrafico(root) {
  const wrap = $('.rep-svgwrap', root); if (!wrap) return;
  const datos = JSON.parse($('.rep-datos', root).textContent);
  const tip = $('.rep-tip', wrap);
  const mostrar = el => {
    const d = datos[Number(el.dataset.i)]; if (!d) return;
    $$('.rep-hit', wrap).forEach(h => h.classList.toggle('on', h === el));
    tip.innerHTML = `<b>${esc(d.l)}</b><span><i class="k-bar"></i>Ingresadas <b>${d.i}</b></span><span><i class="k-line"></i>Ganadas <b>${d.g}</b></span>`;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const x = r.left - w.left + r.width / 2;
    tip.style.left = Math.max(8, Math.min(w.width - tip.offsetWidth - 8, x - tip.offsetWidth / 2)) + 'px';
  };
  $$('.rep-hit', wrap).forEach(h => {
    h.addEventListener('pointerenter', () => mostrar(h));
    h.addEventListener('pointerdown', () => mostrar(h));
  });
  wrap.addEventListener('pointerleave', () => { tip.hidden = true; $$('.rep-hit', wrap).forEach(h => h.classList.remove('on')); });
}

/* ---------- Bloques ---------- */
function embudo(ns) {
  const etapas = S.empresa.etapas || [];
  const cuenta = etapas.map(e => ({ e, n: ns.filter(x => x.etapa === e.id).length }));
  const max = Math.max(1, ...cuenta.map(c => c.n));
  return cuenta.map(({ e, n }) => `<div class="rep-fila">
      <div class="rep-fila-t"><span><i class="rep-sw" style="background:${esc(e.color)}"></i>${esc(e.nombre)}</span>
        <b>${n}<small> · ${pct(n, ns.length)}%</small></b></div>
      <div class="rep-pista"><i style="width:${n / max * 100}%;background:${esc(e.color)}"></i></div></div>`).join('')
    || vacio('◫', 'Sin etapas configuradas', '');
}

function canales(d) {
  if (!d.porCanal.length) return vacio('canal', 'Sin datos por canal', 'Aparecen cuando ingresan negociaciones por un canal.');
  const max = Math.max(1, ...d.porCanal.map(c => Number(c.total)));
  return d.porCanal.map(c => `<div class="rep-fila">
      <div class="rep-fila-t"><span>${esc(c.canal)}${c.sucursal && c.sucursal !== '—' ? `<small> · ${esc(c.sucursal)}</small>` : ''}</span>
        <b>${c.total}<small> · ${c.ganadas} ganadas · ${pct(Number(c.ganadas), Number(c.total))}%</small></b></div>
      <div class="rep-pista"><i class="rep-azul" style="width:${Number(c.total) / max * 100}%"></i></div></div>`).join('');
}

function motivos(cer) {
  const m = {};
  cer.forEach(n => { const k = (n.motivo || 'Sin motivo').split(' — ')[0]; m[k] = (m[k] || 0) + 1; });
  const filas = Object.entries(m).sort((a, b) => b[1] - a[1]);
  if (!filas.length) return vacio('✓', 'Sin cierres sin venta', 'En este período no se cerraron negociaciones sin venta.');
  const max = filas[0][1];
  return filas.map(([k, v]) => `<div class="rep-fila">
      <div class="rep-fila-t"><span>${esc(k)}</span><b>${v}<small> · ${pct(v, cer.length)}%</small></b></div>
      <div class="rep-pista"><i class="rep-gris" style="width:${v / max * 100}%"></i></div></div>`).join('');
}

function espera(d) {
  if (!d.colaEspera.length) return vacio('✓', 'Nadie esperando respuesta', 'Todos los clientes en espera fueron atendidos.');
  return `<div class="rep-cola">${d.colaEspera.map(e => {
    const nivel = e.horasLab >= d.slaHoras ? 'mal' : e.horasLab > d.slaHoras / 2 ? 'medio' : 'bien';
    const txt = { mal: 'Fuera de plazo', medio: 'Cerca del plazo', bien: 'En plazo' }[nivel];
    return `<button class="rep-cola-i" data-neg="${e.id}">
      <span class="rep-cola-n"><b>${esc(e.cliente)}</b>${e.frecuente ? ` <span class="tag t-frec" title="Frecuente">${ic('estrella', 'Frecuente')}</span>` : ''}<small>${esc(e.agente || 'Sin responsable')}</small></span>
      <span class="rep-medidor ${nivel}" title="${txt}"><i style="width:${Math.min(100, e.horasLab / d.slaHoras * 100)}%"></i></span>
      <span class="rep-cola-h ${nivel}"><b>${e.horasLab} h</b><small>${txt}</small></span></button>`;
  }).join('')}</div>`;
}

function equipo(d, ns) {
  if (S.usuario.rol === 'agente') {
    const m = ns.filter(n => n.agente_id === S.usuario.id), g = m.filter(n => n.etapa === 'ganado');
    return `<div class="rep-mio">
      <div><span class="rep-et">Asignadas</span><b>${m.length}</b></div>
      <div><span class="rep-et">Abiertas</span><b>${m.filter(n => d.etapasActivas.includes(n.etapa)).length}</b></div>
      <div><span class="rep-et">Ganadas</span><b>${g.length}</b></div>
      <div><span class="rep-et">Conversión</span><b>${pct(g.length, m.length)}%</b></div>
      <div><span class="rep-et">Monto ganado</span><b>${gs(g.reduce((s, n) => s + montoDe(n), 0))}</b></div></div>`;
  }
  const filas = d.universo.map(u => {
    const m = ns.filter(n => n.agente_id === u.id), g = m.filter(n => n.etapa === 'ganado');
    return { u, asignadas: m.length, abiertas: m.filter(n => d.etapasActivas.includes(n.etapa)).length,
      ganadas: g.length, conv: pct(g.length, m.length), monto: g.reduce((s, n) => s + montoDe(n), 0) };
  });
  filas.sort((a, b) => ORDEN.col === 'nombre' ? ORDEN.dir * a.u.nombre.localeCompare(b.u.nombre)
    : ORDEN.dir * (a[ORDEN.col] - b[ORDEN.col]) || a.u.nombre.localeCompare(b.u.nombre));
  const maxMonto = Math.max(1, ...filas.map(f => f.monto));
  const th = (col, t, cls = '') => `<th class="${cls}"><button class="rep-orden ${ORDEN.col === col ? 'on' : ''}" data-orden="${col}"
      aria-sort="${ORDEN.col === col ? (ORDEN.dir > 0 ? 'ascending' : 'descending') : 'none'}">${t}${ORDEN.col === col ? (ORDEN.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  return `<div class="rep-tabla-scroll"><table class="rep-tabla"><thead><tr>${th('nombre', 'Responsable')}
      ${th('asignadas', 'Asignadas', 'num')}${th('abiertas', 'Abiertas', 'num')}${th('ganadas', 'Ganadas', 'num')}
      ${th('conv', 'Conversión')}${th('monto', 'Monto ganado')}</tr></thead>
    <tbody>${filas.map(f => {
      const dd = DISPONIBILIDAD.find(x => x.id === f.u.disponibilidad) || {};
      return `<tr><td><span class="rep-persona"><b>${esc(f.u.nombre)}</b>
          <small><span class="dot" style="background:${dd.c || '#888'}"></span>${esc(dd.t || '—')} · ${esc(f.u.rol)}${f.u.sucursal ? ' · ' + esc(f.u.sucursal) : ''}</small></span></td>
        <td class="num">${f.asignadas}</td><td class="num">${f.abiertas}</td><td class="num"><b>${f.ganadas}</b></td>
        <td><span class="rep-conv"><span class="rep-pista mini"><i class="rep-azul" style="width:${f.conv}%"></i></span>${f.conv}%</span></td>
        <td><span class="rep-conv"><span class="rep-pista mini"><i class="rep-verde" style="width:${f.monto / maxMonto * 100}%"></i></span>${gs(f.monto)}</span></td></tr>`;
    }).join('') || `<tr><td colspan="6">${vacio('◎', 'Sin responsables', '')}</td></tr>`}</tbody></table></div>`;
}

function detalle(ns) {
  const q = FILTRO.q.trim().toLowerCase();
  const lista = ns.filter(n => (!FILTRO.etapa || n.etapa === FILTRO.etapa)
    && (!q || [n.cliente, n.agente_nombre, n.tel, n.origen].some(v => String(v || '').toLowerCase().includes(q))));
  const vis = lista.slice(0, 200);
  return `<p class="rep-nota">${lista.length === ns.length ? `${ns.length} negociaciones` : `${lista.length} de ${ns.length} negociaciones`}${lista.length > vis.length ? ' · se muestran las 200 más recientes; exportá para ver todas' : ''}</p>
    <div class="rep-tabla-scroll alto"><table class="rep-tabla"><thead><tr><th>Creada</th><th>Cliente</th><th class="hide-m">Origen</th><th>Etapa</th>
      <th class="hide-m">Responsable</th><th class="num">Monto</th><th class="hide-m">Motivo de cierre</th></tr></thead>
    <tbody>${vis.map(n => `<tr class="rep-click" data-neg="${n.id}" tabindex="0"><td>${fd(n.creado)}</td><td><b>${esc(n.cliente)}</b></td>
      <td class="hide-m">${esc(n.origen)}</td>
      <td><span class="rep-etapa"><i class="rep-sw" style="background:${esc(etapa(n.etapa).color)}"></i>${esc(etapa(n.etapa).nombre)}</span></td>
      <td class="hide-m">${esc(n.agente_nombre || '—')}</td>
      <td class="num">${n.etapa === 'ganado' ? `<b>${gs(montoDe(n))}</b>` : (Number(n.valor) ? gs(n.valor) : '—')}</td>
      <td class="hide-m">${esc(n.motivo || '—')}</td></tr>`).join('')
      || `<tr><td colspan="7">${vacio('⌕', 'Sin resultados', 'Probá con otro nombre o quitá el filtro de etapa.')}</td></tr>`}</tbody></table></div>`;
}

/* Las cifras principales «corren» hasta su valor (300 ms; quietas con reducir movimiento). */
function correrNumeros(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('.rep-grande, .rep-cifra b, .rep-mio b', root).forEach(el => {
    const final = el.textContent, m = final.match(/^(\D*)([\d.]+)(.*)$/);
    if (!m) return;
    const objetivo = Number(m[2].replace(/\./g, ''));
    if (!Number.isFinite(objetivo) || objetivo < 2) return;
    const t0 = performance.now(), dur = 300;
    const paso = t => {
      const k = Math.min(1, (t - t0) / dur), v = Math.round(objetivo * (1 - Math.pow(1 - k, 3)));
      el.textContent = k < 1 ? m[1] + v.toLocaleString('es-PY') + m[3] : final;
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  });
}

/* ---------- Vista ---------- */
export async function vistaReportes() {
  $('#view').innerHTML = `<div class="section">${skeleton(6)}</div>`;
  const d = await get(`/reportes?dias=${RANGO}`);
  pintar(d);
}

function pintar(d) {
  const ns = d.negociaciones;
  const gan = ns.filter(n => n.etapa === 'ganado'), cer = ns.filter(n => n.etapa === 'cerrado');
  const abiertas = ns.filter(n => d.etapasActivas.includes(n.etapa));
  const monto = gan.reduce((s, n) => s + montoDe(n), 0);
  const total = ns.length, conv = pct(gan.length, total);
  const a = d.anterior || null;
  const convAnt = a && a.total ? pct(a.ganadas, a.total) : null;
  const esAgente = S.usuario.rol === 'agente';
  const marca = k => ns.filter(n => (n.marcadores || []).includes(k)).length;
  const transferidas = ns.filter(n => Number(n.n_transferencias) > 0).length;

  $('#view').innerHTML = `<div class="section fx-vista rep">
   <div class="rep-barra">
     <span class="rep-alcance" title="Lo que ves depende de tu rol">${ic('escudo')} ${ALCANCE[S.usuario.rol] || 'Tu alcance'}</span>
     <div class="rep-rango" role="group" aria-label="Período">${[7, 30, 90, 365].map(x =>
       `<button data-rango="${x}" class="${RANGO === x ? 'on' : ''}" aria-pressed="${RANGO === x}">${x === 365 ? '1 año' : x + ' días'}</button>`).join('')}</div>
     ${fx('exportar') ? `<button class="btn ghost sm" id="r-export">⭳ Exportar CSV</button>` : ''}</div>

   <section class="rep-hero card-box" aria-label="Resumen del período">
     <div class="rep-principal">
       <span class="rep-et">Monto cerrado en ${RANGO === 365 ? 'el último año' : `los últimos ${RANGO} días`}</span>
       <b class="rep-grande">${gs(monto)}</b>
       ${delta(monto, a?.monto)}
       <p class="rep-frase">${gan.length} ${gan.length === 1 ? 'venta ganada' : 'ventas ganadas'} de ${total} ${total === 1 ? 'negociación' : 'negociaciones'}, ticket promedio <b>${gs(gan.length ? Math.round(monto / gan.length) : 0)}</b></p>
     </div>
     <div class="rep-cifras">
       <div class="rep-cifra"><span class="rep-et">Negociaciones</span><b>${total}</b>${delta(total, a?.total)}</div>
       <div class="rep-cifra"><span class="rep-et">Ganadas</span><b>${gan.length}</b>${delta(gan.length, a?.ganadas)}</div>
       <div class="rep-cifra"><span class="rep-et">Conversión</span><b>${conv}%</b>${convAnt == null ? '<span class="rep-delta">Sin período anterior para comparar</span>' : delta(conv, convAnt, { puntos: true })}</div>
       <div class="rep-cifra"><span class="rep-et">Primera respuesta</span><b>${tiempo(d.primeraRespuestaMin)}</b><span class="rep-delta">Promedio del período</span></div>
     </div>
     <ul class="rep-menores">
       <li><b>${abiertas.length}</b> abiertas</li>
       <li><b>${cer.length}</b> cerradas sin venta</li>
       <li><b>${transferidas}</b> transferidas</li>
       <li><b>${marca('manual')}</b> cargadas a mano</li>
       <li><b>${marca('frecuente')}</b> de clientes frecuentes</li>
       <li><b>${marca('regestionado')}</b> re gestionadas</li>
     </ul>
   </section>

   <div class="rep-grid rep-grid-2">
     <section class="card-box rep-card rep-ancha"><h3>Ingresadas y ganadas</h3><div id="rep-evol"></div></section>
     <section class="card-box rep-card"><h3>Embudo por etapa</h3><p class="rep-nota">Dónde está cada negociación del período.</p>${embudo(ns)}</section>
   </div>

   <div class="rep-grid rep-grid-2">
     <section class="card-box rep-card"><h3>Clientes esperando respuesta</h3>
       <p class="rep-nota">Horas laborales desde que el cliente escribió. Plazo: ${d.slaHoras} h.</p>${espera(d)}</section>
     <section class="card-box rep-card"><h3>Rendimiento por canal</h3>${canales(d)}</section>
   </div>

   <section class="card-box rep-card"><h3>${esAgente ? 'Tu rendimiento' : 'Rendimiento por responsable'}</h3>
     ${esAgente ? '' : '<p class="rep-nota">Tocá un encabezado para ordenar.</p>'}<div id="rep-equipo">${equipo(d, ns)}</div></section>

   <div class="rep-grid rep-grid-2">
     <section class="card-box rep-card"><h3>Ventas ganadas</h3>
       ${gan.length ? `<div class="rep-tabla-scroll medio"><table class="rep-tabla"><thead><tr><th>Fecha</th><th>Cliente</th><th class="hide-m">Responsable</th><th class="num">Monto</th></tr></thead>
         <tbody>${[...gan].sort((x, y) => new Date(y.actualizado) - new Date(x.actualizado)).map(n =>
           `<tr class="rep-click" data-neg="${n.id}" tabindex="0"><td>${fd(n.actualizado)}</td><td>${esc(n.cliente)}</td>
            <td class="hide-m">${esc(n.agente_nombre || '—')}</td><td class="num"><b>${gs(montoDe(n))}</b></td></tr>`).join('')}</tbody>
         <tfoot><tr><td colspan="2">Total</td><td class="hide-m"></td><td class="num"><b>${gs(monto)}</b></td></tr></tfoot></table></div>`
         : vacio('◇', 'Sin ventas en el período', 'Elegí un período más largo para ver ventas anteriores.')}</section>
     <section class="card-box rep-card"><h3>Motivos de cierre sin venta</h3>${motivos(cer)}</section>
   </div>

   <section class="card-box rep-card"><h3>Detalle de negociaciones</h3>
     <div class="rep-filtros"><input id="rep-q" type="search" placeholder="Buscar cliente, responsable o teléfono" value="${esc(FILTRO.q)}" aria-label="Buscar en el detalle">
       <select id="rep-etapa" aria-label="Filtrar por etapa"><option value="">Todas las etapas</option>
         ${(S.empresa.etapas || []).map(e => `<option value="${esc(e.id)}" ${FILTRO.etapa === e.id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></div>
     <div id="rep-detalle">${detalle(ns)}</div></section>
  </div>`;

  const root = $('#view');
  correrNumeros(root);
  const evol = $('#rep-evol');
  let anchoPrevio = 0;
  const dibujar = () => {
    const w = evol.clientWidth; if (!w || Math.abs(w - anchoPrevio) < 4) return;
    const primera = !anchoPrevio;
    anchoPrevio = w; evol.innerHTML = graficoEvolucion(ns, w); conectarGrafico(evol);
    if (primera) evol.querySelector('svg')?.classList.add('entra'); // se dibuja solo al abrir, no al redimensionar
  };
  dibujar();
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (!evol.isConnected) return ro.disconnect(); dibujar(); }); ro.observe(evol); }
  $$('[data-rango]').forEach(b => b.onclick = () => { RANGO = Number(b.dataset.rango); vistaReportes(); });
  const abrir = () => $$('[data-neg]', root).forEach(el => {
    el.onclick = () => fichaNeg(el.dataset.neg);
    el.onkeydown = e => { if (e.key === 'Enter') fichaNeg(el.dataset.neg); };
  });
  abrir();
  const ordenar = () => $$('[data-orden]').forEach(b => b.onclick = () => {
    const col = b.dataset.orden;
    ORDEN = ORDEN.col === col ? { col, dir: -ORDEN.dir } : { col, dir: col === 'nombre' ? 1 : -1 };
    $('#rep-equipo').innerHTML = equipo(d, ns); ordenar();
  });
  ordenar();
  let t;
  $('#rep-q').oninput = e => { clearTimeout(t); t = setTimeout(() => { FILTRO.q = e.target.value; $('#rep-detalle').innerHTML = detalle(ns); abrir(); }, 150); };
  $('#rep-etapa').onchange = e => { FILTRO.etapa = e.target.value; $('#rep-detalle').innerHTML = detalle(ns); abrir(); };
  if ($('#r-export')) $('#r-export').onclick = () => {
    const head = ['creada', 'cliente', 'telefono', 'origen', 'etapa', 'agente', 'sucursal', 'linea', 'valor', 'monto_cierre', 'motivo', 'marcadores'];
    const filas = ns.map(n => [fdate(n.creado), n.cliente, n.tel, n.origen, etapa(n.etapa).nombre,
      n.agente_nombre || '', n.sucursal, n.linea, n.valor, n.monto_cierre, n.motivo || '',
      (n.marcadores || []).join('/')].map(v => String(v ?? '').replace(/;/g, ',')).join(';'));
    bajar(`reporte_${S.empresa.codigo}_${RANGO}d.csv`, [head.join(';'), ...filas].join('\n'));
    toast('Reporte exportado', 'ok');
  };
}
