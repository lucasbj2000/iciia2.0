/* Sala de novedades: videos cortos que explican cada actualización del CRM.
   La lista vive en /videos/actualizaciones.json; sumar un video es agregar
   una entrada allí y subir el .mp4 y su portada a public/videos/. */
import { $, esc, S } from './core.js';

const LISTA = '/videos/actualizaciones.json';
let videos = [];
let actual = null;
let ultimoFoco = null;
const calma = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const claveVistos = () => 'impar.videoteca.vistos.' + (S.usuario?.id || S.usuario?.usuario || 'anon');
function vistos() {
  try { return new Set(JSON.parse(localStorage.getItem(claveVistos()) || '[]')); } catch { return new Set(); }
}
function marcarVisto(id) {
  const v = vistos(); if (v.has(id)) return; v.add(id);
  try { localStorage.setItem(claveVistos(), JSON.stringify([...v])); } catch { /* sin almacenamiento: solo se pierde la marca */ }
  pintarContador(); pintarLista();
}
const nuevos = () => { const v = vistos(); return videos.filter(x => !v.has(x.id)).length; };

const mmss = s => { s = Math.max(0, Math.floor(Number(s) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fechaLarga = f => { try { return new Date(f + 'T12:00:00').toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return f; } };

const ICONO_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.2v9.6a.8.8 0 0 0 1.2.7l7.6-4.8a.8.8 0 0 0 0-1.4l-7.6-4.8A.8.8 0 0 0 9 7.2z" fill="currentColor"/></svg>';

function crearBoton() {
  if ($('#vt-btn')) return $('#vt-btn');
  const titulo = $('#v-title'); if (!titulo) return null;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'vt-btn'; b.className = 'vt-btn';
  b.setAttribute('aria-label', 'Abrir la sala de novedades en video'); b.title = 'Novedades en video';
  b.innerHTML = `<span class="vt-perfo" aria-hidden="true"></span><span class="vt-pantallita" aria-hidden="true"><i class="vt-luz"></i>${ICONO_PLAY}</span><span class="vt-btxt"><b>Novedades</b><small>en video</small></span><span class="vt-n" id="vt-n" hidden></span>`;
  titulo.insertAdjacentElement('afterend', b);
  b.addEventListener('click', () => abrir());
  return b;
}

function pintarContador() {
  const n = nuevos(), e = $('#vt-n'), b = $('#vt-btn'); if (!e || !b) return;
  e.hidden = !n; e.textContent = n > 9 ? '9+' : String(n);
  b.classList.toggle('estreno', n > 0);
  b.setAttribute('aria-label', n ? `Abrir la sala de novedades en video. ${n} ${n === 1 ? 'video nuevo' : 'videos nuevos'}` : 'Abrir la sala de novedades en video');
}

function crearSala() {
  let sala = $('#vt'); if (sala) return sala;
  sala = document.createElement('div');
  sala.id = 'vt'; sala.className = 'vt'; sala.hidden = true;
  sala.setAttribute('role', 'dialog'); sala.setAttribute('aria-modal', 'true'); sala.setAttribute('aria-labelledby', 'vt-tit');
  sala.innerHTML = `
    <div class="vt-fondo" data-cerrar></div>
    <div class="vt-haz" aria-hidden="true"></div>
    <section class="vt-sala">
      <span class="vt-barra" aria-hidden="true"></span>
      <header class="vt-cab">
        <div><h2 id="vt-tit">Sala de novedades</h2><p>Videos cortos con lo nuevo del CRM IMPAR.</p></div>
        <button type="button" class="vt-x" data-cerrar aria-label="Cerrar la sala de novedades">✕</button>
      </header>
      <div class="vt-cuerpo">
        <div class="vt-proyeccion"><video id="vt-video" controls playsinline preload="metadata"></video></div>
        <div class="vt-lado">
          <div class="vt-info" aria-live="polite"></div>
          <div class="vt-rollo">
            <h3>Todos los videos</h3>
            <div class="vt-lista" role="list"></div>
            <div class="vt-proximo" aria-hidden="true"><span class="vt-claqueta"></span><span>Con cada actualización se suma un video nuevo a esta sala.</span></div>
          </div>
        </div>
      </div>
    </section>`;
  document.body.appendChild(sala);
  sala.addEventListener('click', e => { if (e.target.closest('[data-cerrar]')) cerrar(); });
  sala.addEventListener('keydown', teclado);
  const v = $('#vt-video', sala);
  v.addEventListener('play', () => actual && marcarVisto(actual.id));
  v.addEventListener('timeupdate', marcarCapitulo);
  sala.querySelector('.vt-lista').addEventListener('click', e => {
    const c = e.target.closest('[data-id]'); if (!c) return;
    const x = videos.find(y => y.id === c.dataset.id); if (x) elegir(x, true);
  });
  sala.querySelector('.vt-info').addEventListener('click', e => {
    const c = e.target.closest('[data-t]'); if (!c) return;
    v.currentTime = Number(c.dataset.t) || 0; v.play().catch(() => {});
  });
  return sala;
}

function pintarLista() {
  const sala = $('#vt'); if (!sala) return;
  const v = vistos();
  sala.querySelector('.vt-lista').innerHTML = videos.map(x => `
    <button type="button" role="listitem" class="vt-cuadro${actual?.id === x.id ? ' activo' : ''}" data-id="${esc(x.id)}" aria-current="${actual?.id === x.id ? 'true' : 'false'}">
      <span class="vt-mini"><img src="${esc(x.poster)}" alt="" loading="lazy" width="54" height="68"><i>${ICONO_PLAY}</i></span>
      <span class="vt-ctxt"><b>${esc(x.titulo)}</b><small>${esc(fechaLarga(x.fecha))} · ${esc(x.duracion || '')}</small></span>
      <span class="vt-sello ${v.has(x.id) ? 'visto' : 'nuevo'}">${v.has(x.id) ? 'Visto' : 'Nuevo'}</span>
    </button>`).join('');
}

function elegir(x, reproducir) {
  actual = x;
  const sala = crearSala(), v = $('#vt-video', sala);
  if (v.dataset.id !== x.id) { v.poster = x.poster || ''; v.src = x.archivo; v.dataset.id = x.id; }
  sala.querySelector('.vt-info').innerHTML = `
    <span class="vt-fecha">Estreno · ${esc(fechaLarga(x.fecha))}</span>
    <h3>${esc(x.titulo)}</h3>
    <p>${esc(x.descripcion || '')}</p>
    ${(x.capitulos || []).length ? `<ol class="vt-caps">${x.capitulos.map(c => `<li><button type="button" data-t="${Number(c.t) || 0}"><span>${mmss(c.t)}</span>${esc(c.titulo)}</button></li>`).join('')}</ol>` : ''}`;
  pintarLista();
  if (reproducir) v.play().catch(() => {});
}

function marcarCapitulo() {
  const sala = $('#vt'), v = $('#vt-video'); if (!sala || !v) return;
  const caps = [...sala.querySelectorAll('.vt-caps [data-t]')];
  let k = -1; caps.forEach((c, i) => { if (v.currentTime >= Number(c.dataset.t) - 0.2) k = i; });
  caps.forEach((c, i) => c.classList.toggle('activo', i === k));
}

/* El haz sale del botón y se abre hasta los bordes de la pantalla del proyector. */
function trazarHaz(sala) {
  const b = $('#vt-btn'), s = sala.querySelector('.vt-sala'), haz = sala.querySelector('.vt-haz');
  if (!b || !s) return;
  const o = b.querySelector('.vt-pantallita')?.getBoundingClientRect() || b.getBoundingClientRect();
  const r = s.getBoundingClientRect();
  const ox = o.left + o.width / 2, oy = o.top + o.height / 2;
  haz.style.clipPath = `polygon(${ox - 6}px ${oy}px, ${ox + 6}px ${oy}px, ${r.right}px ${r.top + 8}px, ${r.right}px ${r.bottom}px, ${r.left}px ${r.bottom}px, ${r.left}px ${r.top + 8}px)`;
  haz.style.setProperty('--ox', ox + 'px'); haz.style.setProperty('--oy', oy + 'px');
}

function abrir(id) {
  if (!videos.length) return;
  const sala = crearSala();
  ultimoFoco = document.activeElement;
  const v = vistos();
  const x = videos.find(y => y.id === id) || videos.find(y => !v.has(y.id)) || videos[0];
  elegir(x, false);
  sala.hidden = false; sala.classList.remove('cerrando', 'abierto');
  document.documentElement.classList.add('vt-abierta');
  trazarHaz(sala);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sala.classList.add('abierto');
    setTimeout(() => { sala.querySelector('.vt-x')?.focus({ preventScroll: true }); }, calma() ? 0 : 700);
  }));
}

function cerrar() {
  const sala = $('#vt'); if (!sala || sala.hidden || sala.classList.contains('cerrando')) return;
  const v = $('#vt-video', sala); try { v.pause(); } catch { /* nada */ }
  sala.classList.add('cerrando'); sala.classList.remove('abierto');
  const fin = () => { sala.hidden = true; sala.classList.remove('cerrando'); document.documentElement.classList.remove('vt-abierta'); (ultimoFoco || $('#vt-btn'))?.focus?.({ preventScroll: true }); };
  if (calma()) fin(); else setTimeout(fin, 420);
}

function teclado(e) {
  if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
  if (e.key !== 'Tab') return;
  const f = [...$('#vt').querySelectorAll('button, video, [href], [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
}

export async function iniciarVideoteca() {
  const b = crearBoton(); if (!b) return;
  b.hidden = true;
  try {
    const r = await fetch(LISTA, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    videos = (Array.isArray(j?.videos) ? j.videos : []).filter(x => x && x.id && x.archivo)
      .sort((a, c) => String(c.fecha).localeCompare(String(a.fecha)));
  } catch (e) { console.warn('[impar] Videos de novedades no disponibles:', e.message); videos = []; }
  b.hidden = !videos.length;
  pintarContador();
  addEventListener('resize', () => { const s = $('#vt'); if (s && !s.hidden) trazarHaz(s); });
}

export const abrirVideoteca = abrir;
