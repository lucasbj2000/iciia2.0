/* ============ Núcleo: API, estado, utilidades, animaciones ============ */
import { ic as icLinea, icTono } from './iconos.js';
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = v => String(v ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const S = {
  token: localStorage.getItem('iciia_token') || '',
  usuario: null, empresa: null, empresas: [], sucursales: [],
  vista: 'neg', negociaciones: [], notificaciones: [], clima: null,
  tema: localStorage.getItem('iciia_tema') || 'claro',
  densidad: localStorage.getItem('iciia_densidad') || 'comoda',
  etapaMovil: null
};

/* ---------- API ---------- */
export async function api(ruta, opts = {}) {
  const h = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (S.token) h.Authorization = `Bearer ${S.token}`;
  if (S.empresa?.id && S.usuario?.esAdminGlobal) h['X-Empresa'] = S.empresa.id;
  // El login/contexto deben informar fallos de red; nunca girar indefinidamente.
  const necesitaLimite = ['/login','/contexto','/sesion/renovar'].includes(ruta);
  const ctrl = necesitaLimite && !opts.signal ? new AbortController() : null;
  const timeout = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
  let r;
  try {
    r = await fetch(`/api${ruta}`, {
      ...opts, headers: h, credentials:'same-origin',
      ...(ctrl ? {signal:ctrl.signal} : {}),
      cache:necesitaLimite?'no-store':opts.cache,
      body:opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
  } catch (err) {
    const e = new Error(err.name==='AbortError'
      ? 'IMPAR tardó demasiado en responder. Comprobá el servidor y volvé a intentar.'
      : 'No se pudo conectar con IMPAR. Verificá la conexión o el estado del servidor.');
    e.cause=err;throw e;
  } finally { if(timeout)clearTimeout(timeout); }
  // Un 401 aislado no fuerza salir: el control central valida la sesión.
  // Errores transitorios o peticiones antiguas no deben borrar el token.
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    const e = new Error(data?.mensaje || data?.error || 'Error inesperado'); e.data = data; e.status = r.status;
    // Una sesión restaurada con la contraseña vencida: se pide el cambio en vez de fallar en cada pantalla.
    if (data?.debeCambiarClave) import('./seguridad.js').then(m => m.forzarCambioClave()).catch(() => {});
    throw e;
  }
  return data;
}
export const get = r => api(r);
export const post = (r, body) => api(r, { method: 'POST', body });
export const patch = (r, body) => api(r, { method: 'PATCH', body });
export const put = (r, body) => api(r, { method: 'PUT', body });
export const del = r => api(r, { method: 'DELETE' });

export function salir() {
  try { localStorage.removeItem('iciia_token'); } catch (_) {}
  S.token = ''; S.usuario = null; S.empresa = null;
  // Cada módulo limpia lo suyo; si uno falla, el cierre de sesión continúa.
  try { window.dispatchEvent(new Event('impar:salir')); } catch (e) { console.warn('Limpieza al salir:', e); }
  if (window._sse) { window._sse.close(); window._sse = null; }
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  document.documentElement.classList.remove('sesion-verificando');
  const p = $('#l-pwd'); if (p) p.value = '';
}

/* ---------- Formato ---------- */
export const gs = v => 'Gs ' + (Number(v) || 0).toLocaleString('es-PY');
export const fdate = t => t ? new Date(t).toLocaleDateString('es-PY') + ' ' +
  new Date(t).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }) : '—';
/** «LILIANA BRITEZ» → «Liliana Britez». Solo para mostrar: el dato guardado no cambia.
 *  Se aplica únicamente a nombres escritos todo en mayúsculas. */
const MENORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'van', 'von']);
export function nombreLegible(nombre) {
  const t = String(nombre ?? '');
  if (!/\p{Lu}/u.test(t) || /\p{Ll}/u.test(t)) return t;
  return t.toLocaleLowerCase('es').replace(/[\p{L}\p{M}]+/gu, (p, i) => (i > 0 && MENORES.has(p) ? p : p.charAt(0).toLocaleUpperCase('es') + p.slice(1)));
}
export const fd = t => t ? new Date(t).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
export function ago(t) {
  if (!t) return '—';
  const s = Math.floor((Date.now() - new Date(t)) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm';
  return Math.floor(s / 86400) + 'd ' + Math.floor(s % 86400 / 3600) + 'h';
}
export const iniciales = n => (n || '?').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
export const fechaISO = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const saludo = () => { const h = new Date().getHours(); return h < 12 ? 'Buen día' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; };
export const fx = k => !!S.empresa?.flags?.[k];
export const esAdmin = () => S.usuario?.rol === 'admin';
export const esMando = () => ['admin', 'gerente', 'jefe'].includes(S.usuario?.rol);
export const esMovil = () => window.matchMedia('(max-width:900px)').matches;

/* ---------- Constantes ---------- */
export const DISPONIBILIDAD = [
  { id: 'disponible', t: 'Disponible', c: '#22c55e', recibe: true },
  { id: 'ocupado', t: 'En gestión', c: '#f59e0b', recibe: true },
  { id: 'almuerzo', t: 'Almuerzo', c: '#38bdf8', recibe: false },
  { id: 'permiso', t: 'Permiso', c: '#a78bfa', recibe: false },
  { id: 'fuera', t: 'Fuera de horario', c: '#94a3b8', recibe: false },
  { id: 'salida', t: 'Salida / Offline', c: '#ef4444', recibe: false }
];
export const ORIGENES = ['whatsapp', 'facebook', 'instagram', 'telefonia', 'otro'];
export const ROLES = ['gerente', 'jefe', 'agente'];
export const TIPOS_EV = [
  { k: 'feriado', t: 'Feriado' }, { k: 'actividad', t: 'Actividad' },
  { k: 'reunion', t: 'Reunión' }, { k: 'capacitacion', t: 'Capacitación' }
];
export const etapa = id => (S.empresa?.etapas || []).find(e => e.id === id) || { nombre: id, color: '#888' };
export const etapaActiva = id => !!etapa(id).activa;

/* ---------- Toasts ---------- */
export function toast(msg, tono = 'ok', titulo) {
  const ic = icTono(tono);
  const el = document.createElement('div');
  el.className = 'toast ' + tono;
  el.innerHTML = `<span class="ti">${ic}</span><div><b>${esc(titulo || 'iciia2.0')}</b><small>${esc(msg)}</small></div><i class="toast-tiempo" aria-hidden="true"></i>`;
  $('#toasts').appendChild(el);
  if (fx('notiSonido')) beep(tono);
  if (localStorage.getItem('impar_avisos') == null && fx('notiEscritorio') && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(titulo || 'iciia2.0', { body: msg }); } catch (e) {}
  }
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 4400);
}
function beep(tono) {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.frequency.value = tono === 'bad' ? 420 : tono === 'warn' ? 620 : 880;
    o.type = 'sine'; g.gain.setValueAtTime(.07, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + .28);
    o.start(); o.stop(c.currentTime + .3);
  } catch (e) {}
}

/* ---------- Animaciones ---------- */
export function confeti(n = 70) {
  if (!fx('efectos') || !fx('animacionesPlus')) return;
  const cont = $('#confeti');
  cont.classList.remove('hidden');
  cont.innerHTML = '';
  const colores = ['#FF7A00', '#ff3d81', '#22c55e', '#38bdf8', '#fbd14b', '#a78bfa'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.top = '-20px';
    p.style.background = colores[Math.floor(Math.random() * colores.length)];
    p.style.animationDelay = (Math.random() * .5) + 's';
    p.style.animationDuration = (2 + Math.random() * 1.6) + 's';
    cont.appendChild(p);
  }
  setTimeout(() => { cont.classList.add('hidden'); cont.innerHTML = ''; }, 4200);
}
export function vibrar(ms = 18) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }
export function destacar(el) {
  if (!el || !fx('efectos')) return;
  el.classList.remove('destaca'); void el.offsetWidth; el.classList.add('destaca');
  setTimeout(() => el.classList.remove('destaca'), 1500);
}
export function animarContador(el) {
  if (!el || !fx('efectos')) return;
  el.classList.add('cambio');
  setTimeout(() => el.classList.remove('cambio'), 320);
}

/* ---------- Modales ---------- */
export function modal(html, ancho) {
  document.body.classList.add('modal-open');
  // Si se reemplaza un modal abierto (carga → contenido), no repetir la entrada.
  const reemplazo = !!$('#modals .mask');
  $('#modals').innerHTML = `<div class="mask${reemplazo ? ' reemplazo' : ''}"><div class="modal ${ancho ? 'wide' : ''}">${html}</div></div>`;
  window._hojaModal?.();
  mejorarContrasenas($('#modals'));
  const mask = $('.mask');
  mask.addEventListener('click', e => { if (e.target === mask) cerrar(); });
  document.addEventListener('keydown', escCerrar);
  if (!esMovil()) {
    const f = $('.modal input:not([type=hidden]):not([disabled]), .modal textarea');
    if (f) setTimeout(() => { if (f.isConnected) f.focus({ preventScroll: true }); }, 140);
  }
}
function escCerrar(e) { if (e.key === 'Escape') cerrar(); }
export function cerrar() {
  document.body.classList.remove('modal-open');
  $('#modals').innerHTML = '';
  document.removeEventListener('keydown', escCerrar);
}
export function confirmar(titulo, texto, textoBoton = 'Confirmar', peligro = true) {
  return new Promise(res => {
    modal(`<div class="modal-h"><h3>${esc(titulo)}</h3><button class="x" data-no>✕</button></div>
      <div class="modal-b"><p style="margin:0;color:var(--muted);font-size:var(--fs-sm);line-height:1.7">${texto}</p></div>
      <div class="modal-f"><button class="btn ghost" data-no>Cancelar</button>
        <button class="btn ${peligro ? 'danger' : ''}" data-si>${esc(textoBoton)}</button></div>`);
    $$('[data-no]').forEach(b => b.onclick = () => { cerrar(); res(false); });
    $('[data-si]').onclick = () => { cerrar(); res(true); };
  });
}

/* ---------- UI ---------- */
export function bajar(nombre, contenido, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff' + contenido], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function skeleton(n = 5) {
  const anchos = [95, 70, 88, 60, 80, 74];
  return `<div class="card-box">${[...Array(n)].map((_, i) =>
    `<div class="skel" style="width:${anchos[i % anchos.length]}%"></div>`).join('')}</div>`;
}
/** Campos de contraseña: botón para ver lo escrito y aviso de mayúsculas activadas. */
export function mejorarContrasenas(raiz = document) {
  for (const input of raiz.querySelectorAll('input[type="password"]:not([data-ojo])')) {
    input.dataset.ojo = '1';
    const caja = document.createElement('span'); caja.className = 'pass-caja';
    input.before(caja); caja.append(input);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pass-ver'; b.setAttribute('aria-label', 'Mostrar contraseña'); b.setAttribute('aria-pressed', 'false');
    b.innerHTML = icLinea('ojo');
    b.onclick = () => {
      const ver = input.type === 'password'; input.type = ver ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(ver)); b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
      b.innerHTML = icLinea(ver ? 'ojo_tachado' : 'ojo'); input.focus();
    };
    caja.append(b);
    const aviso = document.createElement('small'); aviso.className = 'pass-mayus'; aviso.hidden = true; aviso.setAttribute('role', 'status');
    aviso.innerHTML = `${icLinea('alerta')} Las mayúsculas están activadas`;
    caja.after(aviso);
    const revisar = e => { if (e.getModifierState) aviso.hidden = !e.getModifierState('CapsLock'); };
    input.addEventListener('keydown', revisar); input.addEventListener('keyup', revisar);
    input.addEventListener('blur', () => { aviso.hidden = true; });
  }
}
export function vacio(ico, titulo, sub, accion) {
  // Acepta el nombre de un ícono de línea («calendario») o, por compatibilidad, un símbolo.
  const icono = /^[a-z_]+$/.test(ico || '') ? icLinea(ico) : ico;
  return `<div class="empty"><span class="ico">${icono}</span><b style="display:block;margin-bottom:4px">${esc(titulo)}</b>
    ${sub ? `<div style="font-size:var(--fs-xs)">${esc(sub)}</div>` : ''}
    ${accion ? `<div style="margin-top:12px">${accion}</div>` : ''}</div>`;
}
export function aplicarTema() {
  document.documentElement.dataset.tema = S.tema;
  document.documentElement.dataset.densidad = S.densidad;
  const b = $('#btn-tema'); if (b) b.setAttribute('aria-label', S.tema === 'oscuro' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = S.tema === 'oscuro' ? '#0f1115' : '#f4f6fa';
}
export function aplicarFX() {
  document.body.classList.toggle('fx-off', !fx('efectos'));
  $('#aurora').style.display = (fx('efectos') && fx('aurora')) ? '' : 'none';
  $('#noti-btn').hidden = !fx('notificaciones');
  $('#btn-tema').hidden = !fx('temaClaro');
}

/* Ripple global en botones */
document.addEventListener('click', e => {
  const b = e.target.closest('.btn, .bpers'); if (!b || !fx('efectos')) return;
  const r = b.getBoundingClientRect(), s = document.createElement('span');
  s.className = 'rp'; const d = Math.max(r.width, r.height);
  s.style.width = s.style.height = d + 'px';
  s.style.left = (e.clientX - r.left - d / 2) + 'px';
  s.style.top = (e.clientY - r.top - d / 2) + 'px';
  b.appendChild(s); setTimeout(() => s.remove(), 620);
});


/** Línea de WhatsApp para que el agente distinga el número verificado (Cloud API) del normal (QR). */
export function etiquetaLinea(tipo, nombre) {
  const corto = String(nombre || '').replace(/^whatsapp(\s+cloud)?(\s+api)?\s*[·:-]?\s*/i, '').trim();
  if (tipo === 'whatsapp_api') return { texto: 'WhatsApp verificado', corto, clase: 'linea-verificada', icono: 'ok' };
  if (tipo === 'whatsapp_qr') return { texto: 'WhatsApp normal', corto, clase: 'linea-normal', icono: 'celular' };
  if (tipo === 'messenger') return { texto: 'Messenger', corto, clase: '', icono: 'mensaje' };
  if (tipo === 'instagram') return { texto: 'Instagram', corto, clase: '', icono: 'camara' };
  return null;
}
