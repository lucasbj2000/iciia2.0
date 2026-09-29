/* ============ Carga manual simplificada ============ */
import { $, $$, esc, S, get, post, toast, modal, cerrar } from './core.js';

const telNorm = t => { let d = String(t || '').replace(/\D/g, '').replace(/^0+/, ''); if (d.startsWith('595')) d = d.slice(3); return d.replace(/^0+/, ''); };
let elegido = null, datos = { nombre: '', tel: '' }, filas = [], sugerencias = [], tBusca;

export function modalCargaManual(pre = {}) {
  elegido = null; sugerencias = [];
  datos = { nombre: pre.nombre || '', tel: pre.tel || '' };
  filas = [{ txt: pre.mensaje || '', fecha: '' }];
  modal(`<div class="modal-h"><h3>✎ Cargar mensajes de un cliente</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b">
     <p class="sub" style="margin-top:0">Para mensajes que no entraron al sistema. Si el cliente ya existe,
       se usa su contacto y los mensajes se agregan al final de su conversación.</p>
     <div id="mc-cliente"></div>
     <div class="field" style="margin-top:6px"><label>Mensajes del cliente · del más antiguo al más reciente</label>
       <div id="mc-msgs"></div>
       <button class="btn ghost sm" id="mc-mas" type="button">＋ Agregar otro mensaje</button></div>
     <div class="err" id="mc-err"></div></div>
   <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
     <button class="btn" id="mc-ok">Cargar</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#mc-mas').onclick = () => { leerFilas(); filas.push({ txt: '', fecha: '' }); pintarMensajes(true); };
  $('#mc-ok').onclick = guardar;
  pintarCliente(); pintarMensajes();
  if (datos.tel) buscar(datos.tel, true);
}

/* ---------- Cliente ---------- */
function pintarCliente() {
  const box = $('#mc-cliente');
  if (elegido) {
    const e = elegido;
    box.innerHTML = `<div class="card-box fx-pop" style="margin:0 0 10px;border-color:var(--ok)">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span style="font-size:22px">✓</span>
        <div style="flex:1;min-width:0"><b style="display:block">${esc(e.nombre)}</b>
          <small style="color:var(--muted)">${esc(e.tel || 'sin teléfono')}${e.responsable ? ' · ' + esc(e.responsable) : ''}</small></div>
        <button class="btn ghost sm" id="mc-otro" type="button">Usar otro cliente</button></div>
      <div style="font-size:var(--fs-sm);margin-top:9px;color:var(--muted)">${e.neg_id
        ? `Tiene una negociación abierta en <b style="color:var(--txt)">${esc(e.etapaNombre)}</b> con ${e.neg_mensajes} mensaje(s). Los nuevos se agregan a continuación.`
        : 'No tiene negociación abierta: se crea una nueva en «Cliente espera respuesta».'}</div></div>`;
    $('#mc-otro').onclick = () => { elegido = null; datos = { nombre: '', tel: '' }; sugerencias = []; pintarCliente(); };
    return;
  }
  box.innerHTML = `<div class="row">
      <div class="field"><label>Teléfono</label><input id="mc-tel" inputmode="tel" value="${esc(datos.tel)}" placeholder="0981 123 456"></div>
      <div class="field"><label>Nombre</label><input id="mc-nom" value="${esc(datos.nombre)}" placeholder="Nombre del cliente"></div></div>
    <div id="mc-sug"></div>`;
  const tel = $('#mc-tel'), nom = $('#mc-nom');
  tel.oninput = () => { datos.tel = tel.value; clearTimeout(tBusca); tBusca = setTimeout(() => buscar(tel.value, true), 350); };
  nom.oninput = () => { datos.nombre = nom.value;
    if (telNorm(datos.tel).length >= 6) return;
    clearTimeout(tBusca); tBusca = setTimeout(() => buscar(nom.value, false), 350); };
  pintarSugerencias();
}

async function buscar(texto, porTelefono) {
  const t = String(texto || '').trim();
  if ((porTelefono && telNorm(t).length < 6) || (!porTelefono && t.length < 3)) { sugerencias = []; return pintarSugerencias(); }
  try {
    const rs = await get(`/manual/buscar?q=${encodeURIComponent(t)}`);
    const exacto = porTelefono && rs.find(x => x.exacto);
    if (exacto && !elegido) { elegido = exacto; toast(`${exacto.nombre} ya está cargado: se usa su contacto`, 'ok', 'Cliente encontrado'); return pintarCliente(); }
    sugerencias = rs; pintarSugerencias();
  } catch (e) { /* la búsqueda es solo una ayuda */ }
}

function pintarSugerencias() {
  const box = $('#mc-sug'); if (!box) return;
  if (!sugerencias.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div style="font-size:var(--fs-xs);color:var(--muted);margin:-4px 0 6px">¿Es alguno de estos clientes?</div>
    ${sugerencias.map((s, i) => `<button type="button" class="qchip" data-sug="${i}" style="margin:0 6px 6px 0">
      ${esc(s.nombre)} · ${esc(s.tel || 'sin tel.')}${s.neg_id ? ' · abierta' : ''}</button>`).join('')}`;
  $$('[data-sug]').forEach(b => b.onclick = () => { elegido = sugerencias[Number(b.dataset.sug)]; pintarCliente(); });
}

/* ---------- Mensajes ---------- */
function leerFilas() {
  $$('[data-mtxt]').forEach(el => { filas[el.dataset.mtxt].txt = el.value; });
  $$('[data-mfec]').forEach(el => { filas[el.dataset.mfec].fecha = el.value; });
}
function pintarMensajes(enfocarUltimo) {
  $('#mc-msgs').innerHTML = filas.map((f, i) => `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px">
      <span class="badge-rol" style="margin-top:10px">${i + 1}</span>
      <div style="flex:1;min-width:0">
        <textarea data-mtxt="${i}" rows="2" placeholder="Mensaje del cliente…"
          style="width:100%;padding:10px 12px;background:var(--surface2);border:1px solid var(--line);border-radius:10px">${esc(f.txt)}</textarea>
        <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
          <small style="color:var(--muted)">Fecha (opcional):</small>
          <input data-mfec="${i}" type="datetime-local" value="${esc(f.fecha)}" style="padding:5px 8px;font-size:var(--fs-xs)"></div></div>
      ${filas.length > 1 ? `<button class="x" type="button" data-mdel="${i}" title="Quitar">✕</button>` : ''}</div>`).join('');
  $$('[data-mdel]').forEach(b => b.onclick = () => { leerFilas(); filas.splice(Number(b.dataset.mdel), 1); pintarMensajes(); });
  if (enfocarUltimo) $(`[data-mtxt="${filas.length - 1}"]`)?.focus();
}

/* ---------- Guardar ---------- */
async function guardar() {
  leerFilas();
  const err = $('#mc-err'); err.textContent = '';
  const mensajes = filas.filter(f => f.txt.trim())
    .map(f => ({ txt: f.txt.trim(), fecha: f.fecha ? new Date(f.fecha).toISOString() : null }));
  if (!elegido && !telNorm(datos.tel)) return err.textContent = 'Ingresá el teléfono del cliente.';
  if (!elegido && !datos.nombre.trim()) return err.textContent = 'Ingresá el nombre del cliente.';
  if (!mensajes.length) return err.textContent = 'Escribí al menos un mensaje.';
  const btn = $('#mc-ok'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Cargando…';
  try {
    const r = await post('/manual/cargar', { contactoId: elegido?.id || null, nombre: datos.nombre, tel: datos.tel, mensajes });
    cerrar();
    toast(r.reusada ? `Se agregaron ${r.mensajes} mensaje(s) a la conversación de ${r.cliente}`
      : `Negociación creada para ${r.cliente}${r.contactoNuevo ? ' (cliente nuevo)' : ''}`, 'ok', 'Carga manual');
    if (S.vista === 'neg') import('./negociaciones.js').then(m => m.patchTarjeta(r.negociacionId, r.reusada ? { destacar: true } : { nueva: true }));
  } catch (e) {
    err.textContent = e.message; btn.disabled = false; btn.textContent = 'Cargar';
  }
}
