/* ============ Contactos y ficha 360° ============ */
import {
  $, $$, esc, S, get, post, patch, gs, fd, fdate, toast, modal, cerrar,
  fx, esAdmin, etapa, bajar, vacio, skeleton
} from './core.js';
import { fichaNeg } from './ficha.js';
import { chequearDuplicado } from './negociaciones.js';
import { activarVisor } from './adjuntos.js';

let QC = '';

export async function vistaContactos() {
  $('#view').innerHTML = `<div class="section">${skeleton(5)}</div>`;
  const [cs, pend] = await Promise.all([
    get(`/contactos?q=${encodeURIComponent(QC)}`),
    get('/contactos/solicitudes/pendientes').catch(() => [])
  ]);

  $('#view').innerHTML = `<div class="section fx-vista">
   ${pend.length ? `<div class="card-box fx-pop" style="border-color:var(--warn)">
     <h3>Solicitudes de contacto pendientes (${pend.length})</h3>
     ${pend.map(s => `<div class="row" style="align-items:center;margin-bottom:8px">
       <div><b>${esc(s.solicitante)}</b> solicita el contacto <b>${esc(s.nombre)}</b> · ${esc(s.tel || '')}</div>
       <div style="flex:none"><button class="btn ok sm" data-sol="${s.id}" data-ok="1">Aceptar</button>
       <button class="btn danger sm" data-sol="${s.id}" data-ok="0">Rechazar</button></div></div>`).join('')}</div>` : ''}
   <div class="row" style="margin-bottom:12px;align-items:center">
     <input id="c-buscar" placeholder="Buscar por nombre, teléfono, email o dirección…" value="${esc(QC)}"
       style="padding:10px 13px;background:var(--surface2);border:1px solid var(--line);border-radius:10px">
     <div style="flex:none;display:flex;gap:8px;flex-wrap:wrap">
       <button class="btn" id="c-nuevo">+ Nuevo contacto</button>
       ${(esAdmin() || S.usuario.rol === 'gerente') && fx('exportar') ? `<button class="btn ghost" id="c-export">⭳ Exportar</button>` : ''}
       ${(esAdmin() || S.usuario.rol === 'gerente') && fx('importar') ? `<button class="btn ghost" id="c-import">⭱ Importar</button>
       <input id="c-file" type="file" accept=".csv" class="hidden">` : ''}</div></div>
   <div class="card-box"><table><thead><tr><th>Cliente</th><th class="hide-m">Teléfono</th>
     <th class="hide-m">Dirección</th><th>Responsable</th><th>Estado</th><th class="hide-m">Alta</th><th></th></tr></thead>
   <tbody>${cs.map(c => `<tr><td><b>${esc(c.nombre)}</b> ${c.frecuente && fx('marcadorFrecuente') ? '<span class="tag t-frec">★</span>' : ''}</td>
     <td class="hide-m">${esc(c.tel || '—')}</td>
     <td class="hide-m">${c.direccion ? `<span title="${esc(c.direccion)}">📍 ${esc(c.direccion.slice(0, 32))}${c.direccion.length > 32 ? '…' : ''}</span>` : '—'}</td>
     <td>${esc(c.responsable || 'Libre')}</td>
     <td>${c.etapa_abierta ? `<span class="tag t-re">Abierta · ${esc(etapa(c.etapa_abierta).nombre)}</span>`
       : `<span style="color:var(--muted)">${c.n_negociaciones} cerradas</span>`}</td>
     <td class="hide-m">${fd(c.creado)}</td>
     <td><div style="display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap"><button class="btn sm" data-conversacion="${c.id}">Conversación</button><button class="btn ghost sm" data-360="${c.id}">Ficha 360°</button></div></td></tr>`).join('')
     || `<tr><td colspan="7">${vacio('◎', 'Sin contactos', 'Los que ingresen por los canales aparecerán acá')}</td></tr>`}
   </tbody></table></div></div>`;

  let t;
  $('#c-buscar').oninput = e => { clearTimeout(t); QC = e.target.value; t = setTimeout(vistaContactos, 320); };
  $('#c-nuevo').onclick = modalNuevo;
  $$('[data-360]').forEach(b => b.onclick = () => ficha360(b.dataset['360']));
  $$('[data-conversacion]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await abrirConversacion(b.dataset.conversacion); }
    catch (e) { toast(e.message, 'bad'); }
    finally { b.disabled = false; }
  });
  $$('[data-sol]').forEach(b => b.onclick = async () => {
    await post(`/contactos/solicitudes/${b.dataset.sol}/resolver`, { aceptar: b.dataset.ok === '1' });
    toast(b.dataset.ok === '1' ? 'Contacto transferido' : 'Solicitud rechazada', b.dataset.ok === '1' ? 'ok' : 'warn');
    vistaContactos();
  });
  if ($('#c-export')) $('#c-export').onclick = async () => {
    const h = { Authorization: `Bearer ${S.token}` };
    if (S.usuario.esAdminGlobal) h['X-Empresa'] = S.empresa.id;
    const r = await fetch('/api/contactos/export/csv', { headers: h });
    bajar(`contactos_${S.empresa.codigo}.csv`, await r.text());
    toast('Contactos exportados', 'ok');
  };
  if ($('#c-import')) {
    $('#c-import').onclick = () => $('#c-file').click();
    $('#c-file').onchange = importar;
  }
}

async function ubicarConversacion(n) {
  cerrar();
  const { ubicarNegociacion } = await import('./negociaciones.js');
  await ubicarNegociacion(n.id, n.etapa);
}

function avisarActiva(n) {
  modal(`<div class="modal-h"><h3>Ya hay una negociación activa</h3><button class="x" data-cerrar>✕</button></div>
    <div class="modal-b"><p>Responsable: <b>${esc(n.responsable)}</b></p>
      <p>Ubicación: <b>${esc(etapa(n.etapa).nombre)}</b> · ${esc(n.sucursal || 'Sin sucursal')} · ${esc(n.linea || 'Sin línea')}</p>
      <p>${n.propia ? 'La negociación está a tu cargo. Podés ir al chat y a su ubicación en el tablero.' : 'No se creó otra negociación. La conversación continúa con su responsable.'}</p></div>
    <div class="modal-f"><button class="btn ghost" data-cerrar>Cerrar</button>
      ${n.propia ? '<button class="btn" id="c-ir-chat">Ir al chat y ubicación</button>' : ''}</div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  if ($('#c-ir-chat')) $('#c-ir-chat').onclick = async () => {
    try { await ubicarConversacion(n); } catch (e) { toast(e.message, 'bad'); }
  };
}

async function abrirConversacion(id) {
  const c = await get(`/contactos/${id}/conversacion`);
  if (c.activa) return avisarActiva(c);
  modal(`<div class="modal-h"><h3>Conversación · ${esc(c.nombre)}</h3><button class="x" data-cerrar>✕</button></div>
    <form id="c-chat-form"><div class="modal-b"><p>${esc(c.tel || 'Sin teléfono')}</p>
      <p>Al enviar el primer mensaje se creará una negociación en Contactado, a tu cargo.</p>
      <div class="field"><label for="c-chat-canal">Línea WhatsApp</label><select required id="c-chat-canal">
        ${c.canales.length === 1 ? '' : '<option value="">Seleccionar…</option>'}
        ${c.canales.map(x => `<option value="${x.id}">${esc(x.nombre)} · ${esc(x.sucursal || 'General')} · ${esc(x.linea || '')}</option>`).join('')}</select></div>
      ${c.canales.length ? '' : '<p>No hay líneas WhatsApp habilitadas para tu sucursal. Consultá al administrador.</p>'}
      <div class="field"><label for="c-chat-texto">Mensaje inicial</label><textarea required maxlength="10000" rows="4" id="c-chat-texto"></textarea></div>
      <div class="err" role="alert" id="c-chat-error"></div></div>
      <div class="modal-f"><button type="button" class="btn ghost" data-cerrar>Cancelar</button>
        <button type="submit" class="btn" id="c-chat-send" ${c.canales.length ? '' : 'disabled'}>Enviar e iniciar negociación</button></div></form>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  let enviando = false;
  $('#c-chat-form').onsubmit = async e => {
    e.preventDefault(); if (enviando) return;
    const texto = $('#c-chat-texto').value.trim(), canalId = $('#c-chat-canal').value;
    if (!texto || !canalId) return;
    enviando = true; $('#c-chat-send').disabled = true;
    try {
      const n = await post(`/contactos/${id}/conversacion`, { texto, canalId });
      if (n.activa) return avisarActiva(n);
      toast('Negociación creada · mensaje en cola de envío', 'ok');
      await ubicarConversacion(n);
    } catch (ex) {
      if (ex.data?.activa) return avisarActiva(ex.data);
      if ($('#c-chat-error')) $('#c-chat-error').textContent = ex.message;
    } finally { enviando = false; if ($('#c-chat-send')) $('#c-chat-send').disabled = false; }
  };
}

function modalNuevo() {
  const sucs = S.sucursales.map(s => s.nombre);
  modal(`<div class="modal-h"><h3>Nuevo contacto</h3><button class="x" data-cerrar>✕</button></div>
  <div class="modal-b"><div class="row">
    <div class="field"><label>Nombre *</label><input id="n-nom"></div>
    <div class="field"><label>Teléfono *</label><input id="n-tel" inputmode="tel"></div></div>
   <div id="n-dup"></div>
   <div class="row"><div class="field"><label>Email</label><input id="n-mail" inputmode="email"></div>
    <div class="field"><label>Documento</label><input id="n-doc"></div></div>
   <div class="row"><div class="field"><label>Ciudad</label><input id="n-ciu"></div>
    <div class="field"><label>Sucursal</label><select id="n-suc">
      ${sucs.map(s => `<option ${S.usuario.sucursal === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
    <div class="field"><label>Línea</label><select id="n-lin">
      ${(S.empresa.lineas || []).map(s => `<option ${S.usuario.linea === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div></div>
   <div class="field"><label>Dirección</label><input id="n-dir" placeholder="Calle, número, referencia"></div>
   <div class="field"><label>Notas</label><textarea id="n-not" rows="2"></textarea></div>
   <label style="font-size:var(--fs-sm);color:var(--muted)"><input type="checkbox" id="n-neg" checked> Iniciar negociación</label>
   <div class="err" id="n-err"></div></div>
  <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
   <button class="btn" id="n-ok">Guardar</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  let t;
  $('#n-tel').oninput = e => { clearTimeout(t); t = setTimeout(() => chequearDuplicado(e.target.value, '#n-dup'), 350); };
  $('#n-ok').onclick = async () => {
    const b = {
      nombre: $('#n-nom').value.trim(), tel: $('#n-tel').value.trim(), email: $('#n-mail').value.trim(),
      doc: $('#n-doc').value.trim(), ciudad: $('#n-ciu').value.trim(), direccion: $('#n-dir').value.trim(),
      sucursal: $('#n-suc').value, linea: $('#n-lin').value, notas: $('#n-not').value.trim(),
      iniciarNegociacion: $('#n-neg').checked
    };
    if (!b.nombre || !b.tel) return $('#n-err').textContent = 'Nombre y teléfono son obligatorios.';
    try {
      await post('/contactos', b); cerrar(); toast('Contacto creado', 'ok'); vistaContactos();
    } catch (e) {
      if (e.data?.error === 'responsable') {
        $('#n-err').innerHTML = `${esc(e.data.mensaje)}<br>
          <button class="btn sm" style="margin-top:8px" id="n-solic">Enviar solicitud de contacto</button>`;
        $('#n-solic').onclick = async () => {
          await post(`/contactos/${e.data.contactoId}/solicitar`, {});
          cerrar(); toast(`Solicitud enviada a ${e.data.responsable}`, 'ok');
        };
      } else $('#n-err').textContent = e.data?.mensaje || e.message;
    }
  };
}

export async function ficha360(id) {
  modal(`<div class="modal-b" style="text-align:center;padding:48px"><span class="spin lg"></span></div>`, true);
  const c = await get(`/contactos/${id}`);
  const r = c.resumen;
  const porOrigen = {};
  c.negociaciones.forEach(n => porOrigen[n.origen] = (porOrigen[n.origen] || 0) + 1);
  const activas = (S.empresa.etapas || []).filter(e => e.activa).map(e => e.id);
  const abierta = c.negociaciones.find(n => activas.includes(n.etapa));

  modal(`<div class="modal-h"><h3>Ficha 360° · ${esc(c.nombre)}
    ${c.frecuente ? '<span class="tag t-frec">★ Frecuente</span>' : ''}</h3><button class="x" data-cerrar>✕</button></div>
  <div class="modal-b">
   ${abierta ? `<div class="card-box fx-pop" style="border-color:#2b5a7a">
     <b style="font-size:var(--fs-sm)">🔵 Negociación abierta actualmente</b>
     <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:5px">
       ${esc(etapa(abierta.etapa).nombre)} · ${esc(abierta.agente_nombre || 'sin asignar')} · desde ${fd(abierta.creado)}</div>
     <button class="btn ghost sm" style="margin-top:8px" data-abrir="${abierta.id}">Abrir</button></div>` : ''}
   <div class="grid g4 stagger" style="margin-bottom:14px">
     <div class="kpi"><span>Negociaciones</span><b>${r.total}</b></div>
     <div class="kpi"><span>Ventas ganadas</span><b style="color:var(--ok)">${r.ganadas}</b></div>
     <div class="kpi"><span>Monto total</span><b class="chico">${gs(r.monto)}</b></div>
     <div class="kpi"><span>Conversión</span><b>${r.conversion}%</b></div></div>
   <div class="grid g2">
     <div class="card-box"><h3>Datos personales</h3>
      <div class="row"><div class="field"><label>Nombre</label><input id="f-nom" value="${esc(c.nombre)}"></div>
       <div class="field"><label>Teléfono</label><input id="f-tel" value="${esc(c.tel || '')}"></div></div>
      <div class="row"><div class="field"><label>Email</label><input id="f-mail" value="${esc(c.email || '')}"></div>
       <div class="field"><label>Documento</label><input id="f-doc" value="${esc(c.doc || '')}"></div></div>
      <div class="row"><div class="field"><label>Ciudad</label><input id="f-ciu" value="${esc(c.ciudad || '')}"></div>
       <div class="field"><label>Responsable</label><input value="${esc(c.responsable || 'Libre')}" disabled></div></div>
      <div class="field"><label>Dirección ${c.lat != null ? '· <span style="color:var(--ok)">ubicada en el mapa</span>' : ''}</label>
        <input id="f-dir" value="${esc(c.direccion || '')}"></div>
      <div class="field"><label>Primer alta</label><input value="${fdate(c.creado)}" disabled></div>
      <div class="field"><label>Notas</label><textarea id="f-not" rows="2">${esc(c.notas || '')}</textarea></div>
      <button class="btn sm" id="f-guardar">Guardar cambios</button>
      ${c.lat != null ? `<a class="btn ghost sm" href="https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}"
        target="_blank" rel="noopener">🗺 Ver en el mapa</a>` : ''}</div>
     <div class="card-box"><h3>Canales de ingreso</h3>
      ${Object.entries(porOrigen).map(([o, v]) => `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:var(--fs-sm)"><span>${o}</span><b>${v}</b></div>
        <div class="bar"><i style="width:${Math.round(v / r.total * 100)}%"></i></div></div>`).join('')
        || '<div class="empty">Sin datos</div>'}
      <h3 style="margin-top:14px">Identidades vinculadas</h3>
      <div class="mono" style="color:var(--muted);line-height:1.8">
        ${Object.entries(c.externos || {}).map(([k, v]) => `${k}: ${esc(v)}`).join('<br>') || '—'}</div>
      ${(c.ubicaciones || []).length ? `<h3 style="margin-top:14px">📍 Direcciones recibidas</h3>
        ${c.ubicaciones.slice(0, 5).map(u => `<div style="padding:6px 0;border-bottom:1px solid var(--line);font-size:var(--fs-xs)">
          <b>${esc(u.direccion || u.texto)}</b><br>
          <span style="color:var(--muted)">${u.fuente} · ${fd(u.ts)}</span>
          ${u.lat != null ? ` · <a href="${esc(u.mapa)}" target="_blank" rel="noopener">ver mapa</a>` : ''}</div>`).join('')}` : ''}</div></div>
   <div class="card-box"><h3>Histórico de negociaciones</h3>
     <table><thead><tr><th>Creada</th><th>Título</th><th>Origen</th><th>Etapa</th><th>Agente</th><th>Monto</th></tr></thead>
     <tbody>${c.negociaciones.map(n => `<tr style="cursor:pointer" data-neg="${n.id}">
       <td>${fdate(n.creado)}</td><td>${esc(n.titulo || '—')}</td><td>${n.origen}</td>
       <td><span class="dot" style="background:${etapa(n.etapa).color}"></span> ${esc(etapa(n.etapa).nombre)}</td>
       <td>${esc(n.agente_nombre || '—')}</td>
       <td>${n.etapa === 'ganado' ? `<b style="color:var(--ok)">${gs(n.monto_cierre)}</b>` : (n.valor ? gs(n.valor) : '—')}</td></tr>`).join('')
       || '<tr><td colspan="6" class="empty">Sin negociaciones</td></tr>'}</tbody></table></div></div>`, true);

  activarVisor($('.modal'));
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $$('[data-neg]').forEach(b => b.onclick = () => { cerrar(); fichaNeg(b.dataset.neg); });
  const ab = $('[data-abrir]');
  if (ab) ab.onclick = () => { cerrar(); fichaNeg(abierta.id); };
  $('#f-guardar').onclick = async () => {
    await patch(`/contactos/${c.id}`, {
      nombre: $('#f-nom').value.trim(), tel: $('#f-tel').value.trim(), email: $('#f-mail').value.trim(),
      doc: $('#f-doc').value.trim(), ciudad: $('#f-ciu').value.trim(),
      direccion: $('#f-dir').value.trim(), notas: $('#f-not').value
    });
    toast('Ficha actualizada', 'ok'); cerrar(); vistaContactos();
  };
}

function importar(e) {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    const lineas = String(rd.result).replace(/\ufeff/g, '').split(/\r?\n/).filter(Boolean);
    if (!lineas.length) return toast('El archivo está vacío', 'warn');
    const head = lineas.shift().split(';').map(h => h.trim().toLowerCase());
    const filas = lineas.map(l => {
      const v = l.split(';'), o = {};
      head.forEach((h, i) => o[h] = (v[i] || '').trim());
      return o;
    });
    const r = await post('/contactos/import', { filas });
    toast(`${r.nuevos} nuevos · ${r.actualizados} actualizados`, 'ok', 'Importación');
    vistaContactos();
  };
  rd.readAsText(f, 'utf-8');
  e.target.value = '';
}
