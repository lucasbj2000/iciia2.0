/* Calendario de tiempos por estado de los asesores (Disponible, En gestión, Almuerzo, Permiso).
   Un mes por vista, filtrable por asesor. Cada día muestra el total y una línea de tiempo con los estados;
   al tocar un día se ve todo el detalle: tramos con hora de inicio y fin, entrada, salida y motivos. */
import { $, $$, esc, get, DISPONIBILIDAD } from './core.js';

const ESTADOS = ['disponible', 'ocupado', 'almuerzo', 'permiso'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const ZONA = 'America/Asuncion';
const C = { mes: null, usuario: '', dia: null, datos: null, cargando: false };

const color = id => (DISPONIBILIDAD.find(x => x.id === id) || {}).c || '#888';
const nombreEst = id => (DISPONIBILIDAD.find(x => x.id === id) || {}).t || id;
const hoyYMD = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA });
const hora = iso => new Date(iso).toLocaleTimeString('es-PY', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false });
const minutosDelDia = iso => { const [h, m] = hora(iso).split(':').map(Number); return h * 60 + m; };
const dur = seg => {
  const m = Math.round((Number(seg) || 0) / 60);
  if (!m) return '0 min';
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}` : `${r} min`;
};
const durLarga = seg => { const m = Math.round((Number(seg) || 0) / 60), h = Math.floor(m / 60), r = m % 60; return h ? `${h} h ${r} min` : `${r} min`; };
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const diaLargo = d => new Date(d + 'T12:00:00Z').toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const mesLargo = m => new Date(m + '-15T12:00:00Z').toLocaleDateString('es-PY', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const sumarMes = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const ultimoDia = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };

/** Monta el calendario dentro de un contenedor de la vista de reportes. */
export function montarCalendarioEstados(caja, { personas = [], esAgente = false } = {}) {
  if (!caja) return;
  C.mes ||= hoyYMD().slice(0, 7);
  if (esAgente) C.usuario = personas[0]?.id || '';
  else if (C.usuario && !personas.some(p => p.id === C.usuario)) C.usuario = '';
  caja.innerHTML = `
    <div class="ce-barra">
      <div class="ce-mes" role="group" aria-label="Mes">
        <button type="button" class="ce-nav" data-ce-mes="-1" aria-label="Mes anterior">‹</button>
        <label class="ce-mes-l"><span class="vh">Mes</span><select id="ce-mes">${Array.from({ length: 24 }, (_, i) => sumarMes(hoyYMD().slice(0, 7), -i)).map(m => `<option value="${m}" ${m === C.mes ? 'selected' : ''}>${esc(mesLargo(m).replace(/^./, c => c.toUpperCase()))}</option>`).join('')}</select></label>
        <button type="button" class="ce-nav" data-ce-mes="1" aria-label="Mes siguiente">›</button>
        <button type="button" class="btn ghost sm" data-ce-hoy>Este mes</button>
      </div>
      ${esAgente ? '' : `<label class="ce-filtro"><span>Asesor</span><select id="ce-usuario">
        <option value="">Todos los asesores</option>${personas.map(p => `<option value="${esc(p.id)}" ${p.id === C.usuario ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>`}
    </div>
    <div class="ce-ley" aria-hidden="true">${ESTADOS.map(e => `<span><i style="background:${color(e)}"></i>${esc(nombreEst(e))}</span>`).join('')}
      <span><i class="ce-ley-est"></i>Estimado hasta la salida del turno</span><span><i class="ce-ley-alerta"></i>No marcó la salida</span><span><i class="ce-ley-tarde"></i>Salida cargada después</span></div>
    <div id="ce-cuerpo" aria-live="polite"><div class="ce-cargando">Cargando tiempos…</div></div>`;
  caja.addEventListener('click', e => {
    const n = e.target.closest('[data-ce-mes]'); if (n) { cambiarMes(caja, sumarMes(C.mes, Number(n.dataset.ceMes))); return; }
    if (e.target.closest('[data-ce-hoy]')) { cambiarMes(caja, hoyYMD().slice(0, 7)); return; }
    const d = e.target.closest('[data-ce-dia]'); if (d) { C.dia = d.dataset.ceDia; pintar(caja); $('#ce-detalle', caja)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  });
  $('#ce-mes', caja)?.addEventListener('change', e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) cambiarMes(caja, e.target.value); });
  $('#ce-usuario', caja)?.addEventListener('change', e => { C.usuario = e.target.value; cargar(caja); });
  cargar(caja);
}
function cambiarMes(caja, m) {
  if (m > hoyYMD().slice(0, 7)) return;
  C.mes = m; C.dia = null;
  const i = $('#ce-mes', caja);
  if (i) { if (![...i.options].some(o => o.value === m)) i.add(new Option(mesLargo(m), m)); i.value = m; }
  cargar(caja);
}
async function cargar(caja) {
  const desde = C.mes + '-01', hasta = ymd(...C.mes.split('-').map(Number), ultimoDia(C.mes));
  const pedido = `${desde}|${hasta}|${C.usuario}`;
  C.pedido = pedido;
  $('#ce-cuerpo', caja).innerHTML = '<div class="ce-cargando">Cargando tiempos…</div>';
  try {
    const d = await get(`/reportes/estados?desde=${desde}&hasta=${hasta}${C.usuario ? '&usuario=' + encodeURIComponent(C.usuario) : ''}`);
    if (C.pedido !== pedido) return; // llegó una respuesta vieja
    C.datos = d; pintar(caja);
  } catch (e) { $('#ce-cuerpo', caja).innerHTML = `<p class="ce-vacio">No se pudieron cargar los tiempos: ${esc(e.message)}</p>`; }
}

/* ---------- datos por día ---------- */
function personasVisibles() {
  const d = C.datos; if (!d) return [];
  return d.personas.filter(p => !C.usuario || p.id === C.usuario);
}
function resumenDia(dia) {
  const out = { segundos: Object.fromEntries(ESTADOS.map(e => [e, 0])), conectado: 0, personas: [], sinSalida: 0, tarde: 0, enCurso: 0 };
  for (const p of personasVisibles()) {
    const x = C.datos.tiempos[p.id]?.porDia?.[dia];
    if (!x || !x.conectado) continue;
    ESTADOS.forEach(e => { out.segundos[e] += x.segundos[e] || 0; });
    out.conectado += x.conectado;
    out.personas.push({ p, x });
    if (x.sinSalida) out.sinSalida++;
    if (x.salida?.cargadaDespues) out.tarde++;
    if (x.enCurso) out.enCurso++;
  }
  return out;
}
/** Escala de horas común a todo el mes (por defecto 07:00–19:00, se amplía si hay tramos fuera). */
function escala() {
  let ini = 7 * 60, fin = 19 * 60;
  for (const p of personasVisibles()) for (const x of Object.values(C.datos.tiempos[p.id]?.porDia || {})) for (const t of x.tramos) {
    ini = Math.min(ini, Math.floor(minutosDelDia(t.ini) / 60) * 60);
    const f = minutosDelDia(t.fin);
    if (f !== 0) fin = Math.max(fin, Math.ceil(f / 60) * 60); // los días sin salida que llegan a medianoche no estiran la escala
  }
  return { ini, fin: Math.min(fin, 24 * 60) };
}
function lineaTiempo(tramos, esc0, { grande = false } = {}) {
  const ancho = esc0.fin - esc0.ini;
  const seg = tramos.map(t => {
    const a = Math.max(minutosDelDia(t.ini), esc0.ini), f0 = minutosDelDia(t.fin), b = Math.min(f0 === 0 ? 24 * 60 : f0, esc0.fin);
    if (b <= a) return '';
    return `<i class="${t.estimado ? 'est' : ''}" style="left:${(a - esc0.ini) / ancho * 100}%;width:${Math.max(0.6, (b - a) / ancho * 100)}%;--c:${color(t.estado)}" title="${esc(nombreEst(t.estado))}: ${hora(t.ini)}–${hora(t.fin)} (${durLarga(t.segundos)})${t.estimado ? ' · estimado, no marcó la salida' : ''}"></i>`;
  }).join('');
  if (!grande) return `<span class="ce-lt">${seg}</span>`;
  const marcas = [];
  for (let h = esc0.ini; h <= esc0.fin; h += 60) if (((h - esc0.ini) / 60) % (ancho > 12 * 60 ? 2 : 1) === 0) marcas.push(`<span style="left:${(h - esc0.ini) / ancho * 100}%">${String(h / 60).padStart(2, '0')}</span>`);
  return `<div class="ce-lt grande" role="img" aria-label="${esc(tramos.map(t => `${nombreEst(t.estado)} de ${hora(t.ini)} a ${hora(t.fin)}`).join('; '))}">${seg}</div><div class="ce-horas" aria-hidden="true">${marcas.join('')}</div>`;
}

/* ---------- pintar ---------- */
function pintar(caja) {
  const d = C.datos; if (!d) return;
  const [y, m] = C.mes.split('-').map(Number), n = ultimoDia(C.mes), hoy = d.hoy;
  const primerDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // lunes = 0
  const esc0 = escala();
  const uno = !!C.usuario || personasVisibles().length === 1;
  // Totales del mes
  const tot = { segundos: Object.fromEntries(ESTADOS.map(e => [e, 0])), conectado: 0, dias: 0, sinSalida: 0, tarde: 0 };
  for (let i = 1; i <= n; i++) {
    const r = resumenDia(ymd(y, m, i));
    if (r.conectado) tot.dias++;
    ESTADOS.forEach(e => { tot.segundos[e] += r.segundos[e]; }); tot.conectado += r.conectado; tot.sinSalida += r.sinSalida; tot.tarde += r.tarde;
  }
  if (!C.dia || C.dia.slice(0, 7) !== C.mes) {
    // Por defecto, hoy si es de este mes; si no, el último día con datos.
    C.dia = hoy.slice(0, 7) === C.mes ? hoy : null;
    if (!C.dia) for (let i = n; i >= 1; i--) if (resumenDia(ymd(y, m, i)).conectado) { C.dia = ymd(y, m, i); break; }
  }
  const celdas = [];
  for (let i = 0; i < primerDow; i++) celdas.push('<div class="ce-celda vacia" aria-hidden="true"></div>');
  for (let i = 1; i <= n; i++) {
    const dia = ymd(y, m, i), r = resumenDia(dia), futuro = dia > hoy, dow = (primerDow + i - 1) % 7;
    const clase = ['ce-celda', futuro ? 'futuro' : '', dow >= 5 ? 'finde' : '', dia === hoy ? 'hoy' : '', dia === C.dia ? 'sel' : '', r.conectado ? 'con' : 'sin', r.sinSalida ? 'alerta' : ''].filter(Boolean).join(' ');
    let cuerpo = '';
    if (futuro) cuerpo = '';
    else if (!r.conectado) cuerpo = '<span class="ce-nada">Sin actividad</span>';
    else if (uno) {
      const x = r.personas[0].x;
      cuerpo = `<b class="ce-total">${dur(r.conectado)}</b>${lineaTiempo(x.tramos, esc0)}
        <span class="ce-io">${hora(x.entrada)} – ${x.salida ? hora(x.salida.hora) : x.enCurso ? 'en curso' : '<em>sin salida</em>'}</span>`;
    } else {
      const total = r.conectado || 1;
      cuerpo = `<b class="ce-total">${dur(r.conectado)}</b>
        <span class="ce-dist">${ESTADOS.filter(e => r.segundos[e]).map(e => `<i style="width:${r.segundos[e] / total * 100}%;background:${color(e)}"></i>`).join('')}</span>
        <span class="ce-io">${r.personas.length} ${r.personas.length === 1 ? 'asesor' : 'asesores'}${r.personas.length > 1 ? ` · ${dur(r.conectado / r.personas.length)} c/u` : ''}</span>`;
    }
    const chips = `${r.sinSalida ? `<span class="ce-chip alerta" title="No marcó la salida">${uno ? '!' : r.sinSalida}</span>` : ''}${r.tarde ? `<span class="ce-chip tarde" title="Salida cargada después">${uno ? '◷' : r.tarde}</span>` : ''}`;
    const etiqueta = futuro ? `${diaLargo(dia)}, sin datos todavía` : !r.conectado ? `${diaLargo(dia)}, sin actividad`
      : `${diaLargo(dia)}: ${durLarga(r.conectado)} conectado${uno ? '' : ` entre ${r.personas.length} asesores`}${r.sinSalida ? ', con salida sin marcar' : ''}`;
    celdas.push(`<button type="button" class="${clase}" data-ce-dia="${dia}" ${futuro ? 'disabled' : ''} aria-label="${esc(etiqueta)}" aria-pressed="${dia === C.dia}">
      <span class="ce-num">${i}</span>${chips ? `<span class="ce-chips">${chips}</span>` : ''}${cuerpo}</button>`);
  }
  const quien = C.usuario ? (d.personas.find(p => p.id === C.usuario)?.nombre || '') : 'todo el equipo';
  $('#ce-cuerpo', caja).innerHTML = `
    <div class="ce-resumen" aria-label="Totales de ${esc(mesLargo(C.mes))}">
      <div class="ce-res-p"><span>Total conectado · ${esc(quien)}</span><b>${durLarga(tot.conectado)}</b><small>${tot.dias} ${tot.dias === 1 ? 'día con actividad' : 'días con actividad'}${tot.dias ? ` · promedio ${durLarga(tot.conectado / tot.dias)} por día` : ''}</small></div>
      ${ESTADOS.map(e => `<div class="ce-res-e"><span><i style="background:${color(e)}"></i>${esc(nombreEst(e))}</span><b>${durLarga(tot.segundos[e])}</b><small>${tot.conectado ? Math.round(tot.segundos[e] / tot.conectado * 100) : 0}% del tiempo</small></div>`).join('')}
      <div class="ce-res-e ${tot.sinSalida ? 'alerta' : ''}"><span>Salidas sin marcar</span><b>${tot.sinSalida + tot.tarde}</b><small>${tot.tarde} con motivo · ${tot.sinSalida} pendientes</small></div>
    </div>
    <div class="ce-cal" role="grid" aria-label="${esc(mesLargo(C.mes))}">
      ${DIAS.map((x, i) => `<div class="ce-dow ${i >= 5 ? 'finde' : ''}" role="columnheader">${x}</div>`).join('')}
      ${celdas.join('')}
    </div>
    <section class="ce-detalle" id="ce-detalle" aria-live="polite">${detalleDia(C.dia, esc0)}</section>`;
}

function detalleDia(dia, esc0) {
  if (!dia) return '<p class="ce-vacio">No hay actividad en este mes. Elegí otro mes u otro asesor.</p>';
  const r = resumenDia(dia);
  const titulo = `<h4 class="ce-det-t">${esc(diaLargo(dia))}</h4>`;
  if (!r.personas.length) return `${titulo}<p class="ce-vacio">Sin actividad registrada ese día${C.usuario ? ' para este asesor' : ''}.</p>`;
  r.personas.sort((a, b) => b.x.conectado - a.x.conectado);
  return `${titulo}
    ${r.personas.length > 1 ? `<p class="ce-det-sub">${r.personas.length} asesores · ${durLarga(r.conectado)} conectados en total</p>` : ''}
    <div class="ce-det-lista">${r.personas.map(({ p, x }) => {
      const sal = x.salida
        ? (x.salida.cargadaDespues
          ? `<span class="ce-st tarde">Salida cargada al día siguiente: ${hora(x.salida.hora)}</span><span class="ce-motivo">Motivo: ${esc(x.salida.motivo || 'sin detalle')}</span>`
          : `<span class="ce-st ok">Salida marcada a las ${hora(x.salida.hora)}</span>`)
        : x.enCurso ? '<span class="ce-st curso">Jornada en curso</span>'
        : `<span class="ce-st alerta">No marcó la salida${x.sinSalida ? ' · todavía no indicó el motivo' : ''}</span>`;
      return `<article class="ce-persona">
        <header><b>${esc(p.nombre)}</b><small>${esc(p.rol)}${p.sucursal ? ' · ' + esc(p.sucursal) : ''}</small>
          <span class="ce-io-g">Entrada ${hora(x.entrada)}</span>${sal}</header>
        ${lineaTiempo(x.tramos, esc0, { grande: true })}
        ${x.estimado ? `<p class="ce-nota-est">No marcó la salida: el último estado se cuenta hasta la salida de su turno (${hora(x.tramos.at(-1).fin)}), rayado en la línea de tiempo.</p>` : ''}
        <div class="ce-chips-est">${ESTADOS.filter(e => x.segundos[e]).map(e => `<span><i style="background:${color(e)}"></i>${esc(nombreEst(e))} <b>${durLarga(x.segundos[e])}</b></span>`).join('')}<span class="ce-tot">Total <b>${durLarga(x.conectado)}</b></span></div>
        <details class="ce-tramos"><summary>Ver los ${x.tramos.length} ${x.tramos.length === 1 ? 'cambio de estado' : 'cambios de estado'}</summary>
          <table><thead><tr><th>Estado</th><th>Desde</th><th>Hasta</th><th class="num">Duración</th></tr></thead>
          <tbody>${x.tramos.map(t => `<tr><td><i style="background:${color(t.estado)}"></i>${esc(nombreEst(t.estado))}</td><td>${hora(t.ini)}</td><td>${hora(t.fin)}</td><td class="num">${durLarga(t.segundos)}</td></tr>`).join('')}</tbody></table></details>
      </article>`;
    }).join('')}</div>`;
}
