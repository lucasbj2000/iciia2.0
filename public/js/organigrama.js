import { $, $$, esc, S, get, post, patch, toast, modal, cerrar, confirmar } from './core.js';
let empleados=[];
const rolTexto={admin:'Administrador',gerente:'Gerencia general',jefe:'Jefatura',agente:'Agente'};
export async function vistaOrganigrama(){
  empleados=await get('/organigrama');const admin=S.usuario.rol==='admin';
  const activos=empleados.filter(u=>u.activo),bajas=empleados.filter(u=>!u.activo);
  const sucursales=[...new Set([...S.sucursales.map(s=>s.nombre),...activos.filter(u=>['jefe','agente'].includes(u.rol)).map(u=>u.sucursal||'Sin sucursal')])];
  const card=u=>`<article class="org-persona"><span class="org-rol">${esc(rolTexto[u.rol])}</span><h3>${esc(u.nombre)}</h3><p>${esc(u.cargo||rolTexto[u.rol])}</p><small>${esc(u.usuario)}</small>${u.superior_id?`<p class="org-superior">Depende de ${esc(empleados.find(x=>x.id===u.superior_id)?.nombre||'—')}</p>`:''}${admin?`<button class="btn ghost sm" data-edit="${u.id}">Gestionar empleado</button>`:''}</article>`;
  $('#view').innerHTML=`<div class="section org-section"><div class="org-toolbar"><div><h2>Organigrama IMPAR</h2><p class="sub">${activos.length} empleados activos · ${bajas.length} bajas</p></div>${admin?'<button class="btn" id="org-alta">+ Contratar empleado</button><label class="btn ghost" for="org-file">Importar clientes y empleados</label><input hidden type="file" accept=".json,application/json" id="org-file">':''}</div>
  <div class="org-direccion">${activos.filter(u=>['admin','gerente'].includes(u.rol)).map(card).join('')}</div>
  <div class="org-sucursales">${sucursales.map(s=>`<section class="org-rama"><h3 class="org-sucursal">${esc(s)}</h3>${activos.filter(u=>(u.sucursal||'Sin sucursal')===s&&u.rol==='jefe').map(card).join('')}${activos.filter(u=>(u.sucursal||'Sin sucursal')===s&&u.rol==='agente').map(card).join('')}</section>`).join('')}</div>
  ${bajas.length?`<details class="card-box"><summary>Empleados dados de baja (${bajas.length})</summary><div class="org-direccion">${bajas.map(card).join('')}</div></details>`:''}
  ${admin?'<div class="card-box"><h3>Vincular vendedores SAP con empleados</h3><p class="sub">Podés resolver los nombres que no coinciden con la nómina. Esto cambia el responsable de los contactos seleccionados.</p><div id="org-vendedores"></div></div>':''}
  <div id="org-result" aria-live="polite"></div></div>`;
  $$('[data-edit]').forEach(b=>b.onclick=()=>editar(empleados.find(u=>u.id===b.dataset.edit)));
  if(admin){$('#org-alta').onclick=()=>editar();$('#org-file').onchange=importar;await vendedores();}
}
async function vendedores(){
  const rows=await get('/organigrama/vendedores');
  $('#org-vendedores').innerHTML=rows.length?`<div class="row"><div class="field"><label for="org-vendor">Vendedor de la base SAP</label><select id="org-vendor">${rows.map(x=>`<option value="${esc(x.vendedor)}">${esc(x.vendedor)} · ${x.filas} filas · ${x.sin_responsable} sin responsable</option>`).join('')}</select></div><div class="field"><label for="org-owner">Empleado responsable</label><select id="org-owner"><option value="">Seleccionar…</option>${empleados.filter(x=>x.activo&&x.rol!=='admin').map(x=>`<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select></div></div><button type="button" class="btn sm" id="org-link">Vincular clientes</button>`:'<p class="sub">Importá primero la base de clientes.</p>';
  if($('#org-link'))$('#org-link').onclick=async()=>{
    const vendedor=$('#org-vendor').value,usuario_id=$('#org-owner').value;
    if(!usuario_id)return toast('Seleccioná un empleado','warn');
    if(!window.confirm(`¿Asignar los clientes de ${vendedor} al empleado seleccionado?`))return;
    const btn=$('#org-link');btn.disabled=true;
    try{const r=await post('/organigrama/vincular-vendedor',{vendedor,usuario_id});toast(`${r.vinculados} contactos vinculados`,'ok');await vendedores();}catch(ex){toast(ex.message,'bad');btn.disabled=false;}
  };
}
function editar(u){
  const v=u||{rol:'agente',activo:true,sucursal:S.sucursales[0]?.nombre||'',linea:'Ventas'};
  const sucs=[...new Set(['Todas las sucursales',...S.sucursales.map(s=>s.nombre),v.sucursal].filter(Boolean))];
  modal(`<form id="org-form"><div class="modal-h"><h3>${u?'Gestionar empleado':'Contratar empleado'}</h3><button type="button" class="x" data-cerrar>✕</button></div><div class="modal-b">
    <div class="field"><label for="org-nombre">Nombre</label><input required id="org-nombre" value="${esc(v.nombre||'')}"></div>
    <div class="row"><div class="field"><label for="org-usuario">Usuario</label><input required id="org-usuario" value="${esc(v.usuario||'')}" pattern="[a-zA-Z0-9._-]{3,80}"></div><div class="field"><label for="org-password">${u?'Nueva contraseña (opcional)':'Contraseña inicial'}</label><input id="org-password" type="password" minlength="8" ${u?'':'required'} autocomplete="new-password"></div></div>
    <div class="row"><div class="field"><label for="org-rol">Rol de acceso</label><select id="org-rol">${Object.entries(rolTexto).map(([r,t])=>`<option value="${r}" ${r===v.rol?'selected':''}>${t}</option>`).join('')}</select></div><div class="field"><label for="org-cargo">Puesto / cargo</label><input id="org-cargo" value="${esc(v.cargo||'')}"></div></div>
    <div class="row"><div class="field"><label for="org-sucursal">Sucursal</label><select id="org-sucursal">${sucs.map(s=>`<option ${s===v.sucursal?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div class="field"><label for="org-linea">Línea</label><input id="org-linea" value="${esc(v.linea||'')}"></div></div>
    <div class="field"><label for="org-superior">Superior directo</label><select id="org-superior"><option value="">Sin superior</option>${empleados.filter(x=>x.activo&&x.id!==v.id).map(x=>`<option value="${x.id}" ${x.id===v.superior_id?'selected':''}>${esc(x.nombre)} · ${esc(rolTexto[x.rol])}</option>`).join('')}</select></div>
    <div class="row"><div class="field"><label for="org-email">Correo</label><input type="email" id="org-email" value="${esc(v.email||'')}"></div><div class="field"><label for="org-tel">Teléfono</label><input type="tel" id="org-tel" value="${esc(v.tel||'')}"></div></div>
    ${u?`<label><input type="checkbox" id="org-activo" ${v.activo?'checked':''}> Empleado activo</label><p class="sub">Al dar de baja se bloquea el acceso y se conserva el historial. Reasigná primero sus subordinados.</p>`:''}
    <div class="err" id="org-error" role="alert"></div></div><div class="modal-f">${u&&u.rol!=='admin'?'<button type="button" class="btn ghost" id="org-delete">Eliminar usuario</button>':''}<button type="button" class="btn ghost" data-cerrar>Cancelar</button><button type="submit" class="btn" id="org-save">Guardar</button></div></form>`);
  $('[data-cerrar]').forEach(b=>b.onclick=cerrar);
  if($('#org-delete'))$('#org-delete').onclick=()=>{cerrar();solicitarEliminarUsuario(u);};
  let busy=false;$('#org-form').onsubmit=async e=>{
    e.preventDefault();if(busy)return;
    const payload={};for(const k of ['nombre','usuario','password','rol','cargo','sucursal','linea','email','tel'])payload[k]=$('#org-'+k).value.trim();
    // Las contraseñas se conservan literalmente, incluidos espacios intencionales.
    payload.password=$('#org-password').value;payload.superior_id=$('#org-superior').value||null;payload.activo=$('#org-activo')?$('#org-activo').checked:true;
    if(u?.activo&&!payload.activo&&!window.confirm(`Se bloqueará el acceso de ${u.nombre} y se conservará su historial. ¿Dar de baja?`))return;
    busy=true;$('#org-save').disabled=true;
    try{u?await patch('/organigrama/empleados/'+u.id,payload):await post('/organigrama/empleados',payload);cerrar();await vistaOrganigrama();toast('Empleado actualizado','ok');}
    catch(ex){if($('#org-error'))$('#org-error').textContent=ex.message;if($('#org-save'))$('#org-save').disabled=false;}finally{busy=false;}
  };
}

/** Administrador: un paso para elegir a quién entregar la cartera y archivar la cuenta. */
export async function solicitarEliminarUsuario(usuario,alTerminar){
  if(S.usuario?.rol!=='admin' || usuario?.rol==='admin')return;
  let previa;
  try{
    previa=await get('/organigrama/empleados/'+encodeURIComponent(usuario.id)+'/transferencia');
  }catch(e){toast(e.message,'bad','Eliminar usuario');return;}
  const candidatos=previa.candidatos||[];
  if(!candidatos.length){toast('No existe otro empleado activo al que transferir los datos.','warn');return;}
  const r=previa.resumen||{};
  const contadores=[
    ['Clientes',r.clientes],['Negociaciones',r.negociaciones],
    ['Subordinados',r.subordinados],['Tareas',r.tareas],
    ['Sucursales',r.sucursales],['Solicitudes',r.solicitudes]
  ].map(([n,v])=>'<span style="display:inline-flex;gap:5px;border:1px solid var(--line);border-radius:7px;padding:6px 8px">'+
    esc(n)+': <b>'+Number(v||0)+'</b></span>').join('');
  modal('<div class="modal-h"><h3>Eliminar usuario y transferir datos</h3>'+
    '<button type="button" class="x" data-cerrar>✕</button></div>'+
    '<div class="modal-b">'+
    '<p>Vas a eliminar del organigrama a <b>'+esc(previa.origen.nombre)+'</b> ('+esc(previa.origen.usuario)+').</p>'+
    '<div class="field"><label for="org-transfer-destino">¿A qué empleado querés pasar sus datos?</label>'+
    '<select id="org-transfer-destino" required><option value="">Elegir destinatario…</option>'+
    candidatos.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.nombre)+' · '+esc(u.usuario)+
      (u.sucursal?' · '+esc(u.sucursal):'')+'</option>').join('')+'</select></div>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">'+contadores+'</div>'+
    '<p class="sub">Se transferirán clientes, negociaciones, tareas y responsabilidades. No se modificarán la contraseña, el cargo ni la sucursal del destinatario. La cuenta antigua quedará sin acceso y oculta, conservando el historial de sus mensajes.</p>'+
    '<div class="err" id="org-transfer-error" role="alert"></div></div>'+
    '<div class="modal-f"><button type="button" class="btn ghost" data-cerrar>Cancelar</button>'+
    '<button type="button" class="btn danger" id="org-transfer-ok" disabled>Eliminar y transferir</button></div>');
  $('[data-cerrar]').forEach(x=>x.onclick=cerrar);
  const elegir=$('#org-transfer-destino'),enviar=$('#org-transfer-ok');
  elegir.onchange=()=>{enviar.disabled=!elegir.value;};
  enviar.onclick=async()=>{
    const destinoId=elegir.value;
    if(!destinoId||enviar.disabled)return;
    enviar.disabled=true;elegir.disabled=true;enviar.textContent='Transfiriendo…';
    try{
      const respuesta=await post('/organigrama/empleados/'+encodeURIComponent(usuario.id)+'/eliminar',{
        destinoId,confirmacion:'TRANSFERIR_Y_ELIMINAR'
      });
      cerrar();
      if(typeof alTerminar==='function')await alTerminar();
      else await vistaOrganigrama();
      toast('Usuario eliminado. '+Number(respuesta.movidos?.clientes||0)+' clientes y '+
        Number(respuesta.movidos?.negociaciones||0)+' negociaciones transferidos a '+
        respuesta.destino.nombre+'.','ok','IMPAR');
    }catch(e){
      const err=$('#org-transfer-error');if(err)err.textContent=e.message;
      const btn=$('#org-transfer-ok');if(btn){btn.disabled=false;btn.textContent='Eliminar y transferir';}
      if($('#org-transfer-destino'))$('#org-transfer-destino').disabled=false;
    }
  };
}

async function importar(e){
  const file=e.target.files[0];if(!file)return;
  if(file.size>4.5*1024*1024){toast('El archivo supera 4,5 MB','bad');return;}
  try{
    const data=JSON.parse(await file.text());
    if(data.empresa!=='IMPAR'||!Array.isArray(data.empleados)||!Array.isArray(data.clientes))throw new Error('Seleccioná el paquete IMPAR preparado.');
    const ok=await confirmar('Importar datos IMPAR',`${data.empleados.length} empleados y ${data.clientes.length} filas de clientes. Se conservan los datos originales y las contraseñas de empleados que ya existen.`,'Importar');
    if(!ok)return;
    $('#org-result').textContent='Importando datos; esperá a que termine…';$('#org-file').disabled=true;
    const result=await post('/organigrama/importar',data);await vistaOrganigrama();
    $('#org-result').innerHTML=`<div class="card-box"><h3>Importación completada</h3><p>${result.empleadosNuevos} empleados nuevos · ${result.empleadosExistentes} existentes · ${result.filasClientes} filas procesadas · ${result.contactosNuevos} contactos nuevos.</p><p>${result.telefonosCompartidos} teléfonos compartidos entre clientes distintos: se conservan por separado.</p>${Object.keys(result.vendedoresSinVincular).length?`<h4>Vendedores pendientes de vinculación</h4>${Object.entries(result.vendedoresSinVincular).map(([n,c])=>`<p>${esc(n)}: ${c} clientes</p>`).join('')}`:''}</div>`;
  }catch(ex){toast(ex.message,'bad');if($('#org-result'))$('#org-result').textContent='La importación no se completó. Podés volver a intentarlo.';}finally{if($('#org-file')){$('#org-file').disabled=false;$('#org-file').value='';}}
}
