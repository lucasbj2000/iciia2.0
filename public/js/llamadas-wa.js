/* IMPAR · Llamadas de WhatsApp en prueba.
   Solo se carga la interfaz si el servidor confirma que este usuario es el administrador probador.
   El audio va directo entre el navegador y WhatsApp (WebRTC); el servidor solo hace la señalización. */
import { $, esc, get, post, toast, esAdmin } from './core.js';

let estado = null;          // respuesta de /llamadas/estado
let pc = null, micro = null, actual = null, cronometro = null, tono = null, silenciado = false;
const respuestasPendientes = new Map();
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const dig = v => String(v || '').replace(/\D/g, '');
const telVisible = t => { const d = dig(t); return d.startsWith('595') ? '+595 ' + d.slice(3, 6) + ' ' + d.slice(6, 9) + ' ' + d.slice(9) : '+' + d; };
const IC = {
  tel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  colgar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14.5c5-4.7 13-4.7 18 0l-2.2 2.6-3.6-1.5v-2.4a10 10 0 0 0-6.4 0v2.4l-3.6 1.5z" fill="currentColor"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>'
};

/* ---------- inicio ---------- */
export async function iniciarLlamadas() {
  if (!esAdmin()) return; // el resto del equipo ni siquiera consulta esta función
  try { estado = await get('/llamadas/estado'); } catch { return; }
  if (!estado?.visible) return;
  crearBotonCabecera();
  window.addEventListener('impar:llamada', e => recibirEvento(e.detail || {}));
  window.addEventListener('impar:ficha-lista', e => botonFicha(e.detail || {}));
}
const habilitado = () => !!(estado?.visible && estado.activo && estado.probador);

function crearBotonCabecera() {
  if ($('#ll-btn')) return;
  const ref = $('#vt-btn') || $('#v-title'); if (!ref) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'll-btn'; b.className = 'll-btn';
  b.title = 'Llamadas de WhatsApp (en prueba, solo visible para vos)';
  b.setAttribute('aria-label', 'Abrir el panel de llamadas de WhatsApp en prueba');
  b.innerHTML = `${IC.tel}<span class="ll-btxt">Llamadas</span><span class="ll-prueba">Prueba</span>`;
  ref.insertAdjacentElement('afterend', b);
  b.addEventListener('click', abrirPanel);
  pintarBoton();
}
function pintarBoton() { $('#ll-btn')?.classList.toggle('activo', habilitado()); }

/* ---------- panel de prueba ---------- */
const NIVEL = { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: Infinity };
async function abrirPanel() {
  try { estado = await get('/llamadas/estado'); } catch (e) { toast(e.message, 'bad'); return; }
  if (!estado.visible) { $('#ll-btn')?.remove(); return; }
  pintarBoton();
  let hist = [];
  if (estado.visible) hist = await get('/llamadas/historial').catch(() => []);
  const m = estado.meta || {}, num = m.numero || {};
  const nivel = NIVEL[num.nivel] ?? null;
  const metaActivo = m.calling?.status === 'ENABLED';
  const icono = m.calling?.call_icon_visibility;
  cerrarPanel();
  const d = document.createElement('div');
  d.id = 'll-panel'; d.className = 'll-panel'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'll-tit');
  d.innerHTML = `<div class="ll-velo" data-cerrar></div>
   <section class="ll-caja">
    <header><div><h2 id="ll-tit">Llamadas de WhatsApp <span class="ll-prueba">Prueba</span></h2>
      <p>Solo vos ves este panel. El resto del equipo y los clientes no ven nada hasta que lo habilites para todos.</p></div>
      <button type="button" class="ll-x" data-cerrar aria-label="Cerrar">✕</button></header>
    <div class="ll-cuerpo">
     <div class="ll-estado ${estado.activo ? 'on' : ''}">
       <span class="ll-luz"></span>
       <div><b>${estado.activo ? 'Activas en modo prueba' : 'Desactivadas'}</b>
       <small>${!estado.canales?.length ? 'No hay una línea de WhatsApp Cloud API conectada.'
         : `${esc(num.nombre || 'Línea Cloud API')} ${num.telefono ? '· ' + esc(num.telefono) : ''} · En Meta: ${metaActivo ? 'llamadas habilitadas' : 'llamadas apagadas'}${metaActivo ? (icono === 'DISABLE_ALL' ? ', ícono oculto a los clientes' : ', ícono visible') : ''}`}</small></div>
       ${estado.canales?.length ? (estado.activo
         ? '<button type="button" class="btn ghost sm" id="ll-off">Desactivar</button>'
         : '<button type="button" class="btn sm" id="ll-on">Activar en modo prueba</button>') : ''}
     </div>
     ${estado.canales?.length > 1 && !estado.activo ? `<label class="ll-campo">Línea para llamadas<select id="ll-canal">${estado.canales.map(c => `<option value="${esc(c.id)}" ${c.id === estado.canal_id ? 'selected' : ''}>${esc(c.nombre || c.phone_number_id)}</option>`).join('')}</select></label>` : ''}
     ${m.error || m.ajustesError ? `<p class="ll-aviso bad">${esc(m.error || m.ajustesError)}</p>` : ''}
     ${nivel !== null && nivel < 2000 ? `<p class="ll-aviso">Meta pide que la línea tenga un límite de al menos 2.000 contactos por día para llamar a clientes. Esta línea tiene ${num.nivel === 'TIER_1K' ? '1.000' : esc(String(nivel))}. Las llamadas que el cliente inicia desde el botón igual se pueden probar.</p>` : ''}
     <div class="ll-prueba-caja" ${estado.activo ? '' : 'hidden'}>
       <h3>Probar con tu propio WhatsApp</h3>
       <label class="ll-campo">Número de prueba (con 595)<input id="ll-num" inputmode="tel" placeholder="595981123456" autocomplete="off"></label>
       <div class="ll-pasos">
         <button type="button" class="ll-paso" data-acc="boton"><b>Recibir una llamada</b><small>Te enviamos un botón «Llamar a IMPAR». Al tocarlo, la llamada suena acá.</small></button>
         <button type="button" class="ll-paso" data-acc="permiso"><b>Pedir permiso para llamarte</b><small>WhatsApp exige que el cliente acepte antes de recibir llamadas de la empresa.</small></button>
         <button type="button" class="ll-paso" data-acc="verificar"><b>Ver si ya diste permiso</b><small>Consulta el permiso vigente en Meta.</small></button>
         <button type="button" class="ll-paso llamar" data-acc="llamar"><b>${IC.tel} Llamar</b><small>Hace la llamada desde el CRM con el micrófono de esta computadora.</small></button>
       </div>
       <p class="ll-res" id="ll-res" role="status"></p>
     </div>
     <div class="ll-hist"><h3>Últimas llamadas</h3>${hist.length ? `<ul>${hist.map(h => `<li><span class="ll-dir ${h.direccion}">${h.direccion === 'entrante' ? '↙' : '↗'}</span>
       <span><b>${esc(h.cliente || telVisible(h.telefono))}</b><small>${esc(new Date(h.creado).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' }))} · ${esc(etiquetaEstado(h.estado))}${h.duracion ? ' · ' + fmt(h.duracion) : ''}</small></span></li>`).join('')}</ul>` : '<p class="ll-vacio">Todavía no hay llamadas.</p>'}</div>
    </div>
   </section>`;
  document.body.appendChild(d);
  d.addEventListener('click', e => { if (e.target.closest('[data-cerrar]')) cerrarPanel(); });
  d.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarPanel(); });
  $('#ll-on', d)?.addEventListener('click', async ev => {
    if (!confirm('Se habilitarán las llamadas en la línea de WhatsApp con el ícono OCULTO para los clientes. Solo vos vas a poder usarlas. ¿Continuar?')) return;
    ev.target.disabled = true;
    try { await post('/llamadas/activar', { canal_id: $('#ll-canal', d)?.value || null }); toast('Llamadas activadas en modo prueba', 'ok'); abrirPanel(); }
    catch (e) { toast(e.message, 'bad'); ev.target.disabled = false; }
  });
  $('#ll-off', d)?.addEventListener('click', async ev => {
    ev.target.disabled = true;
    try { await post('/llamadas/desactivar', {}); toast('Llamadas desactivadas', 'ok'); abrirPanel(); }
    catch (e) { toast(e.message, 'bad'); ev.target.disabled = false; }
  });
  d.querySelectorAll('[data-acc]').forEach(b => b.addEventListener('click', () => accionPrueba(b.dataset.acc, b)));
  setTimeout(() => ($('#ll-num', d) || $('.ll-x', d))?.focus(), 30);
}
function cerrarPanel() { $('#ll-panel')?.remove(); }
async function accionPrueba(acc, b) {
  const tel = dig($('#ll-num')?.value);
  const res = $('#ll-res');
  if (tel.length < 10) { res.textContent = 'Escribí tu número con código de país, por ejemplo 595981123456.'; $('#ll-num')?.focus(); return; }
  b.disabled = true; res.textContent = 'Procesando…';
  try {
    if (acc === 'boton') { await post('/llamadas/boton-prueba', { tel }); res.textContent = 'Listo. Abrí WhatsApp en tu celular y tocá «Llamar a IMPAR». La llamada va a sonar en esta pantalla.'; }
    if (acc === 'permiso') { await post('/llamadas/permiso', { tel }); res.textContent = 'Solicitud enviada. Aceptala en tu WhatsApp y después probá «Llamar».'; }
    if (acc === 'verificar') { const p = await get('/llamadas/permiso?tel=' + tel); res.textContent = p.estado === 'no_permission' ? 'Todavía no hay permiso para llamar a este número.' : `Permiso ${p.estado === 'temporary' ? 'temporal' : 'vigente'}${p.vence ? ' hasta ' + new Date(p.vence * 1000).toLocaleString('es-PY') : ''}.`; }
    if (acc === 'llamar') { cerrarPanel(); await llamar(tel, null, null); }
  } catch (e) { if (res) res.textContent = e.message; }
  finally { b.disabled = false; }
}

/* ---------- botón en la ficha ---------- */
function botonFicha({ id, tel, cliente }) {
  if (!habilitado() || !dig(tel)) return;
  const acc = document.querySelector('.ficha-acciones'); if (!acc || acc.querySelector('.ll-ficha')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn ghost sm ll-ficha';
  b.title = 'Llamar por WhatsApp (prueba, solo visible para vos)';
  b.innerHTML = `${IC.tel}<span class="ficha-acc-t">Llamar</span>`;
  b.addEventListener('click', () => {
    const elegido = dig(document.querySelector('#f-telefono-chat')?.value);
    llamar(elegido.length >= 10 ? elegido : dig(tel), id, cliente);
  });
  acc.prepend(b);
}

/* ---------- WebRTC ---------- */
async function prepararAudio() {
  micro = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: 'max-bundle' });
  micro.getTracks().forEach(t => pc.addTrack(t, micro));
  pc.ontrack = e => { const a = audioRemoto(); a.srcObject = e.streams[0] || new MediaStream([e.track]); a.play().catch(() => {}); };
  pc.onconnectionstatechange = () => { if (['failed'].includes(pc?.connectionState)) { toast('Se perdió la conexión de audio de la llamada.', 'bad'); colgar(); } };
}
function audioRemoto() { let a = $('#ll-audio'); if (!a) { a = document.createElement('audio'); a.id = 'll-audio'; a.autoplay = true; document.body.appendChild(a); } return a; }
function esperarICE() {
  return new Promise(res => {
    if (!pc || pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, 3000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc?.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}
function limpiarAudio() {
  try { pc?.close(); } catch { /* nada */ }
  micro?.getTracks().forEach(t => t.stop());
  pc = null; micro = null; silenciado = false;
  const a = $('#ll-audio'); if (a) a.srcObject = null;
}

/* ---------- llamadas ---------- */
async function llamar(tel, negId, nombre) {
  if (!habilitado()) { toast('Las llamadas no están activas.', 'bad'); return; }
  if (actual) { toast('Ya hay una llamada en curso.', 'bad'); return; }
  actual = { direccion: 'saliente', telefono: tel, nombre, estado: 'preparando' };
  tarjeta();
  try {
    const p = await get('/llamadas/permiso?tel=' + tel).catch(() => null);
    if (p && p.estado === 'no_permission') {
      actual = null; tarjeta();
      if (confirm('Este número todavía no dio permiso para recibir llamadas de IMPAR. ¿Le enviamos la solicitud de permiso por WhatsApp?')) {
        await post('/llamadas/permiso', { tel }); toast('Solicitud de permiso enviada', 'ok');
      }
      return;
    }
    await prepararAudio();
    const oferta = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(oferta);
    await esperarICE();
    actual.estado = 'llamando'; tarjeta();
    const r = await post('/llamadas/iniciar', { tel, sdp: pc.localDescription.sdp, negociacion_id: negId || null });
    actual.call_id = r.call_id; if (r.nombre && !actual.nombre) actual.nombre = r.nombre;
    tarjeta();
    const pend = respuestasPendientes.get(r.call_id); if (pend) { respuestasPendientes.delete(r.call_id); await aplicarRespuesta(pend); }
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'Permití el uso del micrófono para llamar.' : e.message, 'bad');
    limpiarAudio(); actual = null; tarjeta();
  }
}
async function aplicarRespuesta(sdp) {
  if (!pc || !sdp) return;
  try { await pc.setRemoteDescription({ type: 'answer', sdp }); actual.estado = 'conectando'; tarjeta(); }
  catch { toast('WhatsApp devolvió un audio que el navegador no aceptó.', 'bad'); }
}
async function atender() {
  if (!actual || actual.direccion !== 'entrante') return;
  pararTono();
  actual.estado = 'conectando'; tarjeta();
  try {
    await prepararAudio();
    await pc.setRemoteDescription({ type: 'offer', sdp: actual.sdp });
    const resp = await pc.createAnswer();
    await pc.setLocalDescription(resp);
    await esperarICE();
    await post(`/llamadas/${encodeURIComponent(actual.call_id)}/atender`, { sdp: pc.localDescription.sdp });
    enCurso();
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'Permití el uso del micrófono para atender.' : e.message, 'bad');
    limpiarAudio(); actual = null; tarjeta();
  }
}
async function rechazar() {
  if (!actual?.call_id) return;
  const id = actual.call_id; pararTono(); actual = null; tarjeta();
  post(`/llamadas/${encodeURIComponent(id)}/rechazar`, {}).catch(e => toast(e.message, 'bad'));
}
async function colgar() {
  const id = actual?.call_id;
  pararTono(); limpiarAudio(); clearInterval(cronometro); actual = null; tarjeta();
  if (id) post(`/llamadas/${encodeURIComponent(id)}/cortar`, {}).catch(() => {});
}
function enCurso() {
  if (!actual) return;
  actual.estado = 'en_curso'; actual.desde = actual.desde || Date.now();
  clearInterval(cronometro); cronometro = setInterval(() => { const e = $('#ll-tiempo'); if (e && actual?.desde) e.textContent = fmt((Date.now() - actual.desde) / 1000); }, 1000);
  tarjeta();
}
function silenciar() {
  silenciado = !silenciado; micro?.getAudioTracks().forEach(t => { t.enabled = !silenciado; }); tarjeta();
}

/* ---------- eventos del servidor ---------- */
async function recibirEvento(ev) {
  if (!habilitado()) return;
  if (ev.tipo === 'entrante') {
    if (actual) return; // ya hay una llamada; Meta la corta sola si nadie atiende
    actual = { direccion: 'entrante', call_id: ev.call_id, telefono: ev.telefono, nombre: ev.nombre, negociacion_id: ev.negociacion_id, sdp: ev.sdp, estado: 'sonando' };
    tarjeta(); sonarTono();
    try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Llamada de WhatsApp', { body: ev.nombre || telVisible(ev.telefono), tag: 'll-' + ev.call_id }); } catch { /* sin aviso */ }
  } else if (ev.tipo === 'respuesta') {
    if (actual?.call_id === ev.call_id) await aplicarRespuesta(ev.sdp); else respuestasPendientes.set(ev.call_id, ev.sdp);
  } else if (ev.tipo === 'estado' && actual?.call_id === ev.call_id) {
    if (ev.estado === 'en_curso') enCurso();
    else if (ev.estado === 'rechazada') { toast('El cliente rechazó la llamada.', 'bad'); limpiarAudio(); actual = null; tarjeta(); }
    else { actual.estado = ev.estado; tarjeta(); }
  } else if (ev.tipo === 'atendida' && actual?.call_id === ev.call_id && actual.estado === 'sonando') {
    pararTono(); actual = null; tarjeta();
  } else if (ev.tipo === 'fin' && actual?.call_id === ev.call_id) {
    pararTono(); limpiarAudio(); clearInterval(cronometro);
    if (ev.estado === 'perdida') toast('Llamada perdida de ' + (actual.nombre || telVisible(actual.telefono)), 'warn');
    else if (ev.estado === 'sin_respuesta') toast('El cliente no atendió.', 'warn');
    actual = null; tarjeta();
  } else if (ev.tipo === 'permiso') {
    toast(ev.respuesta === 'acepto' ? `El número ${telVisible(ev.telefono)} aceptó recibir llamadas.` : `El número ${telVisible(ev.telefono)} no aceptó recibir llamadas.`, ev.respuesta === 'acepto' ? 'ok' : 'warn');
  }
}

/* ---------- tarjeta flotante ---------- */
const ETQ = { preparando: 'Preparando el micrófono…', llamando: 'Llamando…', sonando_cliente: 'Sonando en el celular del cliente…', conectando: 'Conectando audio…', sonando: 'Llamada entrante de WhatsApp', en_curso: '' };
function etiquetaEstado(e) { return ({ en_curso: 'en curso', finalizada: 'finalizada', perdida: 'perdida', rechazada: 'rechazada', sin_respuesta: 'sin respuesta', fallida: 'falló', sonando: 'sonando', llamando: 'llamando', conectando: 'conectando', atendiendo: 'atendiendo', sonando_cliente: 'sonando' })[e] || e; }
const fmt = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function tarjeta() {
  let t = $('#ll-card');
  if (!actual) { t?.classList.add('saliendo'); setTimeout(() => { if (!actual) $('#ll-card')?.remove(); }, 260); return; }
  if (!t) { t = document.createElement('div'); t.id = 'll-card'; t.className = 'll-card'; t.setAttribute('role', 'dialog'); t.setAttribute('aria-live', 'assertive'); document.body.appendChild(t); }
  t.classList.remove('saliendo');
  const entrante = actual.direccion === 'entrante' && actual.estado === 'sonando';
  const vivo = actual.estado === 'en_curso';
  t.className = 'll-card' + (entrante ? ' sonando' : '') + (vivo ? ' vivo' : '');
  const nombre = actual.nombre || telVisible(actual.telefono);
  t.innerHTML = `<span class="ll-sello" aria-hidden="true">${IC.tel}</span>
    <div class="ll-av" aria-hidden="true"><i></i><i></i><span>${esc((actual.nombre || '#').trim().charAt(0).toUpperCase())}</span></div>
    <div class="ll-quien"><b>${esc(nombre)}</b><small>${actual.nombre ? esc(telVisible(actual.telefono)) + ' · ' : ''}WhatsApp</small>
      <span class="ll-st">${vivo ? `<i class="ll-onda"></i><span id="ll-tiempo">${fmt((Date.now() - (actual.desde || Date.now())) / 1000)}</span>` : esc(ETQ[actual.estado] || etiquetaEstado(actual.estado))}</span></div>
    <div class="ll-acc">
      ${entrante ? `<button type="button" class="ll-r rojo" data-ll="rechazar" aria-label="Rechazar llamada">${IC.colgar}</button>
        <button type="button" class="ll-r verde" data-ll="atender" aria-label="Atender llamada">${IC.tel}</button>`
      : `${vivo ? `<button type="button" class="ll-r ${silenciado ? 'on' : ''}" data-ll="mute" aria-pressed="${silenciado}" aria-label="${silenciado ? 'Activar micrófono' : 'Silenciar micrófono'}">${silenciado ? IC.micOff : IC.mic}</button>` : ''}
        <button type="button" class="ll-r rojo" data-ll="colgar" aria-label="Cortar llamada">${IC.colgar}</button>`}
    </div>
    ${actual.negociacion_id && entrante ? '<button type="button" class="ll-ver" data-ll="ficha">Ver la negociación</button>' : ''}`;
  t.querySelectorAll('[data-ll]').forEach(b => b.addEventListener('click', () => ({
    atender, rechazar, colgar, mute: silenciar,
    ficha: () => import('./ficha.js').then(m => m.fichaNeg(actual.negociacion_id))
  })[b.dataset.ll]?.()));
  if (entrante) setTimeout(() => t.querySelector('[data-ll="atender"]')?.focus({ preventScroll: true }), 20);
}

/* ---------- tono de llamada (generado, sin archivos) ---------- */
function sonarTono() {
  pararTono();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const golpe = () => {
      [0, 0.45].forEach(d => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = d ? 660 : 880; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + d + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.38);
        o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.4);
      });
    };
    golpe(); const iv = setInterval(golpe, 2200);
    tono = { ctx, iv };
  } catch { tono = null; }
}
function pararTono() { if (!tono) return; clearInterval(tono.iv); try { tono.ctx.close(); } catch { /* nada */ } tono = null; }
