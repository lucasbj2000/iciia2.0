/* ============ Núcleo: API, estado, utilidades, animaciones ============ */
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
  const r = await fetch(`/api${ruta}`, { ...opts, headers: h,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401) { salir(); throw new Error('Sesión expirada. Volvé a ingresar.'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) { const e = new Error(data?.mensaje || data?.error || 'Error inesperado'); e.data = data; e.status = r.status; throw e; }
  return data;
}
export const get = r => api(r);
export const post = (r, body) => api(r, { method: 'POST', body });
export const patch = (r, body) => api(r, { method: 'PATCH', body });
export const put = (r, body) => api(r, { method: 'PUT', body });
export const del = r => api(r, { method: 'DELETE' });

export function salir() {
  localStorage.removeItem('iciia_token');
  S.token = ''; S.usuario = null; S.empresa = null;
  window.dispatchEvent(new Event('impar:salir'));
  if (window._sse) { window._sse.close(); window._sse = null; }
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  const p = $('#l-pwd'); if (p) p.value = '';
}

/* ---------- Formato ---------- */
export const gs = v => 'Gs ' + (Number(v) || 0).toLocaleString('es-PY');
export const fdate = t => t ? new Date(t).toLocaleDateString('es-PY') + ' ' +
  new Date(t).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }) : '—';
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
  const ic = { ok: '✅', warn: '⚠️', bad: '⛔' }[tono] || '🔔';
  const el = document.createElement('div');
  el.className = 'toast ' + tono;
  el.innerHTML = `<span class="ti">${ic}</span><div><b>${esc(titulo || 'iciia2.0')}</b><small>${esc(msg)}</small></div>`;
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
  $('#modals').innerHTML = `<div class="mask"><div class="modal ${ancho ? 'wide' : ''}">${html}</div></div>`;
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
export function vacio(ico, titulo, sub, accion) {
  return `<div class="empty"><span class="ico">${ico}</span><b style="display:block;margin-bottom:4px">${esc(titulo)}</b>
    ${sub ? `<div style="font-size:var(--fs-xs)">${esc(sub)}</div>` : ''}
    ${accion ? `<div style="margin-top:12px">${accion}</div>` : ''}</div>`;
}
export function aplicarTema() {
  document.documentElement.dataset.tema = S.tema;
  document.documentElement.dataset.densidad = S.densidad;
  const b = $('#btn-tema'); if (b) b.textContent = S.tema === 'oscuro' ? '🌙' : '☀️';
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

