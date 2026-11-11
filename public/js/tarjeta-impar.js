/* IMPAR · Tarjeta del tablero: hoja verde de IMPAR, sello de la plataforma, urgencia por
   tiempo de espera (en horario laboral) y bandeja fija para responder sin abrir la ficha. */
import { $, S, esc, get, post, toast } from './core.js';
import { ic } from './iconos.js';
import { avisarRedaccionTarjeta } from './presencia-equipo.js';

export const ABIERTAS = ['nuevo', 'contactado', 'espera'];

/* ---------- Sello de la plataforma ---------- */
const FORMAS = {
  wa: 'M26 4a21 21 0 1 1-10.7 39L5 47l3.7-10A21 21 0 0 1 26 4z',
  ms: 'M26 4c12.4 0 22 9 22 20.5S38.4 45 26 45c-2.3 0-4.4-.3-6.4-.9L12 48v-7.2C7.3 37 4 31.2 4 24.5 4 13 13.6 4 26 4z',
  ig: 'M16 5h20a11 11 0 0 1 11 11v20a11 11 0 0 1-11 11H16A11 11 0 0 1 5 36V16A11 11 0 0 1 16 5z',
  tel: 'M26 4a22 22 0 1 1 0 44 22 22 0 0 1 0-44z',
  otro: 'M12 6h28l6 6v28l-6 6H12l-6-6V12z'
};
/** De qué plataforma es hoy la negociación (según la línea por la que se responde). */
export function plataforma(n) {
  const t = String(n.canal_tipo || '');
  if (t === 'whatsapp_api') return { k: 'wv', forma: 'wa', nombre: 'WhatsApp', detalle: 'Verificado', icono: 'telefono', verificado: true };
  if (t.startsWith('whatsapp')) return { k: 'wn', forma: 'wa', nombre: 'WhatsApp', detalle: 'Normal', icono: 'telefono' };
  if (t === 'messenger' || n.origen === 'messenger' || n.origen === 'facebook') return { k: 'ms', forma: 'ms', nombre: 'Messenger', icono: 'rayo' };
  if (t === 'instagram' || n.origen === 'instagram') return { k: 'ig', forma: 'ig', nombre: 'Instagram', icono: 'camara' };
  if (n.origen === 'whatsapp') return { k: 'wn', forma: 'wa', nombre: 'WhatsApp', detalle: 'Normal', icono: 'telefono' };
  if (n.origen === 'telefonia') return { k: 'tel', forma: 'tel', nombre: 'Teléfono', icono: 'telefono' };
  return { k: 'otro', forma: 'otro', nombre: n.origen === 'manual' ? 'Manual' : 'Otro', icono: 'lapiz' };
}
const ORIGEN_RED = { instagram: 'Instagram', messenger: 'Messenger', facebook: 'Messenger' };
/** Si la conversación pasó de redes a WhatsApp, de dónde llegó el cliente. */
export const llegoPor = n => String(n.canal_tipo || '').startsWith('whatsapp') ? ORIGEN_RED[n.origen] || '' : '';

// Degradés de Messenger e Instagram, definidos una sola vez para todos los sellos.
if (typeof document !== 'undefined' && !document.getElementById('tj-degrades')) {
  const d = document.createElement('div');
  d.innerHTML = `<svg id="tj-degrades" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
    <linearGradient id="tj-g-ms" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0a7cff"/><stop offset=".6" stop-color="#7a5cff"/><stop offset="1" stop-color="#ff5c8a"/></linearGradient>
    <linearGradient id="tj-g-ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".3" stop-color="#fa7e1e"/><stop offset=".6" stop-color="#d62976"/><stop offset="1" stop-color="#962fbf"/></linearGradient></defs></svg>`;
  (document.body || document.documentElement).appendChild(d.firstElementChild);
}

export function selloHTML(n) {
  const p = plataforma(n), d = FORMAS[p.forma];
  return `<span class="tj-sello" data-sello="${p.k}" role="img" aria-label="${esc(p.nombre)}${p.detalle ? ' ' + esc(p.detalle.toLowerCase()) : ''}">
    <svg viewBox="0 0 52 52" aria-hidden="true"><path class="tj-s1" d="${d}"/><path class="tj-s2" d="${d}" transform="translate(26 25.5) scale(.78) translate(-26 -25.5)"/></svg>
    <span class="tj-sg">${ic(p.icono)}</span>${p.verificado ? `<span class="tj-ver" title="Verificado">${ic('check')}</span>` : ''}
    <span class="tj-sr">${esc(p.nombre)}${p.detalle ? `<br>${esc(p.detalle)}` : ''}</span></span>`;
}

/** El sello anterior se levanta y el nuevo se estampa (al cambiar de plataforma o de línea). */
export function estamparSello(contenedor, selloViejoHTML) {
  const zona = contenedor?.querySelector('.tj-zona');
  if (!zona || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const nuevo = zona.querySelector('.tj-sello');
  if (selloViejoHTML) {
    const t = document.createElement('div'); t.innerHTML = selloViejoHTML;
    const viejo = t.firstElementChild; viejo.classList.add('tj-sale'); zona.appendChild(viejo);
    viejo.addEventListener('animationend', () => viejo.remove(), { once: true });
  }
  nuevo?.classList.add('tj-entra');
  const tinta = document.createElement('span'); tinta.className = 'tj-tinta';
  if (nuevo) tinta.style.setProperty('--tj-glifo-tinta', getComputedStyle(nuevo).getPropertyValue('--tj-glifo').trim() || 'var(--verde)');
  zona.appendChild(tinta);
  tinta.addEventListener('animationend', () => tinta.remove(), { once: true });
  nuevo?.addEventListener('animationend', () => nuevo.classList.remove('tj-entra'), { once: true });
}

/* ---------- Tiempo de espera en horario laboral ---------- */
const reglas = () => S.empresa?.reglas || {};
function enHorario(fecha, r = reglas()) {
  const dias = r.diasHabiles || [1, 2, 3, 4, 5], ini = Number(r.jornadaIni ?? 8), fin = Number(r.jornadaFin ?? 17);
  const h = fecha.getHours() + fecha.getMinutes() / 60;
  return dias.includes(fecha.getDay()) && h >= ini && h < fin;
}
/** Minutos de espera contados solo dentro de la jornada (de noche y en días no hábiles no corre). */
export function minutosLaborales(desde, hasta = new Date(), r = reglas()) {
  const d0 = new Date(desde); if (!(d0 < hasta)) return 0;
  const dias = r.diasHabiles || [1, 2, 3, 4, 5], ini = Number(r.jornadaIni ?? 8), fin = Number(r.jornadaFin ?? 17);
  let total = 0;
  const dia = new Date(d0); dia.setHours(0, 0, 0, 0);
  for (let i = 0; i < 62 && dia < hasta; i++) {
    if (dias.includes(dia.getDay())) {
      const a = new Date(dia); a.setHours(Math.floor(ini), Math.round((ini % 1) * 60), 0, 0);
      const b = new Date(dia); b.setHours(Math.floor(fin), Math.round((fin % 1) * 60), 0, 0);
      const desdeT = Math.max(a, d0), hastaT = Math.min(b, hasta);
      if (hastaT > desdeT) total += (hastaT - desdeT) / 60000;
    }
    dia.setDate(dia.getDate() + 1);
  }
  return Math.round(total);
}
export const fmtMin = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
/** Nivel de urgencia de un cliente que espera respuesta: 0 en pausa (fuera de horario), 1 normal… 4 demorada. */
export function urgencia(n, ahora = new Date()) {
  if (n.etapa !== 'nuevo' && n.etapa !== 'espera') return null;
  const r = reglas();
  const minutos = minutosLaborales(n.entrada_etapa || n.creado, ahora, r);
  const corte = [Number(r.esperaAtencionMin) || 15, Number(r.esperaUrgenteMin) || 60, Number(r.esperaDemoraMin) || 180];
  if (!enHorario(ahora, r)) return { nivel: 0, minutos, abre: proximaApertura(ahora, r) };
  return { nivel: minutos < corte[0] ? 1 : minutos < corte[1] ? 2 : minutos < corte[2] ? 3 : 4, minutos, pct: Math.min(100, Math.round(minutos / corte[2] * 100)) };
}
function proximaApertura(ahora, r) {
  const dias = r.diasHabiles || [1, 2, 3, 4, 5], ini = Number(r.jornadaIni ?? 8);
  const hh = `${String(Math.floor(ini)).padStart(2, '0')}:${String(Math.round((ini % 1) * 60)).padStart(2, '0')}`;
  const hoyAntes = dias.includes(ahora.getDay()) && ahora.getHours() + ahora.getMinutes() / 60 < ini;
  if (hoyAntes) return `hoy desde las ${hh}`;
  const d = new Date(ahora);
  for (let i = 1; i <= 7; i++) { d.setDate(d.getDate() + 1); if (dias.includes(d.getDay())) break; }
  const manana = new Date(ahora); manana.setDate(ahora.getDate() + 1);
  return d.toDateString() === manana.toDateString() ? `mañana desde las ${hh}` :
    `el ${d.toLocaleDateString('es-PY', { weekday: 'long' })} desde las ${hh}`;
}

/* ---------- Bandeja de respuesta rápida ---------- */
const BORRADORES = new Map();
const esMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const ATAJO = esMac ? '⌘ + Enter' : 'Ctrl + Enter';
const EMOJIS = { Frecuentes: ['👍', '🙏', '😊', '🙌', '✅', '📦', '📄', '✏️', '🎉', '👋'], Caras: ['😀', '😃', '😉', '🙂', '😍', '🤔', '😅', '😮', '😢', '👌'] };

export function bandejaHTML(n) {
  const nombre = esc(n.cliente || 'el cliente');
  return `<div class="tj-bandeja" data-bandeja>
    <div class="tj-caja"><textarea rows="1" data-resp placeholder="Respuesta rápida…" aria-label="Respuesta rápida para ${nombre}. ${ATAJO} para enviar">${esc(BORRADORES.get(n.id) || '')}</textarea>
      <button type="button" class="tj-ib" data-tj="rap" aria-label="Respuestas rápidas" aria-expanded="false" title="Respuestas rápidas">${ic('rayo')}</button>
      <button type="button" class="tj-ib" data-tj="emo" aria-label="Emojis" aria-expanded="false" title="Emojis">${ic('sonrisa')}</button>
      <button type="button" class="tj-ib tj-env" data-tj="env" aria-label="Enviar" title="Enviar (${ATAJO})">${ic('enviar')}</button>
      <span class="tj-atajo" aria-hidden="true">${ATAJO} para enviar</span></div>
    <div class="tj-err" data-tj-err role="alert"></div>
    <div class="tj-panel" data-tj-panel hidden></div></div>`;
}

let rapidasCache = null;
async function rapidasPara(n) {
  if (!rapidasCache) rapidasCache = get('/admin/rapidas').catch(() => ({ equipo: [], personales: [] }));
  const r = await rapidasCache, suc = n.sucursal || S.usuario?.sucursal || '';
  const eq = (r.equipo || []).filter(x => x.ambito === 'empresa' || (x.ambito === 'sucursal' && x.sucursal === suc));
  return [...(r.personales || []), ...eq].filter(x => String(x.txt || '').trim());
}
export function olvidarRapidas() { rapidasCache = null; }

function otroEscribiendo(id) {
  return (S.presencia?.[id] || []).find(p => p.id !== S.usuario?.id && p.redactando);
}

function insertar(t, texto) {
  const i = t.selectionStart ?? t.value.length, f = t.selectionEnd ?? i;
  t.value = t.value.slice(0, i) + texto + t.value.slice(f);
  t.focus(); t.selectionStart = t.selectionEnd = i + texto.length;
  t.dispatchEvent(new Event('input'));
}

/** Conecta la bandeja de una tarjeta. `alEnviar` refresca la tarjeta al terminar. */
export function conectarBandeja(card, n, alEnviar) {
  const b = card.querySelector('[data-bandeja]'); if (!b) return;
  const t = b.querySelector('[data-resp]'), err = b.querySelector('[data-tj-err]'), panel = b.querySelector('[data-tj-panel]');
  // Escribir o seleccionar texto en la bandeja no arrastra la tarjeta ni dispara gestos.
  b.addEventListener('pointerdown', e => { e.stopPropagation(); card.draggable = false; });
  b.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
  b.addEventListener('focusout', () => setTimeout(() => { if (!b.contains(document.activeElement)) card.draggable = card.dataset.arrastrable !== 'no'; }, 0));
  b.addEventListener('click', e => e.stopPropagation());
  b.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
  const ajustar = () => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 96) + 'px'; };
  if (t.value) ajustar();
  let aviso = null, escribiendo = false;
  t.addEventListener('input', () => {
    ajustar(); err.textContent = '';
    if (t.value) BORRADORES.set(n.id, t.value); else BORRADORES.delete(n.id);
    const ahora = !!t.value.trim();
    if (ahora !== escribiendo) { escribiendo = ahora; avisarRedaccionTarjeta(n.id, ahora); }
    clearTimeout(aviso);
    if (ahora) aviso = setTimeout(() => { escribiendo = false; avisarRedaccionTarjeta(n.id, false); }, 8000);
  });
  t.addEventListener('blur', () => { if (escribiendo) { escribiendo = false; clearTimeout(aviso); avisarRedaccionTarjeta(n.id, false); } });
  t.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviar(); }
    else if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); abrirPanel(null); }
  });

  const botones = { rap: b.querySelector('[data-tj="rap"]'), emo: b.querySelector('[data-tj="emo"]') };
  async function abrirPanel(tipo) {
    const actual = panel.dataset.tipo;
    if (!tipo || actual === tipo) { panel.hidden = true; panel.dataset.tipo = ''; Object.values(botones).forEach(x => x.setAttribute('aria-expanded', 'false')); return; }
    panel.dataset.tipo = tipo; panel.hidden = false;
    Object.entries(botones).forEach(([k, x]) => x.setAttribute('aria-expanded', String(k === tipo)));
    if (tipo === 'emo') {
      panel.innerHTML = Object.entries(EMOJIS).map(([titulo, l]) => `<div class="tj-pt">${titulo}</div><div class="tj-emo">${
        l.map(e => `<button type="button" data-e="${e}" aria-label="Insertar ${e}">${e}</button>`).join('')}</div>`).join('');
      panel.querySelectorAll('[data-e]').forEach(x => x.onclick = () => insertar(t, x.dataset.e));
      return;
    }
    panel.innerHTML = `<input class="tj-buscar" placeholder="Buscar respuesta" aria-label="Buscar respuesta rápida"><div class="tj-lista"><div class="tj-pt">Cargando…</div></div>`;
    const lista = await rapidasPara(n);
    if (panel.dataset.tipo !== 'rap') return;
    const cont = panel.querySelector('.tj-lista'), buscar = panel.querySelector('.tj-buscar');
    const pintar = q => {
      const f = lista.filter(x => String(x.txt).toLowerCase().includes(q.toLowerCase()));
      cont.innerHTML = f.length ? f.slice(0, 30).map((x, i) => `<button type="button" class="tj-rq" data-i="${lista.indexOf(x)}">${esc(x.txt)}</button>`).join('')
        : `<div class="tj-pt">${lista.length ? 'Sin coincidencias.' : 'Todavía no hay respuestas rápidas cargadas.'}</div>`;
      cont.querySelectorAll('[data-i]').forEach(x => x.onclick = () => { insertar(t, lista[+x.dataset.i].txt); abrirPanel(null); });
    };
    pintar('');
    buscar.oninput = () => pintar(buscar.value);
    buscar.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); cont.querySelector('[data-i]')?.click(); }
      if (e.key === 'Escape') { e.preventDefault(); abrirPanel(null); t.focus(); }
    };
    buscar.focus();
  }
  botones.rap.onclick = () => abrirPanel('rap');
  botones.emo.onclick = () => abrirPanel('emo');

  const boton = b.querySelector('[data-tj="env"]');
  async function enviar() {
    const texto = t.value.trim();
    if (!texto) { err.textContent = 'Escribí un mensaje antes de enviar.'; t.focus(); return; }
    const otro = otroEscribiendo(n.id);
    if (otro) { err.textContent = `${String(otro.nombre || 'Otra persona').split(' ')[0]} ya le está escribiendo a este cliente.`; return; }
    boton.disabled = true;
    try {
      await post(`/negociaciones/${n.id}/mensajes`, { texto });
      BORRADORES.delete(n.id); t.value = ''; ajustar(); abrirPanel(null);
      if (escribiendo) { escribiendo = false; avisarRedaccionTarjeta(n.id, false); }
      toast(`Mensaje enviado a ${n.cliente || 'el cliente'}`, 'ok', 'Respuesta rápida');
      alEnviar?.();
    } catch (e) { err.textContent = e.message || 'No se pudo enviar el mensaje.'; }
    finally { boton.disabled = false; }
  }
  boton.onclick = enviar;
}

/** Al redibujar una tarjeta, quien estaba escribiendo en su bandeja sigue escribiendo. */
export function focoBandeja(id) {
  const a = document.activeElement;
  if (!a?.matches?.('[data-resp]') || a.closest('.card')?.dataset.id !== id) return null;
  return { inicio: a.selectionStart, fin: a.selectionEnd };
}
export function restaurarFoco(card, foco) {
  if (!foco) return;
  const t = card.querySelector('[data-resp]'); if (!t) return;
  t.focus(); try { t.setSelectionRange(foco.inicio, foco.fin); } catch {}
}
