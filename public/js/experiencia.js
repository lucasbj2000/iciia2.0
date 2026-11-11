/* IMPAR · Experiencia: paleta de comandos (Ctrl+K), barra inferior en el celular, gestos en las tarjetas,
   modo foco, vibración con sentido, sello de venta, esqueleto del tablero e Inicio (Mi día + portada del mes). */
import { $, $$, S, esc, get, gs, ago, etapa, toast, vibrar, nombreLegible, iniciales } from './core.js';
import { ic } from './iconos.js';

const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Navega con el mismo botón del menú (importar app.js crearía otra copia de la app).
const irA = v => $(`#nav [data-nav="${v}"]`)?.click();
const abrirFicha = id => import('./ficha.js').then(m => m.fichaNeg(id));

/* ================= Arranque ================= */
let listo = false;
export function iniciarExperiencia() {
  if (listo) return; listo = true;
  document.addEventListener('keydown', teclas);
  pintarBarraMovil();
  window.addEventListener('impar:vista', marcarBarra);
  // Un toque corto cuando entra un cliente nuevo (solo en el celular, y si la pestaña está a la vista).
  window.addEventListener('impar:cliente-nuevo', () => { if (document.visibilityState === 'visible' && matchMedia('(pointer:coarse)').matches) vibrar(25); });
  window.addEventListener('impar:salir', () => { cerrarPaleta(); document.body.classList.remove('modo-foco'); });
}

function teclas(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirPaleta(); return; }
  if (document.body.classList.contains('modo-foco') && e.altKey && e.key === 'ArrowDown') { e.preventDefault(); siguienteEnEspera(); }
}

/* ================= Paleta de comandos ================= */
let negCache = { t: 0, lista: [] };
async function negociaciones() {
  if (S.negociaciones?.length) return S.negociaciones;
  if (Date.now() - negCache.t < 60000) return negCache.lista;
  try { negCache = { t: Date.now(), lista: await get('/negociaciones') }; } catch { /* sin conexión: solo comandos */ }
  return negCache.lista;
}
function comandos() {
  const secciones = $$('#nav [data-nav]').map(b => ({
    tipo: 'Ir a', titulo: b.textContent.trim(), icono: 'flecha-der', clave: b.textContent.trim(),
    hacer: () => b.click()
  }));
  return [
    ...secciones,
    { tipo: 'Acción', titulo: 'Siguiente cliente que espera respuesta', icono: 'reloj', clave: 'siguiente espera responder', hacer: siguienteEnEspera },
    { tipo: 'Acción', titulo: 'Cambiar mi disponibilidad', icono: 'usuario', clave: 'disponible disponibilidad estado', hacer: () => $('#disp-pill')?.click() },
    { tipo: 'Acción', titulo: 'Ver notificaciones', icono: 'campana', clave: 'avisos notificaciones', hacer: () => $('#noti-btn')?.click() },
    { tipo: 'Acción', titulo: 'Cambiar tema claro u oscuro', icono: 'ajustes', clave: 'tema oscuro claro', hacer: () => $('#btn-tema')?.click() },
    { tipo: 'Acción', titulo: 'Cerrar sesión', icono: 'salir', clave: 'salir cerrar sesion', hacer: () => $('#btn-salir')?.click() }
  ];
}
const sinAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function abrirPaleta() {
  if ($('#paleta')) { $('#paleta-q').focus(); return; }
  const capa = document.createElement('div');
  capa.id = 'paleta'; capa.className = 'paleta-capa';
  capa.innerHTML = `<div class="paleta" role="dialog" aria-modal="true" aria-label="Buscar en el CRM">
    <label class="paleta-buscar">${ic('buscar')}<span class="sr">Buscar cliente, sección o acción</span>
      <input id="paleta-q" autocomplete="off" placeholder="Buscar cliente, teléfono, sección o acción…"></label>
    <ul id="paleta-r" class="paleta-r" role="listbox"></ul>
    <p class="paleta-pie"><kbd>↑</kbd><kbd>↓</kbd> elegir · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> cerrar</p></div>`;
  document.body.append(capa);
  const q = $('#paleta-q'), ul = $('#paleta-r');
  let items = [], sel = 0;
  const negs = negociaciones();
  const pintar = async () => {
    const t = sinAcento(q.value.trim());
    const cmd = comandos().filter(c => !t || sinAcento(c.titulo + ' ' + c.clave).includes(t)).slice(0, t ? 6 : 8);
    let clientes = [];
    if (t.length >= 2) {
      const lista = await negs, dig = t.replace(/\D/g, '');
      clientes = lista.filter(n => sinAcento(n.cliente).includes(t) || (dig.length >= 3 && String(n.tel || '').includes(dig)))
        .slice(0, 7).map(n => ({ tipo: etapa(n.etapa).nombre, titulo: nombreLegible(n.cliente) || n.tel, sub: [n.tel, n.agente_nombre].filter(Boolean).join(' · '),
          color: etapa(n.etapa).color, icono: 'usuario', hacer: () => abrirFicha(n.id) }));
    }
    items = [...clientes, ...cmd]; sel = Math.min(sel, Math.max(0, items.length - 1));
    ul.innerHTML = items.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}" class="${i === sel ? 'sel' : ''}">
        <span class="paleta-ic" ${it.color ? `style="--c:${esc(it.color)}"` : ''}>${ic(it.icono)}</span>
        <span class="paleta-t"><b>${esc(it.titulo)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span><span class="paleta-tipo">${esc(it.tipo)}</span></li>`).join('')
      || '<li class="paleta-vacio">Sin resultados. Probá con el nombre o el teléfono del cliente.</li>';
    $$('li[data-i]', ul).forEach(li => { li.onclick = () => elegir(Number(li.dataset.i)); li.onmousemove = () => { if (sel !== +li.dataset.i) { sel = +li.dataset.i; marcar(); } }; });
  };
  const marcar = () => $$('li[data-i]', ul).forEach(li => { const s = +li.dataset.i === sel; li.classList.toggle('sel', s); li.setAttribute('aria-selected', s); if (s) li.scrollIntoView({ block: 'nearest' }); });
  const elegir = i => { const it = items[i]; if (!it) return; cerrarPaleta(); it.hacer(); };
  let espera; q.oninput = () => { clearTimeout(espera); sel = 0; espera = setTimeout(pintar, 90); };
  q.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); marcar(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); marcar(); }
    else if (e.key === 'Enter') { e.preventDefault(); elegir(sel); }
    else if (e.key === 'Escape') cerrarPaleta();
  };
  capa.onclick = e => { if (e.target === capa) cerrarPaleta(); };
  await pintar(); q.focus();
}
function cerrarPaleta() { $('#paleta')?.remove(); }

/* ================= Barra inferior (celular) ================= */
function pintarBarraMovil() {
  if ($('#barra-movil')) return;
  const b = document.createElement('nav');
  b.id = 'barra-movil'; b.setAttribute('aria-label', 'Accesos rápidos');
  b.innerHTML = `
    <button type="button" data-bm="inicio">${ic('casa')}<span>Inicio</span></button>
    <button type="button" data-bm="neg">${ic('tablero')}<span>Tablero</span></button>
    <button type="button" data-bm="buscar">${ic('buscar')}<span>Buscar</span></button>
    <button type="button" data-bm="avisos">${ic('campana')}<span>Avisos</span><i class="bm-n" hidden></i></button>
    <button type="button" data-bm="menu">${ic('menu')}<span>Más</span></button>`;
  $('#app').append(b);
  b.onclick = e => {
    const t = e.target.closest('[data-bm]')?.dataset.bm; if (!t) return;
    vibrar(8);
    if (t === 'avisos') $('#noti-btn')?.click();
    else if (t === 'menu') $('#btn-burger')?.click();
    else if (t === 'buscar') abrirPaleta();
    else irA(t);
  };
  // El número de avisos se copia del de arriba.
  const n = $('#noti-n');
  if (n) new MutationObserver(() => { const v = n.textContent.trim(), i = $('#barra-movil .bm-n'); i.textContent = v; i.hidden = !v || v === '0'; }).observe(n, { childList: true, characterData: true, subtree: true });
  marcarBarra();
}
function marcarBarra() { $$('#barra-movil [data-bm]').forEach(x => x.classList.toggle('activo', x.dataset.bm === S.vista)); }

/* ================= Gestos en las tarjetas (celular) ================= */
export function gestosTarjeta(el, id) {
  if (!matchMedia('(pointer:coarse)').matches || el.dataset.gestos) return;
  el.dataset.gestos = '1';
  let x0 = 0, y0 = 0, dx = 0, horizontal = null, largo = null, movio = false;
  el.addEventListener('touchstart', e => {
    const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; horizontal = null; movio = false;
    largo = setTimeout(() => { if (!movio) { vibrar(12); vistaPrevia(el, id); } }, 480);
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    const t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
    if (Math.abs(mx) > 8 || Math.abs(my) > 8) { movio = true; clearTimeout(largo); }
    if (horizontal === null && (Math.abs(mx) > 10 || Math.abs(my) > 10)) horizontal = Math.abs(mx) > Math.abs(my) * 1.4;
    if (!horizontal) return;
    dx = Math.max(-120, Math.min(120, mx));
    el.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
    el.classList.toggle('gesto-der', dx > 60); el.classList.toggle('gesto-izq', dx < -60);
  }, { passive: true });
  el.addEventListener('touchend', () => {
    clearTimeout(largo);
    el.style.transform = ''; el.classList.remove('gesto-der', 'gesto-izq');
    if (!horizontal) return;
    if (dx > 80) { vibrar(10); abrirFicha(id); }
    else if (dx < -80) { vibrar(10); hojaAcciones(id); }
  });
  // El clic que sigue a un gesto no abre la ficha dos veces.
  el.addEventListener('click', e => { if (horizontal || $('#vista-previa')) { e.stopImmediatePropagation(); e.preventDefault(); horizontal = null; } }, true);
}
function vistaPrevia(el, id) {
  const n = S.negociaciones.find(x => x.id === id); if (!n) return;
  const r = el.getBoundingClientRect();
  const p = document.createElement('div'); p.id = 'vista-previa'; p.className = 'vista-previa';
  p.style.setProperty('--y', Math.min(innerHeight - 240, r.bottom + 8) + 'px');
  p.innerHTML = `<b>${esc(nombreLegible(n.cliente) || '—')}</b>
    <span class="hv-etapa" style="--c:${esc(etapa(n.etapa).color)}">${esc(etapa(n.etapa).nombre)}</span>
    <dl><dt>Teléfono</dt><dd>${esc(n.tel || '—')}</dd><dt>Responsable</dt><dd>${esc(n.agente_nombre || 'Sin asignar')}</dd>
    <dt>En esta etapa</dt><dd>hace ${ago(n.entrada_etapa)}</dd>${n.valor ? `<dt>Valor</dt><dd>${gs(n.valor)}</dd>` : ''}</dl>
    <small>Soltá para cerrar · Deslizá → para responder, ← para mover</small>`;
  document.body.append(p);
  const fuera = () => { p.remove(); document.removeEventListener('touchend', fuera); };
  setTimeout(() => document.addEventListener('touchend', fuera), 0);
}
function hojaAcciones(id) {
  const n = S.negociaciones.find(x => x.id === id); if (!n) return;
  const capa = document.createElement('div'); capa.className = 'hoja-acciones-capa';
  capa.innerHTML = `<div class="hoja-acciones" role="dialog" aria-label="Acciones">
    <b>${esc(nombreLegible(n.cliente) || '—')}</b><small>Mover a otra etapa</small>
    <div class="ha-etapas">${(S.empresa.etapas || []).filter(e => e.id !== n.etapa).map(e =>
      `<button type="button" data-ha="${e.id}" style="--c:${esc(e.color)}">${esc(e.nombre)}</button>`).join('')}</div>
    <button type="button" class="btn ghost block" data-ha-abrir>${ic('transferir')} Abrir para transferir o responder</button>
    <button type="button" class="btn ghost block" data-ha-cerrar>Cancelar</button></div>`;
  document.body.append(capa);
  const cerrarHoja = () => capa.remove();
  capa.onclick = async e => {
    if (e.target === capa || e.target.closest('[data-ha-cerrar]')) return cerrarHoja();
    if (e.target.closest('[data-ha-abrir]')) { cerrarHoja(); return abrirFicha(id); }
    const d = e.target.closest('[data-ha]')?.dataset.ha;
    if (d) { cerrarHoja(); (await import('./negociaciones.js')).mover(id, d); }
  };
}

/* ================= Modo foco y siguiente cliente ================= */
export async function siguienteEnEspera(actual = $('#modals [data-ficha-id]')?.dataset.fichaId) {
  const lista = (await negociaciones()).filter(n => n.etapa === 'espera' && n.id !== actual)
    .sort((a, b) => new Date(a.entrada_etapa) - new Date(b.entrada_etapa));
  if (!lista.length) { toast('No hay más clientes esperando respuesta. ¡Buen trabajo!', 'ok', 'Al día'); return; }
  abrirFicha(lista[0].id);
}
export function conectarFicha(id) {
  const raiz = $('#modals .ficha-h'); if (!raiz) return;
  raiz.dataset.fichaId = id;
  const foco = $('#f-foco'), sig = $('#f-sig');
  const pintarFoco = () => { const on = document.body.classList.contains('modo-foco'); foco?.setAttribute('aria-pressed', on); if (foco) foco.title = on ? 'Salir del modo foco' : 'Modo foco: solo la conversación'; };
  if (foco) foco.onclick = () => { document.body.classList.toggle('modo-foco'); pintarFoco(); };
  if (sig) sig.onclick = () => siguienteEnEspera(id);
  pintarFoco();
}

/* ================= Sello de venta ================= */
export function sellar(el) {
  if (!el) return;
  el.querySelector('.sello')?.remove();
  const s = document.createElement('span'); s.className = 'sello'; s.textContent = 'GANADO';
  el.append(s);
}

/* ================= Esqueleto del tablero ================= */
export function esqueletoTablero() {
  const col = n => `<div class="esq-col"><div class="esq-h"></div>${Array.from({ length: n }, () => '<div class="esq-card"><i></i><i></i><i></i></div>').join('')}</div>`;
  return `<div class="esq-tablero" aria-busy="true" aria-label="Cargando el tablero">${col(3)}${col(4)}${col(2)}${col(3)}${col(1)}</div>`;
}

/* ================= Inicio: Mi día + portada del mes ================= */
const ymd = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const minTxt = m => m == null ? '—' : m < 1 ? `${Math.max(1, Math.round(m * 60))} s` : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export async function vistaInicio() {
  const v = $('#view');
  v.innerHTML = `<div class="section inicio fx-vista"><div class="esq-inicio"><i></i><i></i><i></i></div></div>`;
  const hoy = new Date(), iniMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const iniAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const finAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, Math.min(hoy.getDate(), new Date(hoy.getFullYear(), hoy.getMonth(), 0).getDate()));
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  const mando = ['admin', 'gerente', 'jefe'].includes(S.usuario.rol);
  const [negs, sem, mes, ant] = await Promise.all([
    get('/negociaciones').catch(() => []),
    get(`/reportes?desde=${ymd(lunes)}&hasta=${ymd(hoy)}`).catch(() => null),
    mando ? get(`/reportes?desde=${ymd(iniMes)}&hasta=${ymd(hoy)}`).catch(() => null) : null,
    mando ? get(`/reportes?desde=${ymd(iniAnt)}&hasta=${ymd(finAnt)}`).catch(() => null) : null
  ]);
  if (S.vista !== 'inicio') return;
  S.negociaciones = negs;
  const mias = S.usuario.rol === 'agente' ? negs : negs.filter(n => n.agente_id === S.usuario.id);
  const base = mias.length || S.usuario.rol === 'agente' ? mias : negs;
  const espera = base.filter(n => n.etapa === 'espera').sort((a, b) => new Date(a.entrada_etapa) - new Date(b.entrada_etapa));
  const seguir = base.filter(n => n.etapa === 'contactado');
  const ganadasSem = (sem?.negociaciones || []).filter(n => n.etapa === 'ganado' && (S.usuario.rol !== 'agente' || n.agente_id === S.usuario.id));
  const yo = sem?.tiempos?.personas?.find(p => p.id === S.usuario.id);
  const equipo = sem?.tiempos?.agente;
  const nombre = S.usuario.nombre.split(' ')[0];
  const hora = hoy.getHours(), saludo = hora < 12 ? 'Buen día' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';

  v.innerHTML = `<div class="section inicio fx-vista">
    <header class="inicio-cab"><div><h1>${saludo}, ${esc(nombre)}</h1>
      <p class="sub">${espera.length ? `Tenés ${espera.length} ${espera.length === 1 ? 'cliente esperando' : 'clientes esperando'} respuesta. Empezá por el que más espera.` : 'No tenés clientes esperando. Todo al día.'}</p></div>
      <div class="inicio-acc"><button class="btn" id="in-sig" ${espera.length ? '' : 'disabled'}>${ic('responder')} Responder al siguiente</button>
        <button class="btn ghost" id="in-tab">${ic('tablero')} Ir al tablero</button></div></header>
    <div class="inicio-kpis">
      ${kpi('Esperando respuesta', espera.length, espera.length ? `El más antiguo, hace ${ago(espera[0].entrada_etapa)}` : 'Ninguno', espera.length ? 'warn' : 'ok')}
      ${kpi('En seguimiento', seguir.length, 'Contactados sin respuesta todavía', '')}
      ${kpi('Ventas de la semana', ganadasSem.length, ganadasSem.length ? gs(ganadasSem.reduce((s, n) => s + Number(n.monto_cierre || 0), 0)) : 'Todavía ninguna', 'ok')}
      ${kpi(yo ? 'Tu respuesta promedio' : 'Respuesta del equipo', minTxt((yo || equipo)?.promedio), yo && equipo?.promedio ? (yo.promedio <= equipo.promedio ? 'Más rápido que el promedio del equipo' : 'El equipo responde un poco más rápido') : 'Esta semana, en horario laboral', '')}
    </div>
    <div class="inicio-grid">
      <section class="card-box pliego"><h3>${ic('reloj')} Esperando respuesta</h3>
        ${espera.length ? `<ol class="inicio-lista">${espera.slice(0, 8).map(n => fila(n)).join('')}</ol>` : '<p class="sub">Nadie esperando. Aprovechá para hacer seguimientos.</p>'}</section>
      <section class="card-box pliego"><h3>${ic('calendario')} Para hacer seguimiento</h3>
        ${seguir.length ? `<ol class="inicio-lista">${seguir.sort((a, b) => new Date(a.entrada_etapa) - new Date(b.entrada_etapa)).slice(0, 8).map(n => fila(n)).join('')}</ol>` : '<p class="sub">Sin seguimientos pendientes.</p>'}</section>
    </div>
    ${mando && mes ? portada(mes, ant, hoy) : ''}
    <p class="inicio-tip">${ic('rayo')} Atajo: <kbd>Ctrl</kbd> + <kbd>K</kbd> para buscar un cliente o ir a cualquier sección.</p>
  </div>`;
  $('#in-sig').onclick = () => siguienteEnEspera(null);
  $('#in-tab').onclick = () => irA('neg');
  $$('[data-in-neg]').forEach(b => b.onclick = () => abrirFicha(b.dataset.inNeg));
  if ($('#in-rep')) $('#in-rep').onclick = () => irA('rep');
  if (!reducido()) $$('.inicio-kpi b[data-n]').forEach(contar);
}
const kpi = (t, v, sub, tono) => `<div class="inicio-kpi pliego ${tono}"><span>${t}</span><b ${typeof v === 'number' ? `data-n="${v}"` : ''}>${v}</b><small>${esc(sub)}</small></div>`;
const fila = n => `<li><button type="button" data-in-neg="${n.id}"><span class="avatar sm">${esc(iniciales(nombreLegible(n.cliente) || '?'))}</span>
  <span class="il-t"><b>${esc(nombreLegible(n.cliente) || n.tel || '—')}</b><small>${esc(n.agente_nombre || 'Sin asignar')} · hace ${ago(n.entrada_etapa)}</small></span>${ic('flecha-der')}</button></li>`;
function contar(el) {
  const fin = Number(el.dataset.n); if (!fin) return;
  const t0 = performance.now();
  const paso = t => { const k = Math.min(1, (t - t0) / 700); el.textContent = Math.round(fin * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(paso); };
  requestAnimationFrame(paso);
}

/* Portada del mes para dirección: tres cifras, la sucursal del mes y una frase automática. */
function portada(mes, ant, hoy) {
  const ganadas = l => (l?.negociaciones || []).filter(n => n.etapa === 'ganado');
  const total = l => ganadas(l).reduce((s, n) => s + Number(n.monto_cierre || 0), 0);
  const gm = ganadas(mes), montoMes = total(mes), montoAnt = total(ant);
  const porSuc = l => { const m = new Map(); for (const n of ganadas(l)) m.set(n.sucursal || 'Sin sucursal', (m.get(n.sucursal || 'Sin sucursal') || 0) + Number(n.monto_cierre || 0)); return m; };
  const sm = porSuc(mes), sa = porSuc(ant);
  const lider = [...sm].sort((a, b) => b[1] - a[1])[0];
  const crec = [...sm].map(([s, v]) => [s, pct(v, sa.get(s) || 0)]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1])[0];
  const varVentas = pct(montoMes, montoAnt);
  const nomAnt = MESES[(hoy.getMonth() + 11) % 12];
  const frases = [];
  if (varVentas != null) frases.push(`Las ventas van ${Math.abs(varVentas)} % ${varVentas >= 0 ? 'arriba' : 'abajo'} de ${nomAnt} a esta misma altura del mes.`);
  if (crec && crec[1] > 0) frases.push(`${crec[0]} es la sucursal que más creció: ${crec[1]} % más que en ${nomAnt}.`);
  const resp = mes.tiempos?.agente, respAnt = ant?.tiempos?.agente;
  if (resp?.promedio != null && respAnt?.promedio) { const d = pct(resp.promedio, respAnt.promedio); if (d) frases.push(`El equipo responde ${Math.abs(d)} % ${d < 0 ? 'más rápido' : 'más lento'} que en ${nomAnt}.`); }
  return `<section class="portada pliego" aria-label="Resumen del mes">
    <header><span class="portada-sello">Informe de ${MESES[hoy.getMonth()]} ${hoy.getFullYear()}</span><h2>El mes de IMPAR, en una hoja</h2></header>
    <div class="portada-cifras">
      <div><b>${gs(montoMes)}</b><span>vendido en el mes</span>${varVentas != null ? `<em class="${varVentas >= 0 ? 'sube' : 'baja'}">${varVentas >= 0 ? '▲' : '▼'} ${Math.abs(varVentas)} %</em>` : ''}</div>
      <div><b>${gm.length}</b><span>ventas cerradas</span></div>
      <div><b>${minTxt(resp?.promedio)}</b><span>respuesta promedio de agentes</span></div>
    </div>
    ${lider ? `<div class="portada-lider"><span>Sucursal del mes</span><b>${esc(lider[0])}</b><small>${gs(lider[1])}</small></div>` : ''}
    ${frases.length ? `<ul class="portada-frases">${frases.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <button class="btn ghost sm" id="in-rep">${ic('grafico')} Ver reportes completos</button>
  </section>`;
}
