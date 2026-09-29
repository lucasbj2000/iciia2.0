/* ============ Administración · IA y bot ============ */
import { $, $$, esc, get, put, post, toast, vacio } from './core.js';

const TIPO = { whatsapp_qr: ['📱', 'WhatsApp (QR)'], whatsapp_api: ['☁️', 'WhatsApp Cloud API'],
  messenger: ['💬', 'Messenger'], instagram: ['📸', 'Instagram'] };
const campo = 'width:100%;padding:10px 12px;background:var(--surface2);border:1px solid var(--line);border-radius:10px';

export async function vistaIA() {
  const c = await get('/ia/config');
  $('#adm-body').innerHTML = `
  <div class="card-box"><h3>🔑 Conexión con OpenAI</h3>
    <div class="estado-luz" style="margin-bottom:12px">
      <span class="dot ${c.tieneToken ? 'live' : ''}" style="background:${c.tieneToken ? 'var(--ok)' : 'var(--bad)'}"></span>
      ${c.tieneToken ? `Token cargado · <span class="mono">${esc(c.token)}</span>` : 'Sin token: el bot no responde'}</div>
    ${c.tokenIlegible ? `<div style="color:var(--warn);font-size:var(--fs-sm);margin-bottom:10px">
      El token guardado no se puede leer (cambió la clave del servidor). Cargalo de nuevo.</div>` : ''}
    <div class="field"><label>Token de API de OpenAI</label>
      <input id="ia-key" type="password" autocomplete="off" placeholder="${c.tieneToken ? 'Dejá vacío para conservar el actual' : 'sk-...'}"></div>
    <div class="row">
      <div class="field"><label>Modelo</label><input id="ia-mod" list="ia-modelos" value="${esc(c.modelo)}">
        <datalist id="ia-modelos"><option value="gpt-4o-mini"><option value="gpt-4o"><option value="gpt-4.1-mini"><option value="gpt-4.1"></datalist></div>
      <div class="field"><label>Creatividad (0 = precisa · 1 = variada)</label>
        <input id="ia-temp" type="number" min="0" max="1.5" step="0.1" value="${c.temperatura}"></div>
      <div class="field"><label>Máximo de respuestas del bot por conversación</label>
        <input id="ia-max" type="number" min="1" max="100" value="${c.maxRespuestas}"></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="ia-guardar">Guardar conexión</button>
      ${c.tieneToken ? '<button class="btn danger sm" id="ia-borrar">Quitar token</button>' : ''}</div>
    <div style="color:var(--muted);font-size:var(--fs-xs);margin-top:12px;line-height:1.7">
      El token se genera en <b>platform.openai.com → API keys</b> y la cuenta necesita saldo cargado.
      Se guarda cifrado y nunca se vuelve a mostrar completo.</div></div>

  <div class="card-box"><h3>🤖 Bot</h3>
    <label style="display:flex;gap:9px;align-items:center;font-size:var(--fs-sm);margin-bottom:12px">
      <span class="sw"><input type="checkbox" id="ia-act" ${c.activo ? 'checked' : ''}><i></i></span>
      Bot activo: responde a los clientes mientras ningún agente haya escrito en la conversación</label>
    <div class="field"><label>Instrucciones generales (se usan en las líneas que no tienen instrucciones propias)</label>
      <textarea id="ia-ins" rows="8" style="${campo}">${esc(c.instrucciones)}</textarea></div>
    <button class="btn sm" id="ia-guardar-bot">Guardar bot</button></div>

  <div class="card-box"><h3>📱 Instrucciones por línea</h3>
    <p class="sub" style="margin-top:-4px">Cada número o red social puede tener su propio instructivo: por ejemplo,
      la línea de Ventas ofrece productos y la de Postventa gestiona reclamos. Si lo dejás vacío, usa las instrucciones generales.</p>
    ${c.canales.map(l => {
      const [ico, tipo] = TIPO[l.tipo] || ['📨', l.tipo];
      return `<div class="card-box" style="background:var(--surface2);margin-bottom:10px">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <span style="font-size:20px">${ico}</span>
          <div style="flex:1;min-width:0"><b style="font-size:var(--fs-sm);display:block">${esc(l.nombre)}</b>
            <small style="color:var(--muted)">${tipo}${l.sucursal ? ' · ' + esc(l.sucursal) : ''}${l.activo ? '' : ' · canal pausado'}</small></div>
          <label style="display:flex;gap:7px;align-items:center;font-size:var(--fs-xs)">
            <span class="sw"><input type="checkbox" data-lact="${l.id}" ${l.bot_activo ? 'checked' : ''}><i></i></span> Bot en esta línea</label></div>
        <textarea data-lins="${l.id}" rows="5" style="${campo}"
          placeholder="Vacío = usa las instrucciones generales">${esc(l.bot_instrucciones || '')}</textarea>
        <div style="display:flex;gap:7px;margin-top:8px;flex-wrap:wrap">
          <button class="btn sm" data-lguardar="${l.id}">Guardar línea</button>
          <button class="btn ghost sm" data-lprobar="${l.id}">🧪 Probar esta línea</button></div></div>`;
    }).join('') || vacio('📡', 'No hay líneas conectadas', 'Agregalas en Administración → Canales')}</div>

  <div class="card-box"><h3>🧪 Probar el bot</h3>
    <div class="row">
      <div class="field"><label>Línea</label><select id="pr-linea">
        <option value="">Instrucciones generales</option>
        ${c.canales.map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></div>
      <div class="field" style="flex:2"><label>Mensaje del cliente</label>
        <input id="pr-msg" value="Hola, quisiera saber precios y cómo hago el pedido"></div></div>
    <button class="btn" id="pr-ok">Ver qué respondería</button>
    <div id="pr-res" style="margin-top:12px"></div></div>`;

  const guardarConfig = async (datos, msg) => {
    try { await put('/ia/config', datos); toast(msg, 'ok', 'IA y bot'); vistaIA(); }
    catch (e) { toast(e.message, 'bad', 'IA y bot'); }
  };
  $('#ia-guardar').onclick = () => guardarConfig({
    apiKey: $('#ia-key').value.trim() || undefined, modelo: $('#ia-mod').value,
    temperatura: $('#ia-temp').value, maxRespuestas: $('#ia-max').value }, 'Conexión guardada');
  if ($('#ia-borrar')) $('#ia-borrar').onclick = () => guardarConfig({ borrarToken: true }, 'Token eliminado');
  $('#ia-guardar-bot').onclick = () => guardarConfig({ activo: $('#ia-act').checked, instrucciones: $('#ia-ins').value }, 'Bot guardado');
  $('#ia-act').onchange = e => guardarConfig({ activo: e.target.checked }, e.target.checked ? 'Bot activado' : 'Bot desactivado');

  const guardarLinea = async id => {
    await put(`/ia/canales/${id}`, { bot_activo: $(`[data-lact="${id}"]`).checked,
      bot_instrucciones: $(`[data-lins="${id}"]`).value });
    toast('Línea guardada', 'ok');
  };
  $$('[data-lguardar]').forEach(b => b.onclick = () => guardarLinea(b.dataset.lguardar).catch(e => toast(e.message, 'bad')));
  $$('[data-lact]').forEach(i => i.onchange = () => guardarLinea(i.dataset.lact).catch(e => toast(e.message, 'bad')));
  $$('[data-lprobar]').forEach(b => b.onclick = () => {
    $('#pr-linea').value = b.dataset.lprobar;
    probar($(`[data-lins="${b.dataset.lprobar}"]`).value);
    $('#pr-res').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('#pr-ok').onclick = () => probar();
}

async function probar(instruccionesSinGuardar) {
  const out = $('#pr-res');
  out.innerHTML = '<span class="spin"></span> Consultando a OpenAI…';
  try {
    const r = await post('/ia/probar', { canalId: $('#pr-linea').value || null, mensaje: $('#pr-msg').value,
      apiKey: $('#ia-key').value.trim() || undefined, modelo: $('#ia-mod').value,
      ...(instruccionesSinGuardar !== undefined ? { instrucciones: instruccionesSinGuardar } : {}) });
    out.innerHTML = `<div class="chat" style="max-height:none">
      <div class="msg in">${esc($('#pr-msg').value)}</div>
      <div class="msg out">${esc(r.respuesta)}<small>🤖 Bot · ${(r.ms / 1000).toFixed(1)} s</small></div></div>`;
  } catch (e) {
    out.innerHTML = `<div style="color:var(--bad);font-size:var(--fs-sm)">✖ ${esc(e.message)}</div>`;
  }
}
