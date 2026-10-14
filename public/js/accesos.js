/* IMPAR · panel de acceso: datos siempre consultados al servidor; claves no recuperables. */
import { $, $$, esc, S, api, post, toast, modal, cerrar, confirmar, fdate } from './core.js';

let cuentas=[], momento='', seleccion=new Set(), filtro='';
const noPeligroso=val=>{
  const v=String(val??'');
  // Evitar que Excel interprete nombres/usuarios como fórmulas.
  return /^[\s]*[=+\-@\t\r]/.test(v)?"'"+v:v;
};
export function tablaCSV(cabecera,filas){
  const formato=valor=>'"'+noPeligroso(valor).replace(/"/g,'""')+'"';
  return '\uFEFF'+[cabecera,...filas].map(f=>f.map(formato).join(';')).join('\r\n');
}
function descargarCSV(nombre,texto){
  const url=URL.createObjectURL(new Blob([texto],{type:'text/csv;charset=utf-8;'}));
  const enlace=document.createElement('a');
  enlace.href=url;enlace.download=nombre;
  document.body.appendChild(enlace);enlace.click();enlace.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
const fechaNombre=()=>new Date().toISOString().slice(0,10);
const hora=val=>val?fdate(val):'Nunca ingresó';
const esEmpleado=u=>u.activo && u.rol!=='admin';

function filtradas(){
  return cuentas.filter(u=>(u.nombre+' '+u.usuario+' '+u.rol+' '+(u.sucursal||'')).toLowerCase().includes(filtro));
}

function pintarTabla(){
  const total=cuentas.length,activos=cuentas.filter(u=>u.activo).length;
  const elegibles=filtradas().filter(esEmpleado);
  const visibles=filtradas(),tabla=$('#acc-tabla');
  if(!tabla)return;
  $('#acc-resumen').textContent=total+' cuentas · '+activos+' activas · '+(total-activos)+' inactivas · Consultado: '+(momento?hora(momento):'—');
  const btn=$('#acc-generar');
  btn.disabled=seleccion.size===0;
  btn.textContent='Generar nuevas claves ('+seleccion.size+')';
  $('#acc-total').textContent=visibles.length+' usuario(s) visibles';
  tabla.innerHTML='<div class="acc-scroll"><table><thead><tr><th><input type="checkbox" id="acc-todas" aria-label="Seleccionar empleados visibles"></th>'+
    '<th>Nombre y usuario</th><th>Rol</th><th>Sucursal</th><th>Línea</th><th>Estado</th><th>Último ingreso</th><th>Contraseña</th></tr></thead>'+
    '<tbody>'+visibles.map(u=>
      '<tr><td><input type="checkbox" data-acc-id="'+esc(u.id)+'" '+(seleccion.has(u.id)?'checked':'')+
        (esEmpleado(u)?'':' disabled')+' aria-label="Seleccionar '+esc(u.nombre)+'"></td>'+
      '<td><b>'+esc(u.nombre)+'</b><small>'+esc(u.usuario)+'</small></td>'+
      '<td>'+esc(u.rol)+'</td><td>'+esc(u.sucursal||'—')+'</td><td>'+esc(u.linea||'—')+'</td>'+
      '<td><span class="'+(u.activo?'acc-online':'acc-offline')+'">'+(u.activo?'Activo':'Inactivo')+'</span></td>'+
      '<td>'+esc(hora(u.ultimo_login))+'</td>'+
      '<td><span class="acc-cerrada">Protegida · no recuperable</span></td></tr>').join('')+
    '</tbody></table></div>';
  const seleccionar=$('#acc-todas');
  seleccionar.disabled=elegibles.length===0;
  seleccionar.checked=elegibles.length>0 && elegibles.every(u=>seleccion.has(u.id));
  seleccionar.onchange=()=>{
    elegibles.forEach(u=>seleccionar.checked?seleccion.add(u.id):seleccion.delete(u.id));
    pintarTabla();
  };
  $$('[data-acc-id]',tabla).forEach(c=>c.onchange=()=>{
    if(c.checked)seleccion.add(c.dataset.accId);else seleccion.delete(c.dataset.accId);
    pintarTabla();
  });
}

async function verificarAccesos(){
  const btn=$('#acc-verificar');if(btn){btn.disabled=true;btn.textContent='Consultando…';}
  try{
    const resultado=await api('/admin/accesos',{cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!Array.isArray(resultado.usuarios))throw new Error('Listado de cuentas incompleto.');
    cuentas=resultado.usuarios;momento=resultado.consultadoEn;
    if($('#acc-exportar'))$('#acc-exportar').disabled=false;
    seleccion=new Set([...seleccion].filter(id=>cuentas.some(u=>u.id===id&&esEmpleado(u))));
    pintarTabla();
    return true;
  }catch(e){
    if(!momento&&$('#acc-exportar'))$('#acc-exportar').disabled=true;
    toast('No fue posible verificar las cuentas: '+e.message,'bad','Accesos');
    return false;
  }finally{if(btn){btn.disabled=false;btn.textContent='Verificar / actualizar';}}
}

function exportarListado(){
  // Solo datos observables; nunca se envían ni reconstruyen contraseñas.
  const filas=filtradas().map(u=>[u.nombre,u.usuario,u.rol,u.sucursal||'',u.linea||'',
    u.activo?'Activo':'Inactivo',u.ultimo_login?hora(u.ultimo_login):'Nunca ingresó',
    'No recuperable']);
  descargarCSV('IMPAR_Usuarios_'+fechaNombre()+'.csv',tablaCSV(
    ['Nombre','Usuario','Rol','Sucursal','Línea','Estado','Último ingreso','Contraseña actual'],
    filas));
  toast('Listado exportado: '+filas.length+' usuarios, sin contraseñas antiguas.','ok','Accesos');
}

function mostrarClaves(entregas){
  // Estas claves viven solamente en el modal de esta operación.
  const nombre='IMPAR_Claves_Temporales_'+fechaNombre()+'.csv';
  modal('<div class="modal-h"><h3>Credenciales nuevas · mostrar una sola vez</h3>'+
    '<button class="x" id="acc-cerrar-temporales">✕</button></div>'+
    '<div class="modal-b"><p><b>Se reemplazaron las contraseñas anteriores para futuros ingresos.</b> Las sesiones abiertas podrían permanecer activas hasta vencer. Estas claves nuevas se muestran una sola vez. Entregá cada una únicamente a su empleado.</p>'+
    '<div class="acc-scroll"><table><thead><tr><th>Empleado</th><th>Usuario</th><th>Clave temporal</th><th></th></tr></thead><tbody>'+
    entregas.map((u,i)=>'<tr><td>'+esc(u.nombre)+'</td><td>'+esc(u.usuario)+
      '</td><td class="mono acc-clave">'+esc(u.claveTemporal)+'</td>'+
      '<td><button class="btn ghost sm" data-acc-copiar="'+i+'">Copiar</button></td></tr>').join('')+
    '</tbody></table></div><p class="sub">El archivo CSV contiene contraseñas en texto claro: guardalo de forma privada y no lo compartas en grupos.</p></div>'+
    '<div class="modal-f"><button class="btn" id="acc-descargar-temporales">Exportar estas claves una vez</button>'+
    '<button class="btn ghost" id="acc-fin-temporales">Cerrar y descartar</button></div>',true);
  $('#acc-descargar-temporales').onclick=()=>descargarCSV(nombre,tablaCSV(
    ['Nombre','Usuario','Contraseña temporal','Rol','Sucursal','Ingreso'],
    entregas.map(u=>[u.nombre,u.usuario,u.claveTemporal,u.rol,u.sucursal||'','https://crm.iciia.tech/'])));
  $$('[data-acc-copiar]').forEach(b=>b.onclick=async()=>{
    const u=entregas[Number(b.dataset.accCopiar)];
    try{await navigator.clipboard.writeText('IMPAR CRM\nUsuario: '+u.usuario+'\nContraseña temporal: '+u.claveTemporal+'\nhttps://crm.iciia.tech/');
      toast('Acceso individual copiado.','ok');}
    catch{toast('No se pudo copiar; seleccioná los datos del cuadro.','warn');}
  });
  const terminar=()=>{cerrar();entregas.forEach(u=>{u.claveTemporal='';});entregas.length=0;};
  $('#acc-cerrar-temporales').onclick=terminar;
  $('#acc-fin-temporales').onclick=terminar;
}

function generarClaves(){
  const ids=[...seleccion];
  if(!ids.length)return;
  if(ids.length>30){toast('Por seguridad, máximo 30 empleados por operación.','warn');return;}
  modal('<div class="modal-h"><h3>Confirmar nuevas contraseñas · '+ids.length+' empleados</h3>'+
    '<button class="x" id="acc-cancelar-reset">✕</button></div>'+
    '<div class="modal-b"><p><b>Sus contraseñas anteriores dejarán de servir para nuevos ingresos.</b> Las sesiones ya abiertas pueden mantenerse activas hasta su vencimiento. Ninguna cuenta administradora puede seleccionarse.</p>'+
    '<div class="field"><label>Tu contraseña actual de administrador</label>'+
    '<input id="acc-admin-pass" type="password" autocomplete="current-password" required></div>'+
    '<div class="field"><label>Escribí RESTABLECER para confirmar</label>'+
    '<input id="acc-palabra" autocomplete="off" placeholder="RESTABLECER"></div>'+
    '<div class="err" id="acc-error" role="alert"></div></div>'+
    '<div class="modal-f"><button class="btn ghost" id="acc-reset-volver">Cancelar</button>'+
    '<button class="btn danger" id="acc-reset-ejecutar">Crear '+ids.length+' claves nuevas</button></div>');
  $('#acc-cancelar-reset').onclick=cerrar;
  $('#acc-reset-volver').onclick=cerrar;
  $('#acc-reset-ejecutar').onclick=async()=>{
    const campo=$('#acc-admin-pass');
    const pwd=campo.value;
    if(!pwd || $('#acc-palabra').value.trim()!=='RESTABLECER'){
      $('#acc-error').textContent='Ingresá tu contraseña y escribí RESTABLECER exactamente.';
      return;
    }
    const btn=$('#acc-reset-ejecutar');btn.disabled=true;btn.textContent='Generando credenciales…';
    campo.value='';
    try{
      const r=await post('/admin/accesos/claves-temporales',{
        ids,confirmacion:'RESTABLECER_ACCESOS',passwordAdmin:pwd
      });
      if(!r.ok||!Array.isArray(r.entregas))throw new Error('El servidor no confirmó la generación.');
      seleccion.clear();
      cerrar();
      pintarTabla();
      mostrarClaves(r.entregas);
    }catch(e){
      if($('#acc-error')){$('#acc-error').textContent=e.message;btn.disabled=false;btn.textContent='Crear '+ids.length+' claves nuevas';}
      else toast(e.message,'bad','Accesos');
    }
  };
}

export async function vistaAccesos(){
  if(S.usuario?.rol!=='admin')return;
  cuentas=[];seleccion=new Set();filtro='';momento='';
  const panel=$('#adm-body');if(!panel)return;
  panel.innerHTML='<div class="card-box acc-panel"><div class="acc-cabecera"><div>'+
    '<h2>Accesos del personal · IMPAR</h2><p class="sub">Consultar, verificar y exportar el listado actualizado de cuentas registradas. Acceso exclusivo del administrador.</p></div>'+
    '<div class="acc-actions"><button class="btn ghost sm" id="acc-verificar">Verificar / actualizar</button>'+
    '<button class="btn sm" id="acc-exportar" disabled>Exportar listado CSV</button></div></div>'+
    '<div class="acc-info" id="acc-resumen">Consultando los usuarios de IMPAR…</div>'+
    '<div class="acc-filtros"><input id="acc-buscar" placeholder="Buscar por nombre, usuario o sucursal…" aria-label="Filtrar usuarios">'+
    '<small id="acc-total"></small></div><div id="acc-tabla"></div>'+
    '<div class="acc-seguridad"><b>Contraseñas protegidas</b><p>Las contraseñas vigentes están cifradas: nadie puede leerlas ni comprobar cuál es su texto original. Verificar y exportar no modifica ninguna cuenta.</p>'+
    '<p>Para entregar nuevas credenciales, seleccioná solo los empleados necesarios y generá claves temporales. Esa acción <b>reemplaza</b> las anteriores y requiere confirmación.</p>'+
    '<button class="btn danger sm" id="acc-generar" disabled>Generar nuevas claves (0)</button></div>'+
    '</div>';
  $('#acc-verificar').onclick=verificarAccesos;
  $('#acc-exportar').onclick=exportarListado;
  $('#acc-generar').onclick=generarClaves;
  $('#acc-buscar').oninput=e=>{filtro=e.target.value.toLowerCase().trim();pintarTabla();};
  await verificarAccesos();
}
