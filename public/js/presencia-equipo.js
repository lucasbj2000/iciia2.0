/* IMPAR · Presencia del equipo en tiempo real.
   Quién está en cada conversación y quién le está escribiendo al cliente, para no responder dos veces. */
import { $, $$, S, esc, iniciales, get, post } from './core.js';

S.presencia = S.presencia || {};
const otros = id => (S.presencia[id] || []).filter(p => p.id !== S.usuario?.id);
const primerNombre = p => esc(String(p.nombre || '').split(' ')[0] || 'Alguien');
const avatar = (p, cls = '') => `<span class="eq-av${p.redactando ? ' redacta' : ''} ${cls}" title="${esc(p.nombre)}${p.redactando ? ' está escribiendo' : ' está en esta conversación'}">${
  p.foto ? `<img src="${esc(p.foto)}" alt="">` : esc(iniciales(p.nombre))}</span>`;

/** Avatares para la tarjeta del tablero (vacío si nadie más la está mirando). */
export function avataresEquipo(id) {
  const o = otros(id);
  if (!o.length) return '';
  const nombres = o.map(p => p.nombre).join(', ');
  const escribe = o.some(p => p.redactando);
  return `<span class="card-equipo${escribe ? ' redacta' : ''}" role="img" aria-label="${esc(nombres)} ${o.length > 1 ? 'están' : 'está'} en esta conversación${escribe ? ' (escribiendo)' : ''}">${
    o.slice(0, 3).map(p => avatar(p)).join('')}${o.length > 3 ? `<span class="eq-av mas">+${o.length - 3}</span>` : ''}</span>`;
}

function pintarTarjeta(id) {
  const card = $(`.card[data-id="${id}"]`);
  if (!card) return;
  const html = avataresEquipo(id), actual = card.querySelector('.card-equipo');
  if (!html) { actual?.remove(); return; }
  const tmp = document.createElement('div'); tmp.innerHTML = html;
  const nuevo = tmp.firstElementChild;
  if (actual) actual.replaceWith(nuevo); else { nuevo.classList.add('llega'); card.prepend(nuevo); }
}

function pintarFicha(id) {
  const ficha = $('.conversation-modal');
  if (!ficha || ficha.dataset.negociacionId !== id) return;
  const o = otros(id);
  let tira = $('#f-equipo', ficha);
  if (!tira) {
    const h3 = $('.modal-h h3', ficha); if (!h3) return;
    tira = document.createElement('div'); tira.id = 'f-equipo'; tira.className = 'f-equipo'; tira.setAttribute('aria-live', 'polite');
    h3.after(tira);
  }
  tira.innerHTML = o.length ? `${o.slice(0, 4).map(p => avatar(p)).join('')}<span class="f-equipo-txt">${
    o.length === 1 ? `${primerNombre(o[0])} también está acá` : `${o.length} personas más están acá`}</span>` : '';
  tira.hidden = !o.length;

  const redactan = o.filter(p => p.redactando);
  let aviso = $('#f-coordina', ficha);
  const compose = $('.chat-compose', ficha) || $('#remsg', ficha)?.closest('.card-box, div');
  if (!aviso && compose) {
    aviso = document.createElement('div'); aviso.id = 'f-coordina'; aviso.className = 'f-coordina'; aviso.setAttribute('role', 'status');
    compose.before(aviso);
  }
  if (!aviso) return;
  aviso.hidden = !redactan.length;
  aviso.innerHTML = redactan.length ? `${avatar(redactan[0])}<span><b>${primerNombre(redactan[0])}${redactan.length > 1 ? ` y ${redactan.length - 1} más` : ''}</b> ${
    redactan.length > 1 ? 'le están escribiendo' : 'le está escribiendo'} a este cliente. Coordinen antes de responder para no enviar dos respuestas.</span>` : '';
}

export function recibirPresencia({ id, quienes }) {
  if (!id) return;
  if (quienes?.length) S.presencia[id] = quienes; else delete S.presencia[id];
  pintarTarjeta(id); pintarFicha(id);
}

/** Al entrar al tablero: quién está en qué conversación ahora mismo. */
export async function cargarPresencias() {
  const antes = Object.keys(S.presencia);
  S.presencia = await get('/negociaciones/presencia-equipo');
  for (const id of new Set([...antes, ...Object.keys(S.presencia)])) pintarTarjeta(id);
}

/* ---------- Mi presencia en la conversación abierta ---------- */
let seguimiento = null;
function enviar(id, cuerpo, salida = false) {
  if (salida) {
    // Al cerrar la pestaña, fetch con keepalive llega aunque la página se descargue.
    try { fetch(`/api/negociaciones/${id}/viendo`, { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: JSON.stringify(cuerpo) }); } catch {}
    return;
  }
  post(`/negociaciones/${id}/viendo`, cuerpo).then(r => recibirPresencia({ id, quienes: r.quienes })).catch(() => {});
}
function dejar() {
  if (!seguimiento) return;
  const { id, latido, vigia, alSalir } = seguimiento;
  clearInterval(latido); clearInterval(vigia); clearTimeout(seguimiento.pausa);
  window.removeEventListener('pagehide', alSalir);
  seguimiento = null;
  enviar(id, { salir: true }, true);
}

/** La ficha llama esto al abrirse: anuncia «estoy acá» y «estoy escribiendo», y se retira sola al cerrar. */
export function seguirConversacion(id) {
  if (seguimiento?.id === id) { pintarFicha(id); return; }
  dejar();
  const s = seguimiento = { id, redactando: false };
  const marcar = redactando => { s.redactando = redactando; enviar(id, { redactando }); };
  s.latido = setInterval(() => marcar(s.redactando), 20000);
  s.alSalir = () => dejar();
  window.addEventListener('pagehide', s.alSalir);
  const escuchar = () => {
    for (const t of $$('#msg,#remsg')) {
      if (t._presencia) continue;
      t._presencia = true;
      t.addEventListener('input', () => {
        clearTimeout(s.pausa);
        const escribe = !!t.value.trim();
        if (escribe !== s.redactando) marcar(escribe);
        if (escribe) s.pausa = setTimeout(() => { if (seguimiento === s && s.redactando) marcar(false); }, 6000);
      });
    }
    for (const b of $$('#f-enviar,#f-rege')) {
      if (b._presencia) continue;
      b._presencia = true;
      b.addEventListener('click', () => setTimeout(() => { if (seguimiento === s && s.redactando) marcar(false); }, 400));
    }
  };
  // Vigía: si la ficha se cerró o cambió de cliente, me retiro; si se repintó, reengancho.
  s.vigia = setInterval(() => {
    if ($('.conversation-modal')?.dataset.negociacionId !== id) { if (seguimiento === s) dejar(); return; }
    escuchar(); if (!$('#f-equipo') && otros(id).length) pintarFicha(id);
  }, 1500);
  escuchar();
  marcar(false);
  pintarFicha(id);
}
