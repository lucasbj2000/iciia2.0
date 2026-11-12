/* Actualización del CRM abierto: cuando el servidor publica una versión nueva, las pestañas que
   quedaron abiertas desde antes la cargan solas en un momento seguro, sin perder lo que se escribe.
   Momento seguro: nada escrito sin enviar, ninguna ventana abierta, ninguna llamada en curso y
   la persona sin tocar el CRM por 2 minutos (o la pestaña en segundo plano). */
let iniciado = false, cargada = null, nueva = null, ultimaActividad = Date.now(), espera = null, avisado = false;
const INACTIVIDAD_MS = 2 * 60e3;

async function buildServidor() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' });
    const j = await r.json();
    return j?.build && j.build !== 'desconocido' ? String(j.build) : null;
  } catch { return null; }
}

/** ¿Se puede recargar sin que nadie pierda nada? */
function momentoSeguro() {
  if (document.querySelector('#modals > *, #ll-card, #vt:not([hidden]), #ll-panel, .conversation-modal')) return false;
  for (const el of document.querySelectorAll('#app textarea, #app input[type="text"], #app input:not([type]), #app [contenteditable="true"]')) {
    if (el.id === 'q' || el.closest('header.top') || el.type === 'search' || /buscar/i.test(el.placeholder || '')) continue;
    if (String(el.value ?? el.textContent ?? '').trim()) return false;
  }
  return document.hidden || Date.now() - ultimaActividad >= INACTIVIDAD_MS;
}

function aviso() {
  if (avisado || document.getElementById('ver-aviso')) return;
  avisado = true;
  const d = document.createElement('div');
  d.id = 'ver-aviso'; d.setAttribute('role', 'status');
  d.innerHTML = '<span>Hay una versión nueva del CRM.</span><button type="button">Actualizar ahora</button>';
  d.querySelector('button').addEventListener('click', () => location.reload());
  document.body.appendChild(d);
}

function intentar() {
  if (!nueva) return;
  if (momentoSeguro()) { location.reload(); return; }
  aviso();
  clearTimeout(espera); espera = setTimeout(intentar, 30e3);
}

export async function verificarVersion() {
  const b = await buildServidor();
  if (!b) return;
  if (!cargada) { cargada = b; return; }
  if (b !== cargada) { nueva = b; intentar(); }
}

export function iniciarVersion() {
  if (iniciado) return; iniciado = true;
  // La versión de esta pestaña es la del servidor al abrir el CRM.
  verificarVersion();
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => { ultimaActividad = Date.now(); }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) intentar(); else verificarVersion(); });
  setInterval(verificarVersion, 10 * 60e3);
}
