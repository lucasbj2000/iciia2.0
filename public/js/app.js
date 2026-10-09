/* ============ Arranque, navegación y realtime ============ */
import {
  $, $$, esc, S, api, get, post, patch, toast, modal, cerrar, ago, iniciales,
  fechaISO, saludo, fx, esAdmin, aplicarTema, aplicarFX, salir, DISPONIBILIDAD,
  vacio, confeti, vibrar
} from './core.js';
import { vistaNegociaciones, patchTarjeta, quitarTarjetas } from './negociaciones.js';
import { vistaContactos } from './contactos.js';
import { vistaComunicacion, vistaCalendario, vistaReportes, vistaConfig, refrescarChat } from './modulos.js';
import { fichaNeg, refrescarFicha, confirmarEnvio } from './ficha.js';
import { vistaAdmin } from './admin.js';
import { vistaOrganigrama } from './organigrama.js';
import { vistaProyecto } from './proyecto.js';
import { iniciarViewport } from './viewport.js';

import { iniciarPWA, notificarApp } from './pwa.js';
import { cargarNotas, cargarCambiosNeg } from './colaboracion.js';

iniciarViewport();
iniciarPWA(id=>fichaNeg(id).catch(e=>toast(e.message,'bad')));

const NAV = [
  { id: 'neg', t: 'Negociaciones', ic: '◫', mod: 'negociaciones' },
  { id: 'con', t: 'Contactos', ic: '◎', mod: 'contactos' },
  { id: 'com', t: 'Comunicación', ic: '✉', mod: 'comunicacion', flag: 'comunicacion' },
  { id: 'cal', t: 'Calendario', ic: '▦', mod: 'calendario', flag: 'calendario' },
  { id: 'rep', t: 'Reportes', ic: '▤', mod: 'reportes' },
  { id: 'proy', t: 'Avances del CRM', ic: '◷', proyecto: true },
  { id: 'cfg', t: 'Configuración', ic: '⚙', mod: 'configuracion' },
  { id: 'org', t: 'Organigrama', ic: '▥', mando: true },
  { id: 'adm', t: 'Administración', ic: '★', admin: true }
];
const VISTAS = { neg: vistaNegociaciones, con: vistaContactos, com: vistaComunicacion,
  cal: vistaCalendario, rep: vistaReportes, proy: vistaProyecto, cfg: vistaConfig, org: vistaOrganigrama, adm: vistaAdmin };
const TITULOS = { neg: 'Negociaciones', con: 'Contactos', com: 'Comunicación interna',
  cal: 'Calendario', rep: 'Reportes', proy: 'Avances del proyecto CRM', cfg: 'Configuración', org: 'Organigrama', adm: 'Administración' };

/* ================= LOGIN ================= */
$('#form-login').onsubmit = async e => {
  e.preventDefault();
  const btn = $('#l-btn'), err = $('#l-err');
  err.textContent = ''; btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Ingresando…';
  try {
    const r = await api('/login', { method: 'POST', body: {
      usuario: $('#l-usr').value.trim(), password: $('#l-pwd').value } });
    S.token = r.token; localStorage.setItem('iciia_token', r.token);
    S.usuario = r.usuario; S.empresa = r.empresa;
    await arrancar(true);
  } catch (ex) {
    err.textContent = ex.message;
    const c = $('.login-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
    vibrar([30, 60, 30]);
  } finally { btn.disabled = false; btn.textContent = 'Ingresar'; }
};

/* ================= ARRANQUE ================= */
async function arrancar(fresco) {
  const ctx = await get('/contexto');
  S.usuario = ctx.usuario; S.empresa = ctx.empresa;
  S.sucursales = ctx.sucursales; S.empresas = ctx.empresas || [];
  if (!S.empresa) toast('No hay ninguna empresa activa. Creá la primera desde Administración.', 'warn', 'Sin empresa');

  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  try { S.proyectoAcceso = await get('/proyecto/acceso'); }
  catch { S.proyectoAcceso = { visible: esAdmin(), admin: esAdmin() }; }
  aplicarTema(); aplicarFX(); aplicarMarca(); pintarNav();
  await cargarNotificaciones();
  conectarRealtime(); reloj(); cargarClima();

  S.vista = 'neg';
  await render();

  if (fresco) {
    toast(`${saludo()}, ${S.usuario.nombre.split(' ')[0]}. Sesión en ${S.empresa?.nombre || 'iciia2.0'}.`, 'ok', 'Bienvenido');
    setTimeout(() => {
      if (S.usuario.rol !== 'admin' && fx('natalicioObligatorio') && !S.usuario.nacimiento) modalNacimiento();
      else if (S.usuario.rol !== 'admin') modalDisponibilidad();
    }, 800);
  }

}

export function aplicarMarca() {
  const e = S.empresa;
  document.documentElement.style.setProperty('--brand', '#75b936');
  $('#b-name').textContent = e?.nombre || 'iciia2.0';
  $('#b-emp').textContent = `Expertos en papel · ${S.usuario.sucursal || 'IMPAR'}`;
  const img = $('#b-logo');
  if (e?.logo) { img.src = e.logo; img.hidden = false; } else img.hidden = true;
  $('#me-name').textContent = S.usuario.nombre;
  $('#me-rol').innerHTML = `<span class="badge-rol">${S.usuario.rol}</span>`;
  $('#me-av').innerHTML = S.usuario.foto ? `<img src="${esc(S.usuario.foto)}" alt="">` : iniciales(S.usuario.nombre);
  pintarDisponibilidad();
}
export function aplicarFXGlobal() { aplicarFX(); }

function pintarDisponibilidad() {
  const d = DISPONIBILIDAD.find(x => x.id === S.usuario.disponibilidad) || DISPONIBILIDAD[0];
  $('#disp-dot').style.background = d.c;
  $('#disp-txt').textContent = d.t;
}

export function pintarNav() {
  const mods = S.empresa?.modulos || [];
  $('#nav').innerHTML = NAV
    .filter(n => n.proyecto ? (esAdmin() || !!S.proyectoAcceso?.visible) : n.mando ? ['admin','gerente'].includes(S.usuario.rol) : n.admin ? esAdmin() : ((esAdmin() || mods.includes(n.mod)) && (!n.flag || fx(n.flag))))
    .map(n => `<button class="nav-i ${S.vista === n.id ? 'active' : ''}" data-nav="${n.id}">
      <span class="ic">${n.ic}</span>${n.t}${n.id === 'com' ? '<span class="bdg" style="display:none"></span>' : ''}</button>`).join('')
    ;

  $$('[data-nav]').forEach(b => b.onclick = () => ir(b.dataset.nav));

}

export async function ir(v) {
  S.vista = v;
  document.body.classList.remove('nav-open');
  pintarNav();
  await render();
}

async function render() {
  $('#v-title').textContent = TITULOS[S.vista];
  try { await (VISTAS[S.vista])(); }
  catch (e) {
    $('#view').innerHTML = `<div class="section"><div class="card-box">
      ${vacio('⚠', 'No se pudo cargar la vista', e.message)}</div></div>`;
  }
}

/* ================= REALTIME ================= */
function conectarRealtime() {
  if (window._sse) window._sse.close();
  if (!S.empresa) return;
  const es = new EventSource(`/api/stream?token=${encodeURIComponent(S.token)}&empresa=${S.empresa.id}`);
  window._sse = es;

  es.addEventListener('neg:patch', e => {
    const datos = JSON.parse(e.data), { id } = datos;
    confirmarEnvio(datos);
    if (S.vista === 'neg') patchTarjeta(id);
    refrescarFicha(id).catch(() => {});
  });
  es.addEventListener('neg:nueva', e => { if (S.vista === 'neg') patchTarjeta(JSON.parse(e.data).id, { nueva: true }); });
  es.addEventListener('neg:borradas', e => { if (S.vista === 'neg') quitarTarjetas(JSON.parse(e.data).ids); });
  es.addEventListener('neg:recargar', () => { if (S.vista === 'neg') vistaNegociaciones(); });
  es.addEventListener('ubicacion', e => { if (S.vista === 'neg') patchTarjeta(JSON.parse(e.data).negociacionId, { destacar: true }); });
  es.addEventListener('notas:actualizadas', e => {
    const { id } = JSON.parse(e.data);
    if ($('.conversation-modal')?.dataset.negociacionId !== id) return;
    if ($('#t-notas') && !$('#t-notas').classList.contains('hidden')) cargarNotas(id).catch(()=>{});
    if ($('#t-his') && !$('#t-his').classList.contains('hidden')) cargarCambiosNeg(id).catch(()=>{});
  });
  es.addEventListener('noti', e => {
    const n = JSON.parse(e.data);
    toast(n.msg, n.tono, n.titulo);
    notificarApp(n);
    if (n.tipo === 'ganado') confeti(40);
    cargarNotificaciones();
  });
  es.addEventListener('com', e => { if (S.vista === 'com') refrescarChat(JSON.parse(e.data)); else cargarNotificaciones(); });
  es.addEventListener('calendario', () => { if (S.vista === 'cal') vistaCalendario(); });
  es.addEventListener('proyecto:permisos', async () => {
    try {
      S.proyectoAcceso = await get('/proyecto/acceso');
      if (S.vista === 'proy' && !S.proyectoAcceso.visible && !esAdmin()) ir('neg');
      else pintarNav();
    } catch { /* El API comprueba permisos de acceso igualmente. */ }
  });
  es.addEventListener('proyecto', () => {
    if (S.vista === 'proy' && !$('#view input:focus') && !$('#view textarea:focus') && !$('#modals .mask')) vistaProyecto();
  });
  es.addEventListener('config', async () => {
    const ctx = await get('/contexto');
    S.empresa = ctx.empresa; S.sucursales = ctx.sucursales;
    aplicarMarca(); aplicarFX(); pintarNav();
  });
  es.addEventListener('canal:estado', e => {
    const d = JSON.parse(e.data);
    if (S.vista === 'adm') render();
    toast(`Canal ${d.estado === 'conectado' ? 'conectado ✓' : 'desconectado'}`,
      d.estado === 'conectado' ? 'ok' : 'warn', 'WhatsApp');
  });
  es.onerror = () => { /* EventSource reconecta solo */ };
}

/* ================= NOTIFICACIONES ================= */
async function cargarNotificaciones() {
  if (!fx('notificaciones')) return;
  try {
    S.notificaciones = await get('/notificaciones');
    const n = S.notificaciones.filter(x => !x.leida).length;
    $('#noti-n').textContent = n || '';
    $('#noti-btn').style.borderColor = n ? 'var(--brand)' : 'var(--line)';
  } catch (e) {}
}

$('#noti-btn').onclick = e => {
  e.stopPropagation();
  const ex = $('#noti-panel'); if (ex) { ex.remove(); return; }
  const p = document.createElement('div'); p.id = 'noti-panel';
  p.innerHTML = `<div style="padding:13px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px">
     <b style="flex:1;font-size:var(--fs-sm)">Notificaciones</b>
     <button class="btn ghost sm" id="n-todas">Marcar leídas</button></div>
   ${S.notificaciones.slice(0, 40).map(n => `<div class="nitem ${n.leida ? '' : 'unread'}" data-noti="${n.id}"
     data-ref="${n.ref || ''}" data-tipo="${n.tipo}">
     <span>${{ ok: '✅', warn: '⚠️', bad: '⛔' }[n.tono] || '🔔'}</span>
     <div style="flex:1"><b>${esc(n.titulo)}</b><small>${esc(n.msg)}</small>
       <small style="opacity:.7">${ago(n.ts)} atrás</small></div></div>`).join('')
     || `<div style="padding:26px">${vacio('🔔', 'Sin notificaciones', '')}</div>`}`;
  document.body.appendChild(p);
  $('#n-todas').onclick = async () => { await post('/notificaciones/leer', {}); p.remove(); cargarNotificaciones(); };
  $$('[data-noti]', p).forEach(el => el.onclick = async () => {
    await post('/notificaciones/leer', { ids: [Number(el.dataset.noti)] });
    p.remove(); cargarNotificaciones();
    const ref = el.dataset.ref, tipo = el.dataset.tipo;
    if (ref) { const { fichaNeg } = await import('./ficha.js'); fichaNeg(ref); }
    else if (tipo === 'mensaje') ir('com');
    else if (tipo === 'cumple' || tipo === 'evento') ir('cal');
  });
  setTimeout(() => document.addEventListener('click', cerrarPanel), 10);
};
function cerrarPanel(e) {
  const p = $('#noti-panel'); if (!p) return;
  if (!p.contains(e.target) && !e.target.closest('#noti-btn')) {
    p.remove(); document.removeEventListener('click', cerrarPanel);
  }
}

/* ================= DISPONIBILIDAD ================= */
export function modalDisponibilidad() {
  modal(`<div class="modal-h"><h3>Marcar disponibilidad</h3><button class="x" data-cerrar>✕</button></div>
  <div class="modal-b"><p class="sub" style="margin-top:0">Tu estado define si recibís asignación automática de nuevos contactos.</p>
   <div class="grid g2 stagger">${DISPONIBILIDAD.map(d => `
     <button class="card-box" style="text-align:left;margin:0;border-color:${S.usuario.disponibilidad === d.id ? 'var(--brand)' : 'var(--line)'}"
       data-disp="${d.id}"><span class="dot" style="background:${d.c}"></span>
       <b style="font-size:var(--fs-sm)"> ${d.t}</b>
       <div style="color:var(--muted);font-size:var(--fs-xs);margin-top:4px">
         ${d.recibe ? 'Recibe asignación automática' : 'No recibe asignación'}</div></button>`).join('')}</div></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $$('[data-disp]').forEach(b => b.onclick = async () => {
    await post('/disponibilidad', { estado: b.dataset.disp });
    S.usuario.disponibilidad = b.dataset.disp;
    pintarDisponibilidad(); cerrar(); vibrar(12);
    toast(`Estado: ${DISPONIBILIDAD.find(d => d.id === b.dataset.disp).t}`, 'ok', 'Disponibilidad');
  });
}

function modalNacimiento() {
  modal(`<div class="modal-h"><h3>🎂 Completá tu fecha de nacimiento</h3></div>
  <div class="modal-b"><p class="sub" style="margin-top:0">La usamos para el calendario de cumpleaños del equipo.</p>
   <div class="field"><label>Fecha de nacimiento</label>
     <input id="nac" type="date" max="${fechaISO(new Date())}"></div>
   <div class="err" id="nac-e"></div></div>
  <div class="modal-f"><button class="btn" id="nac-ok">Guardar</button></div>`);
  $('#nac-ok').onclick = async () => {
    const v = $('#nac').value;
    if (!v) return $('#nac-e').textContent = 'Ingresá tu fecha de nacimiento.';
    await patch('/perfil', { nacimiento: v });
    S.usuario.nacimiento = v; cerrar();
    toast('¡Gracias! Ya figurás en el calendario.', 'ok', 'Perfil');
    setTimeout(modalDisponibilidad, 400);
  };
}

/* ================= CLIMA ================= */
const WXICO = { 0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌦️',
  61:'🌧️',63:'🌧️',65:'⛈️',71:'🌨️',73:'🌨️',75:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',95:'⛈️',96:'⛈️',99:'⛈️' };
const WXTXT = { 0:'Despejado',1:'Mayormente despejado',2:'Parcialmente nublado',3:'Nublado',
  45:'Neblina',48:'Neblina',51:'Llovizna',53:'Llovizna',55:'Llovizna intensa',61:'Lluvia leve',
  63:'Lluvia',65:'Lluvia fuerte',71:'Nieve',73:'Nieve',75:'Nieve fuerte',80:'Chaparrones',
  81:'Chaparrones',82:'Tormenta',95:'Tormenta',96:'Tormenta',99:'Tormenta severa' };

async function cargarClima() {
  const el = $('#wx');
  if (!fx('clima')) { el.hidden = true; return; }
  try {
    let qs = '';
    if (fx('climaAuto') && navigator.geolocation) {
      const pos = await new Promise(r => navigator.geolocation.getCurrentPosition(
        p => r(p), () => r(null), { timeout: 6000, maximumAge: 900000 }));
      if (pos) qs = `?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`;
    }
    const w = await get(`/clima${qs}`);
    if (!w.ok) { el.hidden = true; return; }
    S.clima = w; el.hidden = false;
    el.title = `Humedad ${w.hum}% · Viento ${w.viento} km/h`;
    el.innerHTML = `<span class="ico">${WXICO[w.cod] || '🌡️'}</span>
      <div><b>${w.temp}°C</b><small>${esc(w.ciudad)} · ${WXTXT[w.cod] || ''}</small></div>`;
  } catch (e) { el.hidden = true; }
}

/* ================= VARIOS ================= */
function reloj() {
  const f = () => { const c = $('#clock');
    if (c) c.textContent = new Date().toLocaleString('es-PY', { weekday: 'short', hour: '2-digit', minute: '2-digit' }); };
  f(); clearInterval(window._reloj); window._reloj = setInterval(f, 30000);
}

$('#btn-salir').onclick = () => {
  document.body.classList.remove('nav-open');
  salir();
};
$('#btn-burger').onclick = () => {
  document.body.classList.toggle('nav-open');
  vibrar(10);
};
// El backdrop es únicamente visual. En móviles cerramos el drawer detectando
// un toque fuera del menú para que ninguna capa transparente bloquee opciones.
document.addEventListener('pointerdown', e => {
  if (!document.body.classList.contains('nav-open')) return;
  const aside = document.querySelector('#app > aside');
  const burger = $('#btn-burger');
  if (aside?.contains(e.target) || burger?.contains(e.target)) return;
  document.body.classList.remove('nav-open');
}, { passive: true });

$('#disp-pill').onclick = modalDisponibilidad;
$('#btn-tema').onclick = () => {
  S.tema = S.tema === 'oscuro' ? 'claro' : 'oscuro';
  localStorage.setItem('iciia_tema', S.tema); aplicarTema(); vibrar(10);
};
$('#btn-densidad').onclick = () => {
  S.densidad = S.densidad === 'comoda' ? 'compacta' : 'comoda';
  localStorage.setItem('iciia_densidad', S.densidad); aplicarTema();
  toast(`Densidad ${S.densidad}`, 'ok');
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.token) cargarNotificaciones();
});
window.addEventListener('resize', () => {
  if (!window.matchMedia('(max-width:900px)').matches) document.body.classList.remove('nav-open');
});

/* ================= INICIO ================= */
aplicarTema();
if (S.token) {
  arrancar(false).catch(() => { salir(); const el = $('#l-usr'); if (el) el.focus(); });
} else {
  $('#l-usr').focus();
}

