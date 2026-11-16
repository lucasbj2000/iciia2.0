/* Jornada sin salida marcada: al día siguiente el asesor indica a qué hora terminó y por qué no marcó,
   y vuelve a iniciar su jornada. No se puede saltear: sin esa salida los tiempos del día quedan incompletos. */
import { $, esc, S, get, post, toast } from './core.js';

const ETQ = { disponible: 'Disponible', ocupado: 'En gestión', almuerzo: 'Almuerzo', permiso: 'Permiso' };
let abierta = false, revisadoDia = null, opciones = {}, iniciado = false;
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
const horaPY = iso => new Date(iso).toLocaleTimeString('es-PY', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit', hour12: false });
const diaLargo = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Consulta si quedó una jornada abierta y, si es así, muestra el aviso. Devuelve true si lo mostró. */
export async function revisarJornada(o = {}) {
  Object.assign(opciones, o);
  if (abierta || !S.token || !S.usuario || S.usuario.rol === 'admin') return abierta;
  revisadoDia = hoy();
  let r = null;
  try { r = await get('/jornada/pendiente'); } catch { return false; }
  if (!r?.pendiente) return false;
  mostrar(r.pendiente, r.motivos || {});
  return true;
}

/** Vuelve a revisar cuando cambia el día con el CRM abierto (por ejemplo, una pestaña que quedó de ayer). */
export function iniciarJornada(o = {}) {
  Object.assign(opciones, o);
  if (iniciado) return; iniciado = true;
  const siCambioElDia = () => { if (revisadoDia && revisadoDia !== hoy()) revisarJornada(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') siCambioElDia(); });
  setInterval(siCambioElDia, 5 * 60e3);
}

function mostrar(p, motivos) {
  abierta = true;
  const d = document.createElement('div');
  d.id = 'jr'; d.className = 'jr';
  d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'jr-tit'); d.setAttribute('aria-describedby', 'jr-txt');
  const min = horaPY(p.desde);
  d.innerHTML = `<div class="jr-velo"></div>
   <form class="jr-caja" novalidate>
     <span class="jr-icono" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
     <h2 id="jr-tit">No marcaste tu salida</h2>
     <p id="jr-txt">El <b>${esc(diaLargo(p.dia))}</b> quedaste como «${esc(ETQ[p.estado] || p.estado)}» desde las <b>${esc(min)}</b> y no se registró tu salida. Antes de empezar, contanos qué pasó.</p>
     <label class="jr-campo">¿A qué hora terminaste ese día, más o menos?
       <input type="time" id="jr-hora" required value="${esc(p.sugerida || '')}">
       <small>Tiene que ser después de las ${esc(min)}.${p.sugerida ? ' Te proponemos la hora de salida de tu turno.' : ''}</small></label>
     <fieldset class="jr-motivos"><legend>¿Por qué no marcaste la salida?</legend>
       ${Object.entries(motivos).map(([k, t]) => `<label class="jr-op"><input type="radio" name="jr-motivo" value="${esc(k)}" required><span>${esc(t)}</span></label>`).join('')}
     </fieldset>
     <label class="jr-campo" id="jr-det-c"><span>Detalle <span class="jr-opc" id="jr-opc">(opcional)</span></span>
       <textarea id="jr-det" rows="2" maxlength="300" placeholder="Por ejemplo: se cortó la luz a las 16:30"></textarea></label>
     <p class="jr-error" id="jr-err" role="alert"></p>
     <button type="submit" class="btn jr-ok">Guardar y empezar mi jornada</button>
   </form>`;
  document.body.appendChild(d);
  document.documentElement.classList.add('jr-abierta');
  const form = $('.jr-caja', d), err = $('#jr-err', d);
  form.addEventListener('change', () => {
    const otro = form.querySelector('[name="jr-motivo"]:checked')?.value === 'otro';
    $('#jr-opc', d).textContent = otro ? '(obligatorio)' : '(opcional)';
  });
  // No se cierra con Escape: el aviso se responde para seguir.
  d.addEventListener('keydown', e => { if (e.key === 'Escape') e.preventDefault(); });
  form.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    const hora = $('#jr-hora', d).value, motivo = form.querySelector('[name="jr-motivo"]:checked')?.value, detalle = $('#jr-det', d).value.trim();
    if (!hora) { err.textContent = 'Indicá la hora aproximada en la que terminaste.'; $('#jr-hora', d).focus(); return; }
    if (!motivo) { err.textContent = 'Elegí un motivo.'; form.querySelector('[name="jr-motivo"]').focus(); return; }
    if (motivo === 'otro' && detalle.length < 4) { err.textContent = 'Contanos brevemente el motivo.'; $('#jr-det', d).focus(); return; }
    const b = $('.jr-ok', d); b.disabled = true; b.textContent = 'Guardando…';
    try {
      await post('/jornada/olvido', { hora, motivo, detalle });
      d.remove(); document.documentElement.classList.remove('jr-abierta'); abierta = false;
      toast('Salida registrada. ¡Buen día!', 'ok', 'Jornada');
      // Volver a iniciar: elegir el estado con el que empieza hoy.
      if (typeof opciones.alReiniciar === 'function') setTimeout(opciones.alReiniciar, 250);
    } catch (e2) { err.textContent = e2.message; b.disabled = false; b.textContent = 'Guardar y empezar mi jornada'; }
  });
  setTimeout(() => ($('#jr-hora', d).value ? form.querySelector('[name="jr-motivo"]') : $('#jr-hora', d))?.focus(), 50);
}
