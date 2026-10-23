/* IMPAR · Administración > Catálogos: subir ZIP y distribuir PDFs a todos los agentes. */
import { $, esc, S, get, del, confirmar, toast } from './core.js';

const formato=bytes => (Number(bytes||0)/1048576).toFixed(1)+' MB';

export async function vistaCatalogosImpar(){
  const host=$('#adm-body');
  if(!host)return;
  const datos=await get('/admin/catalogos');
  host.innerHTML = '<div class="card-box" style="max-width:1050px">'+
    '<h3>📚 Catálogos de IMPAR</h3>'+
    '<p class="sub">Subí un ZIP con documentos PDF. El sistema los extrae automáticamente y los deja disponibles para <b>todos los agentes</b> desde <b>Respuestas y acciones → Respuestas rápidas</b>. No requiere Hostinger ni comandos.</p>'+
    '<div id="cz-zona" tabindex="0" role="button" aria-label="Seleccionar ZIP de catálogos"'+
    ' style="border:2px dashed var(--brand);border-radius:12px;padding:23px;text-align:center;cursor:pointer;background:var(--surface2)">'+
    '<div style="font-size:28px">📦</div><b>Seleccionar ZIP o arrastrarlo aquí</b>'+
    '<div class="sub">Hasta '+datos.maxZipMB+' MB por ZIP · máximo 25 PDF · '+datos.maxPdfMB+' MB cada PDF</div>'+
    '</div>'+
    '<input id="cz-archivo" type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden>'+
    '<div class="row" style="margin:10px 0;align-items:center">'+
    '<b id="cz-nombre" style="flex:1;min-width:0;overflow-wrap:anywhere">Ningún archivo seleccionado</b>'+
    '<button class="btn sm" id="cz-subir" disabled>📤 Cargar catálogos</button>'+
    '</div>'+
    '<div id="cz-progreso" hidden><progress id="cz-barra" max="100" value="0" style="width:100%"></progress>'+
    '<p id="cz-estado" role="status" class="sub">Preparando carga…</p></div>'+
    '<div id="cz-resultado" role="status" aria-live="polite"></div>'+
    '<h3 style="margin-top:22px">Catálogos disponibles ('+datos.catalogos.length+')</h3>'+
    '<p class="sub">Los agentes deben volver a abrir la conversación para ver un catálogo recién cargado. Subir de nuevo el mismo PDF no lo duplica.</p>'+
    '<div id="cz-listado">'+(datos.catalogos.length
       ? '<table><thead><tr><th>Catálogo</th><th>Tamaño</th><th>Acciones</th></tr></thead><tbody>'+
          datos.catalogos.map(c=>'<tr><td><b>'+esc(c.titulo||c.nombre)+'</b><small style="display:block">'+esc(c.nombre)+'</small></td>'+
          '<td>'+formato(c.bytes)+'</td><td><button class="btn ghost sm" data-cz-retirar="'+esc(c.id)+'" data-cz-nombre="'+esc(c.nombre)+'" type="button">Retirar</button></td></tr>').join('')+
          '</tbody></table>'
       : '<p class="sub">Todavía no se cargaron catálogos desde este apartado.</p>')+
    '</div></div>';
  const input=$('#cz-archivo'),zona=$('#cz-zona'),boton=$('#cz-subir'),nombre=$('#cz-nombre'),
    progreso=$('#cz-progreso'),barra=$('#cz-barra'),estado=$('#cz-estado'),resultado=$('#cz-resultado');
  let archivo=null,subiendo=false;
  const seleccionar=file=>{
    if(subiendo)return;
    if(!file || !/\.zip$/i.test(file.name)){archivo=null;boton.disabled=true;nombre.textContent='Seleccioná un archivo .zip válido';return;}
    archivo=file;boton.disabled=false;nombre.textContent=file.name+' · '+formato(file.size);
    resultado.textContent='';
  };
  zona.onclick=()=>{if(!subiendo)input.click();};
  zona.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();zona.click();}};
  zona.ondragover=e=>{e.preventDefault();zona.style.borderStyle='solid';};
  zona.ondragleave=()=>{zona.style.borderStyle='dashed';};
  zona.ondrop=e=>{e.preventDefault();zona.style.borderStyle='dashed';seleccionar(e.dataTransfer?.files?.[0]);};
  input.onchange=()=>seleccionar(input.files?.[0]);
  boton.onclick=()=>{
    if(!archivo||subiendo)return;
    if(archivo.size>datos.maxZipMB*1048576){toast('El ZIP supera el límite permitido.','bad','Catálogos');return;}
    subiendo=true;boton.disabled=true;input.disabled=true;
    progreso.hidden=false;barra.value=0;estado.textContent='Subiendo y verificando los documentos…';resultado.textContent='';
    const form=new FormData();form.append('zip',archivo,archivo.name);
    const xhr=new XMLHttpRequest();
    xhr.open('POST','/api/admin/catalogos/importar');
    if(S.token)xhr.setRequestHeader('Authorization','Bearer '+S.token);
    if(S.empresa?.id && S.usuario?.esAdminGlobal)xhr.setRequestHeader('X-Empresa',S.empresa.id);
    xhr.timeout=180000;
    xhr.upload.onprogress=e=>{if(e.lengthComputable){barra.value=Math.round(e.loaded/e.total*100);estado.textContent='Subiendo '+barra.value+'%…';}};
    xhr.upload.onload=()=>{estado.textContent='Guardando PDF y habilitando respuestas rápidas…';};
    xhr.onload=()=>{
      let respuesta={};try{respuesta=JSON.parse(xhr.responseText);}catch{}
      if(xhr.status>=200&&xhr.status<300&&respuesta.ok){
        toast('Catálogos disponibles para los agentes','ok','IMPAR');
        estado.textContent='Importación terminada.';
        resultado.textContent='✓ '+respuesta.incluidos.length+' nuevos · '+respuesta.repetidos.length+' repetidos (sin duplicar).';
        // Releer el catálogo compartido sin refrescar toda la aplicación.
        vistaCatalogosImpar().catch(e=>toast(e.message,'bad'));
      }else{
        estado.textContent='No se importó el ZIP.';
        resultado.textContent='⚠ '+(respuesta.error||'No se pudo procesar el archivo.');
        toast(respuesta.error||'No se pudo importar el ZIP','bad','Catálogos');
        subiendo=false;boton.disabled=false;input.disabled=false;
      }
    };
    xhr.onerror=()=>{estado.textContent='Error de conexión';resultado.textContent='Revisá la conexión e intentá nuevamente.';subiendo=false;boton.disabled=false;input.disabled=false;};
    xhr.ontimeout=()=>{estado.textContent='La carga agotó el tiempo de espera';subiendo=false;boton.disabled=false;input.disabled=false;};
    xhr.send(form);
  };
  host.querySelectorAll('[data-cz-retirar]').forEach(b=>b.onclick=async()=>{
    if(!await confirmar('Retirar catálogo','Se quitará <b>'+esc(b.dataset.czNombre)+'</b> de las respuestas rápidas. Los mensajes que ya lo enviaron permanecerán intactos.','Retirar'))return;
    try{await del('/admin/catalogos/'+encodeURIComponent(b.dataset.czRetirar));toast('Catálogo retirado de las respuestas rápidas','ok');await vistaCatalogosImpar();}
    catch(e){toast(e.message,'bad');}
  });
}
