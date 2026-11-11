/* IMPAR · Pasar una conversación de Messenger/Instagram a WhatsApp en la misma negociación. */
import { $, esc, post, toast, nombreLegible } from './core.js';
import { ic } from './iconos.js';

const RED = { messenger: 'Messenger', instagram: 'Instagram' };

/** Solo cuando el cliente escribe por redes y la conversación todavía no sigue por WhatsApp. */
export function bannerRedesHTML(n) {
  if (!['messenger', 'instagram'].includes(n.canal_tipo)) return '';
  const red = RED[n.canal_tipo];
  return `<div class="redes-wa" id="redes-wa">
    <div class="redes-wa-txt">${ic('celular')}<span>Cliente de <b>${red}</b>. Cuando te pase su número, seguí la gestión del pedido por WhatsApp en esta misma negociación.</span></div>
    <button class="btn ghost sm" id="redes-wa-abrir" type="button">Pasar a WhatsApp</button>
    <form class="redes-wa-form" id="redes-wa-form" hidden>
      <label class="field"><span>Número de WhatsApp del cliente</span>
        <input id="redes-wa-num" inputmode="tel" autocomplete="off" placeholder="0981 123 456" value="${esc(n.tel || '')}"></label>
      <label class="field"><span>Primer mensaje por WhatsApp (opcional)</span>
        <textarea id="redes-wa-msg" rows="3">¡Hola${n.cliente && !/^(Messenger|Instagram) /.test(n.cliente) ? ' ' + esc(nombreLegible(n.cliente).split(' ')[0]) : ''}! Te escribimos de Papelerías IMPAR por tu consulta en ${red}. Seguimos por aquí para gestionar tu pedido.</textarea></label>
      <div class="err" id="redes-wa-err"></div>
      <div class="redes-wa-acc"><button class="btn ghost sm" type="button" id="redes-wa-cancelar">Cancelar</button>
        <button class="btn sm" type="submit" id="redes-wa-ok">Pasar a WhatsApp</button></div>
    </form></div>`;
}

export function conectarRedesWhatsApp(n, alTerminar) {
  const caja = $('#redes-wa');
  if (!caja) return;
  const form = $('#redes-wa-form'), abrir = $('#redes-wa-abrir');
  abrir.onclick = () => { form.hidden = false; abrir.hidden = true; $('#redes-wa-num').focus(); };
  $('#redes-wa-cancelar').onclick = () => { form.hidden = true; abrir.hidden = false; };
  form.onsubmit = async ev => {
    ev.preventDefault();
    const err = $('#redes-wa-err'), boton = $('#redes-wa-ok');
    const numero = $('#redes-wa-num').value.trim();
    err.textContent = '';
    if (String(numero).replace(/\D/g, '').length < 9) return err.textContent = 'Escribí el número completo, por ejemplo 0981 123 456.';
    boton.disabled = true;
    try {
      const r = await post(`/negociaciones/${n.id}/pasar-whatsapp`, { numero, mensaje: $('#redes-wa-msg').value });
      toast(r.unificado ? 'El número ya era de un cliente: las fichas quedaron unificadas y la conversación sigue por WhatsApp.'
        : `La conversación sigue por WhatsApp («${r.canal}»).`, 'ok', 'WhatsApp');
      if (r.aviso) toast(r.aviso, 'warn', 'WhatsApp');
      alTerminar?.(r.negociacionId);
    } catch (e) { err.textContent = e.message; boton.disabled = false; }
  };
}
