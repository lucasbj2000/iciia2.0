/* ============ Reportes IMPAR ============
   Mismos datos y mismo alcance de permisos que antes (los define el servidor según el rol):
   admin/gerente ven toda la empresa, jefe su equipo y agente sus propias negociaciones. */
import { $, $$, esc, S, get, gs, fd, fdate, fx, etapa, bajar, vacio, skeleton, toast, DISPONIBILIDAD } from './core.js';
import { fichaNeg } from './ficha.js';
import { ic } from './iconos.js';
import { hoja, registro, crucesAnillo } from './graficos-impar.js';

/* Período: día, semana, mes, año o rango libre, anclado a una fecha (hora local de Paraguay). */
const hoyYMD = () => { const d = new Date(); return ymd(d); };
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const aFecha = t => { const [y, m, d] = t.split('-').map(Number); return new Date(y, m - 1, d); };
let PERIODO = { modo: 'mes', ancla: hoyYMD(), desde: '', hasta: '' };
let RANGO = 30; // días del período cargado (para textos y comparaciones)
let ORDEN = { col: 'ganadas', dir: -1 };
let FILTRO = { q: '', etapa: '' };

const MODOS = [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año'], ['rango', 'Rango']];
/** Desde y hasta (incluidos) del período elegido. */
function limites(p = PERIODO) {
  const a = aFecha(p.ancla);
  if (p.modo === 'dia') return { desde: p.ancla, hasta: p.ancla };
  if (p.modo === 'semana') {
    const lunes = new Date(a); lunes.setDate(a.getDate() - ((a.getDay() + 6) % 7));
    const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
    return { desde: ymd(lunes), hasta: ymd(domingo) };
  }
  if (p.modo === 'mes') return { desde: ymd(new Date(a.getFullYear(), a.getMonth(), 1)), hasta: ymd(new Date(a.getFullYear(), a.getMonth() + 1, 0)) };
  if (p.modo === 'anio') return { desde: `${a.getFullYear()}-01-01`, hasta: `${a.getFullYear()}-12-31` };
  return { desde: p.desde || p.ancla, hasta: p.hasta || p.ancla };
}
function mover(dir) {
  const a = aFecha(PERIODO.ancla);
  if (PERIODO.modo === 'dia') a.setDate(a.getDate() + dir);
  else if (PERIODO.modo === 'semana') a.setDate(a.getDate() + dir * 7);
  else if (PERIODO.modo === 'mes') a.setMonth(a.getMonth() + dir, 1);
  else if (PERIODO.modo === 'anio') a.setFullYear(a.getFullYear() + dir, 0, 1);
  PERIODO.ancla = ymd(a);
}
const fLarga = (t, o) => aFecha(t).toLocaleDateString('es-PY', o);
const capital = t => t.charAt(0).toLocaleUpperCase('es') + t.slice(1);
function nombrePeriodo(p = PERIODO) {
  const { desde, hasta } = limites(p), hoy = hoyYMD();
  if (p.modo === 'dia') return desde === hoy ? 'Hoy' : capital(fLarga(desde, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  if (p.modo === 'semana') {
    const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);
    return `Semana del ${fLarga(desde, mismoMes ? { day: 'numeric' } : { day: 'numeric', month: 'long' })} al ${fLarga(hasta, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  if (p.modo === 'mes') return capital(fLarga(desde, { month: 'long', year: 'numeric' }));
  if (p.modo === 'anio') return desde.slice(0, 4);
  return `${fLarga(desde, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fLarga(hasta, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
/** «el período anterior»: ayer, la semana pasada, el mes pasado… */
const anteriorTxt = () => ({ dia: 'el día anterior', semana: 'la semana anterior', mes: 'el mes anterior', anio: 'el año anterior' }[PERIODO.modo]
  || `los ${RANGO} días anteriores`);

const ALCANCE = {
  admin: 'Toda la empresa', gerente: 'Toda la empresa', jefe: 'Tu equipo', agente: 'Tus negociaciones'
};
const montoDe = n => Number(n.monto_cierre || n.valor || 0);
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
/** 14 min · 3 h 20 min · 9 días 16 h */
const tiempo = min => {
  min = Math.max(0, Math.round(Number(min) || 0));
  if (min < 60) return `${min} min`;
  if (min < 1440) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${m} min` : `${h} h`; }
  const horas = Math.round(min / 60), d = Math.floor(horas / 24), h = horas % 24;
  return `${d} ${d === 1 ? 'día' : 'días'}${h ? ` ${h} h` : ''}`;
};

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
    <span class="rep-delta-ref">vs. ${anteriorTxt()}</span></span>`;
}

/* ---------- Evolución: ingresos (barras) y ganadas (línea), en un solo eje ---------- */
function cubetas(ns, desde, hasta) {
  const ini = aFecha(desde), finExcl = aFecha(hasta); finExcl.setDate(finExcl.getDate() + 1);
  const dias = Math.round((finExcl - ini) / 86400000);
  const modo = dias <= 31 ? 'dia' : dias <= 190 ? 'semana' : 'mes';
  const out = [];
  if (modo === 'dia') {
    for (let d = new Date(ini); d < finExcl; d.setDate(d.getDate() + 1)) {
      const h = new Date(d); h.setDate(h.getDate() + 1);
      out.push({ desde: new Date(d), hasta: h, etiqueta: `${d.getDate()}/${d.getMonth() + 1}`, largo: d.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long' }) });
    }
  } else if (modo === 'semana') {
    for (let d = new Date(ini); d < finExcl; d.setDate(d.getDate() + 7)) {
      const h = new Date(d); h.setDate(h.getDate() + 7);
      out.push({ desde: new Date(d), hasta: h < finExcl ? h : new Date(finExcl), etiqueta: `${d.getDate()}/${d.getMonth() + 1}`, largo: `Semana del ${d.toLocaleDateString('es-PY', { day: 'numeric', month: 'long' })}` });
    }
  } else {
    for (let d = new Date(ini.getFullYear(), ini.getMonth(), 1); d < finExcl; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      out.push({ desde: d < ini ? new Date(ini) : d, hasta: new Date(d.getFullYear(), d.getMonth() + 1, 1), etiqueta: d.toLocaleDateString('es-PY', { month: 'short' }).replace('.', ''), largo: capital(d.toLocaleDateString('es-PY', { month: 'long', year: 'numeric' })) });
    }
  }
  const dentro = (t, c) => { const x = new Date(t); return x >= c.desde && x < c.hasta; };
  out.forEach(c => {
    c.ingresos = ns.filter(n => dentro(n.creado, c)).length;
    c.ganadas = ns.filter(n => n.etapa === 'ganado' && dentro(n.actualizado, c)).length;
  });
  return { modo, cubetas: out };
}

function graficoEvolucion(ns, ancho0 = 720, desde, hasta) {
  const { modo, cubetas: cs } = cubetas(ns, desde, hasta);
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
    const yt = y(c.ingresos);
    return hoja(cx(i) - ancho / 2, yt, ancho, y(0) - yt, 'rep-bar', ` style="--i:${i}"`);
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
      aria-label="Negociaciones ingresadas y ganadas (${esc(nombrePeriodo())}): ${totalIng} ingresadas y ${totalGan} ganadas.">
      ${ticks.map(v => `<line class="rep-gl" x1="${izq}" x2="${W - der}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="rep-ytick" x="${izq - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      ${cs.map(barra).join('')}
      <path class="rep-line" d="${linea}" pathLength="1"/>
      ${cs.map((c, i) => c.ganadas || i === ultimo ? registro(cx(i), y(c.ganadas), 4, 'rep-dot') : '').join('')}
      ${cs.map((c, i) => (i % cadaCuanto === 0 && (i === ultimo || ultimo - i >= Math.ceil(cadaCuanto * .7))) || i === ultimo
        ? `<text class="rep-xtick" x="${cx(i)}" y="${H - 8}" text-anchor="${i === ultimo && cs.length > 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${esc(c.etiqueta)}</text>` : '').join('')}
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

/* ---------- Tiempo de respuesta: bot y agentes ---------- */
const nivel = i => i == null ? 'nada' : i >= 80 ? 'bien' : i >= 50 ? 'medio' : 'mal';
const NIVEL_TXT = { bien: 'Muy bien', medio: 'Mejorable', mal: 'Lento', nada: 'Sin datos' };
const corto = min => {
  if (min == null) return '—';
  if (min < 1) return `${Math.max(1, Math.round(min * 60))} s`;
  return tiempo(min);
};
function anillo(indice, etiqueta) {
  const r = 44, c = 2 * Math.PI * r, v = indice == null ? 0 : indice;
  return `<div class="rep-anillo ${nivel(indice)}" role="img" aria-label="${etiqueta}: índice ${indice == null ? 'sin datos' : indice + ' por ciento'}">
    <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
      ${crucesAnillo(60, r)}<circle class="rep-anillo-guia" cx="60" cy="60" r="${r - 10}"/>
      <circle class="rep-anillo-fondo" cx="60" cy="60" r="${r}"/>
      <circle class="rep-anillo-valor" cx="60" cy="60" r="${r}" style="--largo:${c.toFixed(1)};--final:${(c * (1 - v / 100)).toFixed(1)}"/>
    </svg>
    <span class="rep-anillo-n"><b data-correr>${indice == null ? '—' : indice + '%'}</b><small>${NIVEL_TXT[nivel(indice)]}</small></span></div>`;
}
function tarjetaTiempo(titulo, icono, r, meta, extra) {
  return `<article class="rep-indice">
    <header><span class="rep-indice-ic" aria-hidden="true">${ic(icono)}</span><div><h4>${titulo}</h4><small>Meta: responder en menos de ${meta}</small></div></header>
    <div class="rep-indice-cuerpo">${anillo(r.indice, titulo)}
      <dl class="rep-indice-datos">
        <div><dt>La mitad responde en</dt><dd>${corto(r.mediana)}</dd></div>
        <div><dt>Promedio</dt><dd>${corto(r.promedio)}</dd></div>
        <div><dt>9 de cada 10, en menos de</dt><dd>${corto(r.p90)}</dd></div>
        <div><dt>Veces medidas</dt><dd data-correr>${(r.n || 0).toLocaleString('es-PY')}</dd></div>
      </dl></div>${extra || ''}</article>`;
}
/** Completa la serie con todas las cubetas del período (días, semanas o meses sin datos incluidos). */
function serieCompleta(t, desde, hasta) {
  const hay = new Map(t.serie.map(x => [x.clave, x])), out = [];
  const fin = aFecha(hasta);
  if (t.modo === 'mes') {
    for (let d = aFecha(desde.slice(0, 7) + '-01'); d <= fin; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const k = ymd(d).slice(0, 7); out.push(hay.get(k) || { clave: k, bot: null, agente: null });
    }
  } else {
    const paso = t.modo === 'semana' ? 7 : 1;
    for (let d = aFecha(desde); d <= fin; d.setDate(d.getDate() + paso)) {
      const k = ymd(d); out.push(hay.get(k) || { clave: k, bot: null, agente: null });
    }
  }
  return out.length ? out : t.serie;
}
function serieTiempos(t, desde, hasta) {
  if (!t.serie.length) return '';
  t = { ...t, serie: serieCompleta(t, desde, hasta) };
  const maxA = Math.max(1, ...t.serie.map(x => x.agente || 0)), maxB = Math.max(1 / 60, ...t.serie.map(x => x.bot || 0));
  const fila = (k, max, clase, titulo) => `<div class="rep-mini">
      <span class="rep-mini-t">${titulo}</span>
      <div class="rep-mini-barras">${t.serie.map((x, i) => {
        const v = x[k], alto = v == null ? 0 : Math.max(6, v / max * 100);
        return `<span class="rep-mini-b ${clase} ${v == null ? 'vacia' : ''}" style="--alto:${alto.toFixed(1)}%;--i:${i}"
          title="${esc(etiquetaClave(x.clave, t.modo))}: ${v == null ? 'sin datos' : corto(v)}"></span>`; }).join('')}</div></div>`;
  return `<div class="rep-tiempos-serie">
    <p class="rep-nota">Mediana ${t.modo === 'dia' ? 'por día' : t.modo === 'semana' ? 'por semana' : 'por mes'}: barras más bajas = respuestas más rápidas.</p>
    ${fila('agente', maxA, 'ag', 'Agentes')}${t.bot.n ? fila('bot', maxB, 'bt', 'Bot') : ''}
    <div class="rep-mini rep-mini-ejes" aria-hidden="true"><span></span><span><small>${esc(etiquetaClave(t.serie[0].clave, t.modo))}</small><small>${esc(etiquetaClave(t.serie.at(-1).clave, t.modo))}</small></span></div></div>`;
}
const etiquetaClave = (k, modo) => modo === 'mes' ? capital(fLarga(k + '-01', { month: 'long', year: 'numeric' }))
  : modo === 'semana' ? 'Semana del ' + fLarga(k, { day: 'numeric', month: 'long' }) : capital(fLarga(k, { weekday: 'long', day: 'numeric', month: 'long' }));
function rankingTiempos(t) {
  const ps = t.personas.filter(p => p.n);
  if (!ps.length) return '';
  const max = Math.max(1, ...ps.map(p => p.mediana || 0));
  return `<div class="rep-ranking"><h4>Por persona <small>(mediana en horario laboral · de más rápido a más lento)</small></h4>
    ${ps.map((p, i) => `<div class="rep-rank-fila" style="--i:${i}">
      <span class="rep-rank-n"><b>${esc(p.nombre)}</b><small>${p.n} ${p.n === 1 ? 'respuesta' : 'respuestas'}</small></span>
      <span class="rep-pista"><i class="rep-crece ${nivel(p.indice)}" style="--w:${Math.max(3, (p.mediana || 0) / max * 100).toFixed(1)}%"></i></span>
      <span class="rep-rank-v"><b>${corto(p.mediana)}</b><span class="rep-chip ${nivel(p.indice)}">${p.indice}% en meta</span></span></div>`).join('')}</div>`;
}
function bloqueTiempos(t, desde, hasta) {
  if (!t) return '';
  const metaAg = `${t.metaAgenteMin} min (horario laboral)`;
  const pendientes = t.sinRespuesta ? `<p class="rep-alerta-suave">${t.sinRespuesta} ${t.sinRespuesta === 1 ? 'mensaje de cliente sigue' : 'mensajes de clientes siguen'} sin respuesta en este período.</p>` : '';
  return `<section class="card-box rep-card rep-tiempos rep-anima" style="--i:1" aria-label="Índice de tiempo de respuesta">
    <div class="rep-tiempos-cab"><h3>Índice de tiempo de respuesta</h3>
      <p class="rep-nota">Porcentaje de veces que el cliente recibió respuesta dentro de la meta. Se mide desde que el cliente escribe hasta la primera respuesta.</p></div>
    <div class="rep-indices">
      ${tarjetaTiempo('Agentes', 'usuario', t.agente, metaAg, pendientes)}
      ${t.bot.n ? tarjetaTiempo('Bot', 'bot', t.bot, '1 min', '') :
        `<article class="rep-indice rep-indice-vacio"><header><span class="rep-indice-ic" aria-hidden="true">${ic('bot')}</span><div><h4>Bot</h4><small>Meta: responder en menos de 1 min</small></div></header>
          ${vacio('bot', 'El bot no respondió en este período', 'Aparece cuando las respuestas automáticas o el menú de sucursales atienden a un cliente.')}</article>`}
    </div>
    ${serieTiempos(t, desde, hasta)}${rankingTiempos(t)}
    ${t.recortado ? '<p class="rep-nota">Período muy largo: se midieron las primeras 60.000 conversaciones.</p>' : ''}
  </section>`;
}

/* Animaciones de entrada: anillos, barras y tarjetas, una sola vez por carga (quietas con reducir movimiento). */
function animarEntrada(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { root.classList.add('vivo', 'sin-mov'); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('vivo')));
}

/* Las cifras principales «corren» hasta su valor (300 ms; quietas con reducir movimiento). */
function correrNumeros(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('.rep-grande, .rep-cifra b, .rep-mio b, [data-correr]', root).forEach(el => {
    const final = el.textContent, m = final.match(/^(\D*)([\d.]+)(.*)$/);
    if (!m) return;
    const objetivo = Number(m[2].replace(/\./g, ''));
    if (!Number.isFinite(objetivo) || objetivo < 2) return;
    const t0 = performance.now(), dur = 700;
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
  const previo = $('#view .rep');
  if (previo) previo.classList.add('rep-cargando'); // cambio de período: se atenúa, no parpadea
  else $('#view').innerHTML = `<div class="section">${skeleton(6)}</div>`;
  const { desde, hasta } = limites();
  let d;
  try { d = await get(`/reportes?desde=${desde}&hasta=${hasta}`); }
  catch (e) { previo?.classList.remove('rep-cargando'); toast(e.message, 'bad', 'Reportes'); return; }
  RANGO = d.dias || 30;
  pintar(d);
}

function barraPeriodo() {
  const { hasta } = limites(), hoy = hoyYMD();
  // No se navega hacia períodos que todavía no empezaron.
  const siguienteFuturo = PERIODO.modo !== 'rango' && (() => { const g = PERIODO.ancla; mover(1); const l = limites(); PERIODO.ancla = g; return l.desde > hoy; })();
  return `<div class="rep-periodo" role="group" aria-label="Período del reporte">
    <div class="rep-modos" role="tablist" aria-label="Agrupar por">${MODOS.map(([id, t]) =>
      `<button role="tab" data-modo="${id}" class="${PERIODO.modo === id ? 'on' : ''}" aria-selected="${PERIODO.modo === id}">${t}</button>`).join('')}</div>
    ${PERIODO.modo === 'rango'
      ? `<div class="rep-rango-fechas">
          <label>Desde <input type="date" id="rep-desde" value="${esc(limites().desde)}" max="${hoy}"></label>
          <label>Hasta <input type="date" id="rep-hasta" value="${esc(hasta)}" max="${hoy}"></label>
          <button class="btn sm" id="rep-aplicar">Ver período</button></div>`
      : `<div class="rep-nav">
          <button class="rep-flecha" id="rep-ant" aria-label="Período anterior">${ic('flecha-izq')}</button>
          <span class="rep-periodo-et" aria-live="polite">${esc(nombrePeriodo())}</span>
          <button class="rep-flecha" id="rep-sig" aria-label="Período siguiente" ${siguienteFuturo ? 'disabled' : ''}>${ic('flecha-der')}</button>
          ${limites().hasta < hoy || limites().desde > hoy ? '<button class="btn ghost sm" id="rep-hoy">Volver a hoy</button>' : ''}</div>`}
  </div>`;
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
     ${barraPeriodo()}
     ${fx('exportar') ? `<button class="btn ghost sm" id="r-export">⭳ Exportar CSV</button>` : ''}</div>

   <section class="rep-hero card-box" aria-label="Resumen del período">
     <div class="rep-principal">
       <span class="rep-et">Monto cerrado · ${esc(nombrePeriodo())}</span>
       <b class="rep-grande">${gs(monto)}</b>
       ${delta(monto, a?.monto)}
       <p class="rep-frase">${gan.length} ${gan.length === 1 ? 'venta ganada' : 'ventas ganadas'} de ${total} ${total === 1 ? 'negociación' : 'negociaciones'}, ticket promedio <b>${gs(gan.length ? Math.round(monto / gan.length) : 0)}</b></p>
     </div>
     <div class="rep-cifras">
       <div class="rep-cifra"><span class="rep-et">Negociaciones</span><b>${total}</b>${delta(total, a?.total)}</div>
       <div class="rep-cifra"><span class="rep-et">Ganadas</span><b>${gan.length}</b>${delta(gan.length, a?.ganadas)}</div>
       <div class="rep-cifra"><span class="rep-et">Conversión</span><b>${conv}%</b>${convAnt == null ? '<span class="rep-delta">Sin período anterior para comparar</span>' : delta(conv, convAnt, { puntos: true })}</div>
       <div class="rep-cifra"><span class="rep-et">Primera respuesta</span><b class="${tiempo(d.primeraRespuestaMin).length > 6 ? 'largo' : ''}">${d.primeraRespuestaMedidas === 0 ? '—' : tiempo(d.primeraRespuestaMin)}</b><span class="rep-delta" title="La mitad de las negociaciones recibió su primera respuesta en menos de este tiempo">Mediana del período</span></div>
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

   ${bloqueTiempos(d.tiempos, d.desde, d.hasta)}

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
  // Orden de entrada: cada bloque aparece un instante después del anterior.
  $$('.rep > section, .rep > .rep-grid > section', root).forEach((el, i) => { el.classList.add('rep-anima'); el.style.setProperty('--i', i); });
  animarEntrada($('.rep', root));
  correrNumeros(root);
  const evol = $('#rep-evol');
  let anchoPrevio = 0;
  const dibujar = () => {
    const w = evol.clientWidth; if (!w || Math.abs(w - anchoPrevio) < 4) return;
    const primera = !anchoPrevio;
    anchoPrevio = w; evol.innerHTML = graficoEvolucion(ns, w, d.desde, d.hasta); conectarGrafico(evol);
    if (primera) evol.querySelector('svg')?.classList.add('entra'); // se dibuja solo al abrir, no al redimensionar
  };
  dibujar();
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (!evol.isConnected) return ro.disconnect(); dibujar(); }); ro.observe(evol); }
  $$('[data-modo]').forEach(b => b.onclick = () => {
    // Al cambiar de agrupación se conserva la fecha que se estaba mirando (nunca en el futuro).
    const l = limites(), hoy = hoyYMD(), ref = l.hasta > hoy ? hoy : l.hasta;
    PERIODO = b.dataset.modo === 'rango'
      ? { ...PERIODO, modo: 'rango', desde: l.desde > ref ? ref : l.desde, hasta: ref }
      : { ...PERIODO, modo: b.dataset.modo, ancla: ref };
    vistaReportes();
  });
  if ($('#rep-ant')) $('#rep-ant').onclick = () => { mover(-1); vistaReportes(); };
  if ($('#rep-sig')) $('#rep-sig').onclick = () => { mover(1); vistaReportes(); };
  if ($('#rep-hoy')) $('#rep-hoy').onclick = () => { PERIODO.ancla = hoyYMD(); vistaReportes(); };
  if ($('#rep-aplicar')) $('#rep-aplicar').onclick = () => {
    const de = $('#rep-desde').value, ha = $('#rep-hasta').value;
    if (!de || !ha) return toast('Elegí las dos fechas.', 'warn', 'Reportes');
    PERIODO = { ...PERIODO, modo: 'rango', desde: de <= ha ? de : ha, hasta: de <= ha ? ha : de };
    vistaReportes();
  };
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
    bajar(`reporte_${S.empresa.codigo}_${d.desde}_a_${d.hasta}.csv`, [head.join(';'), ...filas].join('\n'));
    toast('Reporte exportado', 'ok');
  };
}
