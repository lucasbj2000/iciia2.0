// IMPAR · Enlaces de WhatsApp por agente: el cliente que escribe por el enlace queda asignado a ese agente.
import { $, $$, esc, get, toast, modal, cerrar } from './core.js';

async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); }
  catch {
    const t = document.createElement('textarea'); t.value = texto; t.setAttribute('readonly', '');
    t.style.position = 'fixed'; t.style.opacity = '0'; document.body.append(t); t.select();
    document.execCommand('copy'); t.remove();
  }
  toast('Enlace copiado', 'ok');
}

export async function abrirMiEnlace() {
  let e;
  try { e = await get('/enlaces/mio'); } catch (err) { return toast(err.message, 'bad'); }
  modal(`<div class="enlace-agente">
    <h3 style="margin-top:0">🔗 Tu enlace de WhatsApp</h3>
    <p style="color:var(--muted);font-size:var(--fs-sm);margin:0 0 12px">Enviáselo a tus clientes. Al abrirlo, escriben al
      <b>+${esc(e.numero)}</b> y la conversación te queda asignada a vos.</p>
    <div class="row" style="gap:8px;align-items:center">
      <input id="enl-url" class="mono" readonly value="${esc(e.whatsapp)}" style="flex:1">
      <button class="btn" id="enl-copiar">Copiar</button></div>
    <div style="margin-top:12px;font-size:var(--fs-sm)"><span style="color:var(--muted)">Mensaje que verá el cliente:</span><br>
      <b>${esc(e.mensaje)}</b></div>
    <div style="margin-top:12px;font-size:var(--fs-sm);color:var(--muted)">Últimos 30 días: <b>${e.negociaciones30}</b> clientes recibidos por tu enlace.</div>
    <div style="margin-top:10px;font-size:12px;color:var(--muted)">Para que se asigne, el cliente debe enviar el saludo que aparece escrito. Puede agregar su consulta.</div>
    <div class="row" style="margin-top:16px;gap:8px;justify-content:flex-end">
      <a class="btn ghost" href="${esc(e.whatsapp)}" target="_blank" rel="noopener">Probar</a>
      <button class="btn ghost" id="enl-cerrar">Cerrar</button></div></div>`);
  $('#enl-copiar').onclick = () => copiar(e.whatsapp);
  $('#enl-cerrar').onclick = cerrar;
}

export async function vistaEnlacesAdmin(caja) {
  const lista = await get('/enlaces');
  caja.innerHTML = `<div class="card-box">
    <h3>🔗 Enlaces de WhatsApp por usuario</h3>
    <div style="color:var(--muted);font-size:var(--fs-sm);line-height:1.7;margin-bottom:12px">
      Cada enlace abre WhatsApp directamente (wa.me) al <b>+${esc(lista[0]?.numero || '')}</b> con un saludo que identifica al usuario.
      Cuando el cliente lo envía, la conversación se asigna directamente a ese usuario (sin bot de recepción),
      aunque el cliente ya tuviera otro responsable. Cada usuario ve el suyo con el botón 🔗 junto a «Cerrar sesión».</div>
    <button class="btn ghost sm" id="enl-todos" style="margin-bottom:10px">Copiar todos (nombre + enlace)</button>
    <table><thead><tr><th>Nombre</th><th>Sucursal</th><th>Enlace</th><th title="Negociaciones asignadas por enlace, 30 días">Clientes</th><th></th></tr></thead>
    <tbody>${lista.map((e, i) => `<tr><td><b>${esc(e.nombre)}</b><br><small class="mono" style="color:var(--muted)">${esc(e.usuario)}</small></td>
      <td>${esc(e.sucursal || '—')}</td><td class="mono" style="font-size:12px;word-break:break-all;max-width:420px">${esc(e.whatsapp)}</td>
      <td>${e.negociaciones30}</td>
      <td><button class="btn ghost sm" data-copiar="${i}">Copiar</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-copiar]', caja).forEach(b => b.onclick = () => copiar(lista[Number(b.dataset.copiar)].whatsapp));
  $('#enl-todos', caja).onclick = () => copiar(lista.map(e => `${e.nombre}: ${e.whatsapp}`).join('\n'));
}
