/* ============ Contactos y ficha 360° ============ */
import {
  $, $$, esc, S, api, get, post, patch, del, gs, fd, fdate, toast, modal, cerrar,
  fx, esAdmin, etapa, bajar, vacio, skeleton
} from './core.js';
import { fichaNeg } from './ficha.js';
import { chequearDuplicado } from './negociaciones.js';
import { activarVisor } from './adjuntos.js';
import { conectarEmojis } from './emojis.js';

let QC = '';
let ultimaCargaFicha=0;

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
       <button class="btn ghost" id="c-buscar-registrado" title="Buscar cliente de cualquier sucursal para iniciar conversación">Buscar registrado en IMPAR</button>
       ${(esAdmin() || S.usuario.rol === 'gerente') && fx('exportar') ? `<button class="btn ghost" id="c-export">⭳ Exportar</button>` : ''}
       ${(esAdmin() || S.usuario.rol === 'gerente') && fx('importar') ? `<button class="btn ghost" id="c-import">⭱ Importar</button>
       <input id="c-file" type="file" accept=".csv" class="hidden">` : ''}</div></div>
   <div class="card-box"><table><thead><tr><th>Cliente</th><th class="hide-m">Teléfono</th>
     <th class="hide-m">Dirección</th><th>Responsable</th><th>Estado</th><th class="hide-m">Alta</th><th></th></tr></thead>
   <tbody>${cs.map(c => `<tr><td><b>${esc(c.nombre)}</b> ${c.frecuente && fx('marcadorFrecuente') ? '<span class="tag t-frec">★</span>' : ''}</td>
     <td class="hide-m">${esc(c.tel || '—')}</td>
     <td class="hide-m">${c.direccion ? `<span title="${esc(c.direccion)}">📍 ${esc(c.direccion.slice(0, 32))}${c.direccion.length > 32 ? '…' : ''}</span>` : '—'}</td>
     <td><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
       <span>${esc(c.responsable || 'Libre')}</span>
       ${['admin','gerente','jefe'].includes(S.usuario.rol) ?
         `<button class="btn ghost sm" data-cambiar-responsable="${c.id}" title="Reasignar contacto">Cambiar</button>` : ''}
       </div></td>
     <td>${c.etapa_abierta ? `<span class="tag t-re">Abierta · ${esc(etapa(c.etapa_abierta).nombre)}</span>`
       : `<span style="color:var(--muted)">${c.n_negociaciones} cerradas</span>`}</td>
     <td class="hide-m">${fd(c.creado)}</td>
     <td><div style="display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap"><button class="btn sm" data-conversacion="${c.id}">Conversación</button><button class="btn ghost sm" data-360="${c.id}">Ficha 360°</button></div></td></tr>`).join('')
     || `<tr><td colspan="7">${vacio('◎', 'Sin contactos', 'Los que ingresen por los canales aparecerán acá')}</td></tr>`}
   </tbody></table></div></div>`;

  let t;
  $('#c-buscar').oninput = e => { clearTimeout(t); QC = e.target.value; t = setTimeout(vistaContactos, 320); };
  $('#c-nuevo').onclick = modalNuevo;
  $('#c-buscar-registrado').onclick=buscarContactoImpar;
  $$('[data-360]').forEach(b => b.onclick = () => ficha360(b.dataset['360']));
  $$('[data-cambiar-responsable]').forEach(b=>b.onclick=()=>cambiarResponsableContacto(
    b.dataset.cambiarResponsable,cs.find(c=>c.id===b.dataset.cambiarResponsable)));
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
    if (esAdmin()) {
      $('#c-import').textContent = '🛡 Importar sin duplicados';
      $('#c-import').onclick = () => import('./admin.js').then(m => m.irABitrix());
    } else {
      $('#c-import').onclick = () => $('#c-file').click();
      $('#c-file').onchange = importar;
    }
  }
}

/** Transferir el contacto y sus negociaciones abiertas sin alterar historial cerrado. */
async function cambiarResponsableContacto(id,contacto) {
  let disponibles;
  try { disponibles=await get('/contactos/responsables/disponibles'); }
  catch(e){return toast(e.message,'bad','Responsable');}
  if(!Array.isArray(disponibles)||!disponibles.length)
    return toast('No hay responsables disponibles para asignar.','warn');
  const actual=contacto?.responsable_id || '';
  modal(`<div class="modal-h"><h3>Cambiar responsable</h3>
    <button class="x" data-cerrar>✕</button></div>
    <div class="modal-b">
      <p>Cliente: <b>${esc(contacto?.nombre||'Contacto')}</b></p>
      <p class="sub">Responsable actual: <b>${esc(contacto?.responsable||'Sin asignar')}</b></p>
      <div class="field"><label for="c-nuevo-responsable">Nuevo responsable</label>
       <select id="c-nuevo-responsable"><option value="">Seleccioná un empleado…</option>
         ${disponibles.map(u=>`<option value="${esc(u.id)}" ${actual===u.id?'selected':''}>
           ${esc(u.nombre)} · ${esc(u.sucursal||'Sin sucursal')} (${esc(u.rol)})</option>`).join('')}
       </select></div>
      <p class="sub">Se transferirán las negociaciones abiertas de este cliente.
      Se conservarán los mensajes, adjuntos y negociaciones cerradas.</p>
      <div class="err" id="c-error-responsable"></div>
    </div>
    <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
      <button class="btn" id="c-confirmar-responsable" disabled>Guardar responsable</button></div>`);
  $$('[data-cerrar]').forEach(x=>x.onclick=cerrar);
  const selector=$('#c-nuevo-responsable'),boton=$('#c-confirmar-responsable');
  const validar=()=>boton.disabled=!selector.value||selector.value===actual;
  selector.onchange=validar;validar();
  boton.onclick=async()=>{
    const responsableId=selector.value;
    if(!responsableId||boton.disabled)return;
    boton.disabled=true;boton.textContent='Guardando…';
    try{
      const r=await patch(`/contactos/${id}/responsable`,{responsableId});
      cerrar();toast(`Contacto asignado a ${r.destino}. ${r.movidas} negociaciones abiertas transferidas.`,'ok');
      await vistaContactos();
    }catch(e){
      const error=$('#c-error-responsable');if(error)error.textContent=e.message;
      boton.disabled=false;boton.textContent='Guardar responsable';
    }
  };
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

/** Busca en toda la empresa sin acceder a fichas e historiales ajenos. */
function buscarContactoImpar(){
  modal(`<div class="modal-h"><h3>Buscar cliente registrado · IMPAR</h3>
    <button class="x" data-cerrar>✕</button></div>
    <div class="modal-b">
      <p class="sub">Encontrá un cliente de cualquier sucursal y abrí una conversación con la línea única «principal» de Central. Si ya tiene una negociación abierta, se conservará su responsable.</p>
      <div class="row" style="gap:8px;align-items:end">
        <div class="field" style="flex:1;min-width:0">
          <label for="busqueda-impar-global">Nombre, teléfono o correo</label>
          <input id="busqueda-impar-global" placeholder="Escribí al menos 3 caracteres…" autocomplete="off" maxlength="90"></div>
        <button class="btn sm" id="busqueda-impar-ejecutar">Buscar</button>
      </div>
      <div id="busqueda-impar-resultados" role="status" style="margin-top:12px">
        <p class="sub">Los datos del cliente no se modificarán al buscar.</p>
      </div>
    </div>
    <div class="modal-f"><button class="btn ghost" data-cerrar>Cerrar</button></div>`);
  $$('[data-cerrar]').forEach(b=>b.onclick=cerrar);
  const input=$('#busqueda-impar-global');
  const enviar=$('#busqueda-impar-ejecutar');
  let secuencia=0;
  const ejecutar=async()=>{
    const termino=input.value.trim();
    if(termino.length<3){
      $('#busqueda-impar-resultados').textContent='Escribí al menos 3 caracteres para buscar.';
      return;
    }
    const solicitud=++secuencia;
    enviar.disabled=true;enviar.textContent='Buscando…';
    try{
      const resultados=await get('/contactos/buscar/registrado?q='+encodeURIComponent(termino));
      if(solicitud!==secuencia||!$('#busqueda-impar-resultados'))return;
      const contenedor=$('#busqueda-impar-resultados');
      contenedor.innerHTML=resultados.length
        ? resultados.map(c=>`<div class="card-box" style="margin:6px 0;padding:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="min-width:0"><b>${esc(c.nombre)}</b>
            <small style="display:block;color:var(--muted)">${esc(c.tel||'Sin número')} · ${esc(c.sucursal||'IMPAR')} · Responsable: ${esc(c.responsable||'Sin asignar')}</small></div>
          <button class="btn sm" type="button" data-abrir-impar="${esc(c.id)}">Conversación</button>
        </div>`).join('')
        : '<p class="sub">No encontramos clientes con esos datos. Podés crear uno desde «Nuevo contacto».</p>';
      $$('[data-abrir-impar]').forEach(b=>b.onclick=async()=>{
        b.disabled=true;
        try{await abrirConversacion(b.dataset.abrirImpar);}
        catch(e){toast(e.message,'bad','Conversación');b.disabled=false;}
      });
    }catch(e){
      if(solicitud===secuencia && $('#busqueda-impar-resultados'))
        $('#busqueda-impar-resultados').textContent=e.message;
    }finally{
      if(solicitud===secuencia && enviar.isConnected){
        enviar.disabled=false;enviar.textContent='Buscar';
      }
    }
  };
  enviar.onclick=ejecutar;
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();ejecutar();}};
}

async function abrirConversacion(id) {
  const c = await get(`/contactos/${id}/conversacion`);
  if (c.activa) return avisarActiva(c);
  modal(`<div class="modal-h"><h3>Conversación · ${esc(c.nombre)}</h3><button class="x" data-cerrar>✕</button></div>
    <form id="c-chat-form"><div class="modal-b"><p>${esc(c.nombre)} · Cliente IMPAR</p>
      <div class="field"><label for="c-chat-numero">Número destinatario del cliente</label>
      <select id="c-chat-numero">${(c.telefonos||[]).map(t=>
        `<option value="${esc(t.numero)}">${esc(t.numero)} · ${esc(t.etiqueta)}</option>`).join('') ||
        `<option value="${esc(c.tel||'')}">${esc(c.tel||'Sin número')}</option>`}</select>
      <small>Los números están vinculados a la misma ficha; elegí a cuál escribir.</small></div>
      <p>Se utilizará únicamente la línea WhatsApp «principal» de Central. Al enviar el primer mensaje se creará una negociación en Contactado, a tu cargo.</p>
      <div class="field"><label>Línea WhatsApp de IMPAR</label>
        ${c.canales.length ? `<div class="pill" style="display:flex;align-items:center;gap:8px">
          📱 <b>Central · principal</b><span style="color:var(--ok)">Compartida para todos los empleados</span>
          </div><input type="hidden" id="c-chat-canal" value="${esc(c.canales[0].id)}">`
          : '<p role="alert">La línea principal de Central no está disponible. Consultá a Administración → Canales.</p>'}
      </div>
      <div class="field"><label for="c-chat-texto">Mensaje inicial</label><textarea required maxlength="10000" rows="4" id="c-chat-texto"></textarea></div>
      <div class="err" role="alert" id="c-chat-error"></div></div>
      <div class="modal-f"><button type="button" class="btn ghost" data-cerrar>Cancelar</button>
        <button type="submit" class="btn" id="c-chat-send" ${c.canales.length ? '' : 'disabled'}>Enviar e iniciar negociación</button></div></form>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  let enviando = false;
  conectarEmojis('#c-chat-texto');
  $('#c-chat-form').onsubmit = async e => {
    e.preventDefault(); if (enviando) return;
    const texto = $('#c-chat-texto').value.trim(), canalId = $('#c-chat-canal').value;
    if (!texto || !canalId) return;
    enviando = true; $('#c-chat-send').disabled = true;
    try {
      const n = await post(`/contactos/${id}/conversacion`, { texto, canalId,
        telefono:$('#c-chat-numero').value });
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
  const turno=++ultimaCargaFicha;
  modal(`<div class="modal-h"><h3>Ficha 360°</h3><button class="x" data-cerrar>✕</button></div>
    <div class="modal-b" style="text-align:center;padding:35px" data-ficha-cargando="${esc(id)}">
      <span class="spin lg"></span><p>Consultando información del cliente…</p></div>`,true);
  $('[data-cerrar]').forEach(b=>b.onclick=cerrar);
  let c;
  try{
    c=await api(`/contactos/${id}`,{cache:'no-store',signal:AbortSignal.timeout(16000)});
  }catch(e){
    if(turno!==ultimaCargaFicha || !$('[data-ficha-cargando]'))return;
    modal(`<div class="modal-h"><h3>No se pudo cargar la ficha 360°</h3><button class="x" data-cerrar>✕</button></div>
      <div class="modal-b"><p role="alert">${esc(e.message)}</p>
      <p class="sub">Si el problema continúa, revisá permisos y conexión del CRM. No se modificó ningún dato.</p></div>
      <div class="modal-f"><button class="btn ghost" data-cerrar>Cerrar</button>
      <button class="btn" id="f-reintentar">Reintentar</button></div>`,true);
    $('[data-cerrar]').forEach(b=>b.onclick=cerrar);
    $('#f-reintentar').onclick=()=>ficha360(id);
    return;
  }
  if(turno!==ultimaCargaFicha || !$('[data-ficha-cargando]'))return;
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
       <div class="field"><label>Teléfono principal</label><input id="f-tel" readonly value="${esc(c.tel || '')}" title="Agregá otros teléfonos desde el apartado correspondiente"></div></div>
      <div class="row"><div class="field"><label>Email</label><input id="f-mail" value="${esc(c.email || '')}"></div>
       <div class="field"><label>Documento</label><input id="f-doc" value="${esc(c.doc || '')}"></div></div>
      <div class="row"><div class="field"><label>Ciudad</label><input id="f-ciu" value="${esc(c.ciudad || '')}"></div>
       <div class="field"><label>Responsable</label><input value="${esc(c.responsable || 'Libre')}" disabled>
        ${['admin','gerente','jefe'].includes(S.usuario.rol) ? '<button class="btn ghost sm" type="button" id="f-cambiar-responsable" style="margin-top:6px">Cambiar responsable</button>' : ''}
      </div></div>
      <div class="field"><label>Dirección ${c.lat != null ? '· <span style="color:var(--ok)">ubicada en el mapa</span>' : ''}</label>
        <input id="f-dir" value="${esc(c.direccion || '')}"></div>
      <div class="field"><label>Primer alta</label><input value="${fdate(c.creado)}" disabled></div>
      <div class="field"><label>Notas</label><textarea id="f-not" rows="2">${esc(c.notas || '')}</textarea></div>
      ${c.editable?'<button class="btn sm" id="f-guardar">Guardar cambios</button>'
        :'<p class="sub">Esta ficha es de solo lectura. Solicitá su asignación para editarla.</p>'}
      ${c.lat != null ? `<a class="btn ghost sm" href="https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}"
        target="_blank" rel="noopener">🗺 Ver en el mapa</a>` : ''}</div>
     <div class="card-box"><h3>Canales de ingreso</h3>
      ${Object.entries(porOrigen).map(([o, v]) => `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:var(--fs-sm)"><span>${o}</span><b>${v}</b></div>
        <div class="bar"><i style="width:${Math.round(v / r.total * 100)}%"></i></div></div>`).join('')
        || '<div class="empty">Sin datos</div>'}
      <h3 style="margin-top:14px">Teléfonos vinculados</h3>
      <p class="sub">Un cliente puede tener varios números, manteniendo su responsable e historial.</p>
      <div id="f-telefonos">${(c.telefonos||[]).map(t=>`
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
          <span><b>${esc(t.numero)}</b> <small>· ${esc(t.etiqueta)}</small></span>
          ${c.editable && t.tel_norm!==c.tel_norm
            ? `<button class="btn ghost sm" data-eliminar-telefono="${esc(t.id)}">Quitar</button>` : ''}
        </div>`).join('')||`<div>${esc(c.tel||'Sin teléfono principal')}</div>`}</div>
      ${c.editable?`<div class="row" style="margin-top:10px">
        <div class="field"><label>Agregar otro número (con código de país)</label>
        <input id="f-telefono-adicional" inputmode="tel" placeholder="5959XXXXXXXX"></div>
        <div class="field"><label>Tipo</label><select id="f-telefono-etiqueta">
          <option>Secundario</option><option>Trabajo</option><option>Personal</option><option>Familiar</option>
        </select></div></div>
        <button class="btn ghost sm" id="f-vincular-telefono">+ Vincular teléfono</button>
        <p class="err" id="f-error-telefono" role="alert"></p>`:''}
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
  if($('#f-cambiar-responsable'))$('#f-cambiar-responsable').onclick=()=>
    cambiarResponsableContacto(c.id,c);
  if(!c.editable){
    ['f-nom','f-mail','f-doc','f-ciu','f-dir','f-not'].forEach(x=>{
      const elem=$('#'+x);if(elem)elem.disabled=true;
    });
  }else{
    $('#f-guardar').onclick=async()=>{
      const boton=$('#f-guardar');boton.disabled=true;
      try{
        await patch(`/contactos/${c.id}`,{
          nombre:$('#f-nom').value.trim(),email:$('#f-mail').value.trim(),
          doc:$('#f-doc').value.trim(),ciudad:$('#f-ciu').value.trim(),
          direccion:$('#f-dir').value.trim(),notas:$('#f-not').value
        });
        toast('Ficha actualizada','ok');cerrar();vistaContactos();
      }catch(e){toast(e.message,'bad','Ficha 360');boton.disabled=false;}
    };
    if($('#f-vincular-telefono'))$('#f-vincular-telefono').onclick=async()=>{
      const boton=$('#f-vincular-telefono');boton.disabled=true;
      try{
        await post(`/contactos/${c.id}/telefonos`,{
          numero:$('#f-telefono-adicional').value,etiqueta:$('#f-telefono-etiqueta').value
        });
        toast('Número vinculado a la misma ficha','ok');ficha360(id);
      }catch(e){if($('#f-error-telefono'))$('#f-error-telefono').textContent=e.message;
        boton.disabled=false;}
    };
    $('[data-eliminar-telefono]').forEach(b=>b.onclick=async()=>{
      if(!confirm('¿Desvincular este teléfono secundario? No se borrarán los mensajes del cliente.'))return;
      b.disabled=true;
      try{await del(`/contactos/${c.id}/telefonos/${b.dataset.eliminarTelefono}`);
        toast('Número desvinculado','ok');ficha360(id);}
      catch(e){toast(e.message,'bad');b.disabled=false;}
    });
  }
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
