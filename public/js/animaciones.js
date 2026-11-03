/* IMPAR · Animaciones con intención. Solo transform/opacity (salvo el trazo de gráficos),
   y nada se mueve si el equipo pide «reducir movimiento». */
import { $, $$, esc } from './core.js';

export const menosMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const CURVA = 'cubic-bezier(.2,.7,.2,1)';

/** FLIP: el elemento viaja desde donde estaba hasta su nuevo lugar. */
export function volar(el, mover) {
  if (!el || menosMovimiento()) { mover(); return; }
  const antes = el.getBoundingClientRect();
  mover();
  volarDesde(el, antes);
}
/** Igual que volar, pero desde un rectángulo ya medido (otro nodo que se reemplazó). */
export function volarDesde(el, antes) {
  if (!el || !antes || menosMovimiento()) return;
  const despues = el.getBoundingClientRect();
  const dx = antes.left - despues.left, dy = antes.top - despues.top;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
  el.classList.add('volando');
  const a = el.animate([{ transform: `translate(${dx}px,${dy}px) scale(1.03)` }, { transform: 'none' }],
    { duration: 300, easing: CURVA });
  a.onfinish = a.oncancel = () => el.classList.remove('volando');
}

/** Tildes de WhatsApp en SVG (se dibujan cuando cambian de estado). */
export function tildesHTML(ack) {
  const n = Number(ack);
  const nivel = n >= 4 ? 'leido' : n >= 3 ? 'entregado' : 'enviado';
  const texto = { leido: 'Leído', entregado: 'Entregado', enviado: 'Enviado, entrega no confirmada' }[nivel];
  const segundo = nivel === 'enviado' ? '' : '<path class="t2" d="M7.5 9.6 14.2 2.6" pathLength="1"/>';
  return `<span class="tildes ${nivel}"><svg viewBox="0 0 16 12" aria-hidden="true"><path class="t1" d="M1.5 6.4 4.6 9.6 11 2.6" pathLength="1"/>${segundo}</svg>${texto}</span>`;
}

/* ---------- Conversación: «escribiendo…» y mensajes nuevos ---------- */
const temporizadores = new WeakMap();
export function mostrarEscribiendo(caja, activo, grabando = false) {
  const zona = caja?.parentElement; if (!zona) return;
  let b = zona.querySelector(':scope > .escribiendo-flotante');
  clearTimeout(temporizadores.get(zona));
  if (!activo) { b?.classList.remove('on'); return; }
  if (!b) {
    b = document.createElement('div'); b.className = 'escribiendo-flotante'; b.setAttribute('role', 'status');
    zona.classList.add('chat-zona'); zona.append(b);
  }
  b.innerHTML = `<span class="puntos" aria-hidden="true"><i></i><i></i><i></i></span>${grabando ? 'Grabando un audio…' : 'Escribiendo…'}`;
  requestAnimationFrame(() => b.classList.add('on'));
  // Si WhatsApp no avisa que terminó, se oculta solo.
  temporizadores.set(zona, setTimeout(() => b.classList.remove('on'), 9000));
}

export function avisarMensajesNuevos(caja, cantidad) {
  const zona = caja?.parentElement; if (!zona || !cantidad) return;
  zona.classList.add('chat-zona');
  let b = zona.querySelector(':scope > .nuevos-flotante');
  if (!b) {
    b = document.createElement('button'); b.type = 'button'; b.className = 'nuevos-flotante';
    b.onclick = () => { caja.scrollTo({ top: caja.scrollHeight, behavior: menosMovimiento() ? 'auto' : 'smooth' }); };
    zona.append(b);
    caja.addEventListener('scroll', () => {
      if (caja.scrollHeight - caja.scrollTop - caja.clientHeight < 64) { b.classList.remove('on'); b.dataset.n = '0'; }
    }, { passive: true });
  }
  const n = Number(b.dataset.n || 0) + cantidad;
  b.dataset.n = String(n);
  b.textContent = `↓ ${n} ${n === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}`;
  b.classList.add('on');
}

/* ---------- Estado de WhatsApp en el encabezado ---------- */
let ultimoEstado = 'conectado', timerOk = null;
export function estadoWhatsApp(estado) {
  const top = $('header.top'); if (!top) return;
  let chip = $('#wa-estado');
  if (!chip) {
    chip = document.createElement('span'); chip.id = 'wa-estado'; chip.setAttribute('role', 'status');
    top.insertBefore(chip, $('#wx') || $('#disp-pill'));
  }
  clearTimeout(timerOk);
  chip.setAttribute('aria-label', estado === 'conectado' ? 'WhatsApp conectado' : ['reconectando', 'conectando'].includes(estado) ? 'WhatsApp reconectando' : 'WhatsApp desconectado');
  chip.title = chip.getAttribute('aria-label');
  if (estado === 'conectado') {
    if (ultimoEstado !== 'conectado') {
      chip.className = 'ok on'; chip.innerHTML = '<span class="wa-ico" aria-hidden="true"></span><span class="wa-txt">WhatsApp listo</span>';
      timerOk = setTimeout(() => chip.classList.remove('on'), 3500);
    }
  } else if (['reconectando', 'conectando'].includes(estado)) {
    chip.className = 'reconectando on'; chip.innerHTML = '<span class="wa-ico" aria-hidden="true"></span><span class="wa-txt">Reconectando…</span>';
  } else {
    chip.className = 'caido on'; chip.innerHTML = '<span class="wa-ico" aria-hidden="true"></span><span class="wa-txt">Sin WhatsApp</span>';
  }
  ultimoEstado = estado;
}

/* ---------- Momentos ---------- */
/** Bienvenida: el logo se arma por partes, una vez por día y por equipo. */
export function bienvenida(nombre, saludo) {
  const hoy = new Date().toISOString().slice(0, 10);
  try { if (localStorage.getItem('impar_bienvenida') === hoy) return; localStorage.setItem('impar_bienvenida', hoy); } catch { return; }
  if (menosMovimiento()) return;
  const capa = document.createElement('div');
  capa.className = 'bienvenida-impar'; capa.setAttribute('aria-hidden', 'true');
  capa.innerHTML = `<div class="bv-centro"><span class="logo-impar bv-logo"><img src="/assets/impar-logo-color.png" alt="" width="678" height="302"><i class="logo-tinta"></i></span>
    <p class="bv-saludo">${esc(saludo)}${nombre ? ', ' + esc(nombre) : ''}</p></div>`;
  document.body.append(capa);
  const cerrar = () => { capa.classList.add('sale'); setTimeout(() => capa.remove(), 300); };
  capa.addEventListener('pointerdown', cerrar);
  setTimeout(cerrar, 1500);
}

/** Guirnalda de papel picado para los cumpleaños del día. */
export function guirnalda(nombres) {
  const colores = ['var(--verde)', 'var(--gris-logo)', '#F2B33D', 'var(--verde-texto)', '#E8857A'];
  const banderas = Array.from({ length: 22 }, (_, i) =>
    `<path d="M${i * 20 + 2} 6 l9 16 l9 -16z" fill="${colores[i % colores.length]}" style="--i:${i}"/>`).join('');
  return `<div class="guirnalda" role="status"><svg viewBox="0 0 444 26" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 6 Q222 14 444 6" fill="none" stroke="var(--muted)" stroke-width="1"/>${banderas}</svg>
    <p>🎂 ¡Hoy cumple ${nombres.map(esc).join(' y ')}! Saludalo${nombres.length > 1 ? 's' : ''} en Comunicación.</p></div>`;
}

/** Cifras que corren hasta su valor (300 ms). */
export function correr(el) {
  if (!el || menosMovimiento()) return;
  const final = el.textContent, m = final.match(/^(\D*)([\d.]+)(.*)$/);
  if (!m) return;
  const objetivo = Number(m[2].replace(/\./g, ''));
  if (!Number.isFinite(objetivo) || objetivo < 2) return;
  const t0 = performance.now();
  const paso = t => {
    const k = Math.min(1, (t - t0) / 300), v = Math.round(objetivo * (1 - Math.pow(1 - k, 3)));
    el.textContent = k < 1 ? m[1] + v.toLocaleString('es-PY') + m[3] : final;
    if (k < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}
