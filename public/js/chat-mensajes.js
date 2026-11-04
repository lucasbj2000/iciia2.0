import { mostrarEscribiendo, avisarMensajesNuevos } from './animaciones.js';

/* ---------- Separadores por día (Hoy, Ayer, fecha) ---------- */
const ZONA = 'America/Asuncion';
const claveDia = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { timeZone: ZONA }); };
export function etiquetaDia(clave, ahora = new Date()) {
  const hoy = claveDia(ahora), ayer = claveDia(new Date(ahora.getTime() - 864e5));
  if (clave === hoy) return 'Hoy';
  if (clave === ayer) return 'Ayer';
  const [a, m, d] = clave.split('-').map(Number), f = new Date(Date.UTC(a, m - 1, d, 12));
  const txt = f.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC', ...(a !== Number(hoy.slice(0, 4)) ? { year: 'numeric' } : {}) });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
/** Hora corta para la burbuja; la fecha completa queda en el separador y en el título. */
export const horaMensaje = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA }); };
/* Rótulo flotante del día que se está mirando: cambia mientras se desplaza y se oculta al detenerse. */
function diaFlotante(caja) {
  const zona = caja.parentElement; if (!zona) return null;
  zona.classList.add('chat-zona');
  let el = zona.querySelector(':scope > .dia-flotante');
  if (!el) {
    el = document.createElement('div'); el.className = 'dia-flotante'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span></span>'; zona.append(el);
  }
  el.style.top = (caja.offsetTop + 8) + 'px';
  return el;
}
function actualizarDiaFlotante(caja, mostrar) {
  const el = diaFlotante(caja); if (!el) return;
  const arriba = caja.getBoundingClientRect().top;
  const seps = [...caja.querySelectorAll(':scope > .dia-sep')];
  let actual = null, siguiente = null;
  // Un separador cuenta como «pasado» recién cuando salió por completo por arriba.
  for (const s of seps) { if (s.getBoundingClientRect().bottom <= arriba + 2) actual = s; else { siguiente = s; break; } }
  // Sin día «pasado» arriba, o con el próximo separador por llegar: no se superponen.
  const visible = mostrar && actual && !(siguiente && siguiente.getBoundingClientRect().top - arriba < 40);
  if (actual) el.firstElementChild.textContent = actual.textContent;
  el.classList.toggle('on', !!visible);
}
function seguirDia(caja) {
  if (caja._dia) return;
  caja._dia = true;
  let quieto;
  caja.addEventListener('scroll', () => {
    actualizarDiaFlotante(caja, true);
    clearTimeout(quieto); quieto = setTimeout(() => actualizarDiaFlotante(caja, false), 1400);
  }, { passive: true });
}

function separarPorDia(caja) {
  caja.querySelectorAll(':scope > .dia-sep').forEach(el => el.remove());
  let previo = '';
  for (const el of [...caja.children]) {
    const dia = el.dataset.dia; if (!dia) continue;
    if (dia !== previo) {
      const sep = document.createElement('div');
      sep.className = 'dia-sep'; sep.setAttribute('role', 'separator');
      sep.innerHTML = `<span>${etiquetaDia(dia)}</span>`;
      caja.insertBefore(sep, el);
      previo = dia;
    }
  }
  seguirDia(caja);
}
// Conserva los nodos existentes, el audio en reproducción y la posición de lectura.
export function actualizarMensajes(caja, mensajes, render, seguir = false) {
  const alFinal = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 64;
  const posicion = caja.scrollTop;
  const existentes = new Map([...caja.children].filter(el => el.dataset.mensajeId)
    .map(el => [el.dataset.mensajeId, el]));
  // Primera carga: sin animaciones. Después: lo nuevo entra y lo que cambia de estado se marca.
  const enVivo = existentes.size > 0;
  let entrantesNuevos = 0;
  if (mensajes.length) caja.querySelectorAll('.empty').forEach(el => el.remove());
  caja.querySelectorAll(':scope > .dia-sep').forEach(el => el.remove());
  let anterior = null;
  for (const mensaje of mensajes) {
    const id = String(mensaje.id), html = render(mensaje);
    let nodo = existentes.get(id);
    if (!nodo || nodo._mensajeHTML !== html) {
      const plantilla = document.createElement('template'); plantilla.innerHTML = html;
      const nuevo = plantilla.content.firstElementChild;
      nuevo.dataset.mensajeId = id; nuevo._mensajeHTML = html;
      if (nodo) { nuevo.style.animation = 'none'; nuevo.classList.add('actualizado'); nodo.replaceWith(nuevo); }
      else {
        caja.append(nuevo);
        if (enVivo && !/^local-/.test(id)) { nuevo.classList.add('recien'); if (mensaje.dir === 'in') entrantesNuevos++; }
        else if (!enVivo) nuevo.style.animation = 'none';
      }
      nodo = nuevo;
    }
    // Si se cargaron mensajes anteriores, reinsertar solo lo necesario en orden
    // cronológico sin reconstruir los nodos que contienen audio reproduciéndose.
    const siguiente = anterior ? anterior.nextSibling : caja.firstChild;
    if (nodo !== siguiente) caja.insertBefore(nodo, siguiente);
    anterior = nodo;
    existentes.delete(id);
    delete nodo.dataset.local;
    nodo.dataset.dia = claveDia(mensaje.ts);
  }
  // Los mensajes locales esperan la confirmación del POST; un SSE temprano no los borra.
  existentes.forEach(el => { if (!el.dataset.local) el.remove(); });
  separarPorDia(caja);
  caja.scrollTop = seguir || alFinal ? caja.scrollHeight : posicion;
  if (entrantesNuevos) {
    mostrarEscribiendo(caja, false); // el cliente terminó de escribir
    if (!(seguir || alFinal)) avisarMensajesNuevos(caja, entrantesNuevos);
  }
}

let secuencia = 0;
export function confirmarIdPendiente(caja, localId, id) {
  if (!caja || !localId || !id) return;
  const local = [...caja.children].find(el => el.dataset.mensajeId === localId);
  if (!local) return;
  const real = [...caja.children].find(el => el.dataset.mensajeId === String(id));
  if (real && real !== local) { local.dataset.local = 'confirmado'; local.remove(); return; }
  local.dataset.mensajeId = String(id);
  local.dataset.local = 'confirmado';
  return local;
}

export function mostrarMensajePendiente(caja, mensaje, render) {
  const id = `local-${Date.now()}-${++secuencia}`;
  const m = { ...mensaje, id, estado: 'pendiente', ts: new Date().toISOString() };
  const plantilla = document.createElement('template'); plantilla.innerHTML = render(m);
  const nodo = plantilla.content.firstElementChild;
  nodo.dataset.mensajeId = id; nodo.dataset.local = 'enviando'; nodo._mensajeHTML = render(m);
  nodo.dataset.dia = claveDia(m.ts);
  caja.querySelectorAll('.empty').forEach(el => el.remove());
  caja.append(nodo); separarPorDia(caja); caja.scrollTop = caja.scrollHeight;
  return {
    id,
    confirmar(servidor) {
      if (!servidor?.id) return;
      const local = confirmarIdPendiente(caja, id, servidor.id)
        || [...caja.children].find(el => el.dataset.mensajeId === String(servidor.id) && el.dataset.local === 'confirmado');
      // Si el SSE ya mostró el registro real, conservar su estado más reciente.
      if (!local) return;
      const html = render({ ...m, ...servidor });
      const p = document.createElement('template'); p.innerHTML = html;
      const nuevo = p.content.firstElementChild;
      nuevo.dataset.mensajeId = String(servidor.id); nuevo.dataset.local = 'confirmado';
      nuevo._mensajeHTML = html; nuevo.style.animation = 'none'; local.replaceWith(nuevo);
    },
    fallar() {
      if (nodo.dataset.local !== 'enviando') return false;
      nodo.remove(); return true;
    }
  };
}

/** Caja de texto que empieza en una línea y crece mientras se escribe (hasta un tope).
 *  También se ajusta cuando el código cambia el texto (envío, respuesta rápida). */
export function cajaQueCrece(t, maximo = 168) {
  if (!t || t._crece) return;
  t._crece = true; t.rows = 1;
  const ajustar = () => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, maximo) + 'px'; t.style.overflowY = t.scrollHeight > maximo ? 'auto' : 'hidden'; };
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  Object.defineProperty(t, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); requestAnimationFrame(ajustar); } });
  t.addEventListener('input', ajustar);
  requestAnimationFrame(ajustar);
  // Celular: al abrir el teclado, la caja y el último mensaje quedan a la vista sin esperar una tecla.
  t.addEventListener('focus', () => {
    if (!matchMedia('(max-width: 900px)').matches) return;
    const caja = document.getElementById('chatbox');
    const alFinal = caja && caja.scrollHeight - caja.scrollTop - caja.clientHeight < 96;
    let hechas = 0;
    const ubicar = () => {
      if (document.activeElement !== t || hechas++ > 3) return;
      if (alFinal && caja) caja.scrollTop = caja.scrollHeight;
      t.scrollIntoView({ block: 'nearest' });
    };
    window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(ubicar), { once: true });
    setTimeout(ubicar, 320); setTimeout(ubicar, 650);
  });
}
