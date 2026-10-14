/* Importador exclusivo de Bitrix para IMPAR: previsualiza y agrega solo nuevos. */
import { $, $$, esc, S, get, post, toast } from './core.js';
let filas=[],usuarios=[],asignaciones={},preview=null,seleccionadoArchivo='';
const normal = text => String(text||'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function csvFilas(text) {
  const out=[];let fila=[],celda='',quote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quote && text[i+1]==='"'){celda+='"';i++;}
      else quote=!quote;
    }else if(c===';'&&!quote){fila.push(celda);celda='';}
    else if((c==='\n'||c==='\r')&&!quote){
      if(c==='\r'&&text[i+1]==='\n')i++;
      fila.push(celda);celda='';if(fila.some(x=>x.trim()))out.push(fila);fila=[];
    }else celda+=c;
  }
  if(quote)throw new Error('Hay comillas de CSV sin cerrar.');
  fila.push(celda);if(fila.some(x=>x.trim()))out.push(fila);
  return out;
}
async function leerArchivo(archivo){
  if(!archivo || archivo.size>1024*1024)throw new Error('Elegí un CSV Bitrix de hasta 1 MB.');
  const buf=await archivo.arrayBuffer();let str;
  try{str=new TextDecoder('utf-8',{fatal:true}).decode(buf);}
  catch{str=new TextDecoder('windows-1252').decode(buf);}
  const rows=csvFilas(str.replace(/^\ufeff/,''));
  if(rows.length<2)throw new Error('El CSV no contiene contactos.');
  const cab=rows.shift().map(normal);
  for(const campo of ['responsable','telefono del trabajo','nombre','apellido'])
    if(!cab.includes(campo))throw new Error('El CSV debe tener columnas: Responsable, Teléfono del trabajo, Nombre y Apellido.');
  if(rows.length>1000)throw new Error('El máximo es 1000 contactos por importación.');
  const extra=rows.some(r=>r.length>cab.length || r.length<2);
  if(extra)throw new Error('El CSV tiene filas mal formadas.');
  return rows.map(r=>{
    const obj=Object.fromEntries(cab.map((h,i)=>[h,(r[i]||'').trim()]));
    return {responsable:obj.responsable,telefono:obj['telefono del trabajo'],
      nombre:obj.nombre,apellido:obj.apellido};
  });
}
function usuariosActivos(){
  const byName=new Map();
  for(const u of usuarios){
    const key=normal(u.nombre);
    if(!byName.has(key))byName.set(key,[]);
    byName.get(key).push(u);
  }
  return byName;
}
function renderMapeos(){
  const element=$('#bi-responsables');if(!element)return;
  const owners=[...new Set(filas.map(x=>x.responsable))].sort();
  const ocurrencias=Object.fromEntries(owners.map(x=>[x,filas.filter(y=>y.responsable===x).length]));
  element.innerHTML=owners.map((owner,i)=>
    '<label class="bi-responsable"><span><b>'+esc(owner||'(sin responsable)')+'</b>'+
    '<small>'+ocurrencias[owner]+' contactos en el archivo</small></span>'+
    '<select data-bi-owner="'+i+'" aria-label="Asignar '+esc(owner)+'">'+
    '<option value="">No importar sin responsable</option>'+
    usuarios.map(u=>'<option value="'+esc(u.id)+'" '+(asignaciones[owner]===u.id?'selected':'')+'>'+
      esc(u.nombre)+' · '+esc(u.sucursal||u.rol)+'</option>').join('')+
    '</select></label>'
  ).join('');
  $$('[data-bi-owner]',element).forEach(select=>select.onchange=()=>{
    const owner=owners[Number(select.dataset.biOwner)];
    asignaciones[owner]=select.value;
    preview=null;pintarResultado();
  });
}
function pintarResultado(){
  const caja=$('#bi-resultado'),btn=$('#bi-aplicar');
  if(!caja||!btn)return;
  btn.disabled=!preview||preview.resumen.nuevos<1;
  if(!preview){caja.innerHTML='<p class="sub">Previsualizá para consultar los contactos actuales de IMPAR. La vista previa no guarda nada.</p>';return;}
  const c=preview.resumen;
  const estados={
    nuevo:'Listo para insertar',existente:'Ya existe · sin cambios',
    conflicto_archivo:'Duplicado en CSV',revision_nombre:'Posible duplicado de nombre',
    invalido:'Dato inválido',sin_responsable:'Responsable sin vincular'
  };
  const problemas=preview.detalles.filter(x=>x.estado!=='nuevo');
  caja.innerHTML='<div class="bi-kpis">'+
    [['Filas revisadas',c.recibidos],['Nuevos posibles',c.nuevos],
     ['Existentes, intactos',c.existentes],['Duplicados en archivo',c.conflictosArchivo],
     ['Nombres a revisar',c.nombresRevisar],['Datos inválidos',c.invalidos],
     ['Sin responsable',c.sinResponsable]]
      .map(([t,n])=>'<div class="bi-stat"><b>'+n+'</b><small>'+esc(t)+'</small></div>').join('')+
    '</div><p class="bi-aviso">Solo se crearán registros marcados como «Listo para insertar». Los existentes NO se actualizan, aunque sus responsables sean distintos.</p>'+
    (problemas.length?'<h3>Registros omitidos o pendientes ('+problemas.length+')</h3>'+
      '<div class="bi-tabla"><table><thead><tr><th>Fila</th><th>Contacto</th><th>Tel.</th><th>Origen</th><th>Resultado</th></tr></thead>'+
      '<tbody>'+problemas.map(x=>'<tr><td>'+x.fila+'</td><td>'+esc(x.nombre)+'</td><td>••••'+esc(x.telefonoUltimos4)+'</td>'+
        '<td>'+esc(x.responsableOrigen)+'</td><td>'+esc(estados[x.estado]||x.estado)+
        '<small>'+esc(x.motivo)+'</small></td></tr>').join('')+'</tbody></table></div>':'<p class="sub">No se detectaron casos pendientes en esta comprobación.</p>')+
    '<p class="sub">La comprobación se realizará nuevamente dentro de una transacción antes de grabar. Si la base cambió, se cancelará la carga.</p>';
}
async function previsualizar(){
  if(!filas.length)return toast('Primero seleccioná el CSV','warn');
  const btn=$('#bi-preview');btn.disabled=true;preview=null;pintarResultado();
  try{
    preview=await post('/bitrix/previsualizar',{filas,asignaciones});
    pintarResultado();
    toast('Vista previa completada. Todavía no se modificó la base de datos.','ok');
  }catch(e){toast(e.message,'bad');}finally{btn.disabled=false;}
}
async function aplicar(){
  if(!preview||!preview.resumen.nuevos)return;
  const cantidad=preview.resumen.nuevos;
  if(!window.confirm('IMPAR: ¿crear únicamente '+cantidad+' contactos nuevos? Nunca se modificarán los existentes.'))return;
  const btn=$('#bi-aplicar');btn.disabled=true;
  try{
    const resumen=await post('/bitrix/aplicar',{
      filas,asignaciones,firma:preview.firma,confirmacion:'IMPORTAR_SOLO_NUEVOS'
    });
    preview=null;pintarResultado();
    $('#bi-confirmacion').innerHTML='<div class="bi-exito">Carga finalizada: <b>'+resumen.insertados+
      ' contactos nuevos</b>. Registros preexistentes preservados: '+resumen.existentesSinCambios+
      '. Filas sin insertar por revisión: '+resumen.conflictos+'.</div>';
    toast(resumen.insertados+' contactos nuevos cargados. Los existentes no se tocaron.','ok');
    await previsualizar();
  }catch(e){toast(e.message,'bad');}
  finally{btn.disabled=!preview||!preview.resumen.nuevos;}
}
export async function vistaImportarBitrix(){
  const caja=$('#adm-body');if(!caja||S.usuario?.rol!=='admin')return;
  caja.innerHTML='<div class="card-box bi-panel">'+
    '<h2>Importar contactos de Bitrix · IMPAR</h2>'+
    '<p class="sub">Carga protegida: solo añade personas que no figuran en IMPAR. No modifica nombres, teléfonos, responsables, fichas ni negociaciones preexistentes.</p>'+
    '<div class="bi-banner"><b>1 · Seleccionar archivo</b>'+
    '<input id="bi-archivo" type="file" accept=".csv,text/csv">'+
    '<small id="bi-archivo-nombre">Archivo pendiente. Se procesa en tu sesión, no se sube a GitHub.</small></div>'+
    '<div class="bi-banner"><b>2 · Comprobar responsables</b>'+
    '<p class="sub">Cada responsable del archivo se vincula a un usuario activo. Las coincidencias exactas se proponen; las demás requieren elección manual.</p>'+
    '<div id="bi-responsables" class="bi-responsables"></div></div>'+
    '<div class="bi-banner"><b>3 · Comparar con el CRM</b>'+
    '<button class="btn sm" id="bi-preview" disabled>Previsualizar sin guardar</button>'+
    '<div id="bi-resultado"></div></div>'+
    '<div class="bi-banner"><b>4 · Confirmar solo altas nuevas</b>'+
    '<div id="bi-confirmacion"></div>'+
    '<button class="btn" id="bi-aplicar" disabled>Importar únicamente los nuevos</button></div></div>';
  try{usuarios=await get('/bitrix/usuarios');}
  catch(e){toast('No se pudo consultar empleados: '+e.message,'bad');return;}
  $('#bi-archivo').onchange=async event=>{
    const file=event.target.files?.[0];if(!file)return;
    filas=[];asignaciones={};preview=null;
    try{
      filas=await leerArchivo(file);
      seleccionadoArchivo=file.name;
      const mapa=usuariosActivos();
      for(const owner of new Set(filas.map(x=>x.responsable))){
        const matches=mapa.get(normal(owner))||[];
        asignaciones[owner]=matches.length===1?matches[0].id:'';
      }
      $('#bi-archivo-nombre').textContent=seleccionadoArchivo+' · '+filas.length+' registros';
      $('#bi-preview').disabled=false;
      $('#bi-confirmacion').textContent='';
      renderMapeos();pintarResultado();
    }catch(e){
      $('#bi-archivo-nombre').textContent=e.message;
      $('#bi-preview').disabled=true;toast(e.message,'bad');
    }
  };
  $('#bi-preview').onclick=previsualizar;
  $('#bi-aplicar').onclick=aplicar;
  pintarResultado();
}
