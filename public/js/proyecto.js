/* IMPAR · Panel del proyecto CRM (fases, responsables, checklist, documentación y comentarios). */
import {
  $, $$, esc, S, get, post, put, patch, del, toast, modal, cerrar, confirmar, fdate, fd, vacio
} from './core.js';

let datos = null;
let faseActual = null;
let cargando = false;
const num = x => Math.min(100, Math.max(0, Number(x) || 0));
const media = items => items.length ? Math.round(items.reduce((s, p) => s + num(p.porcentaje), 0) / items.length) : 0;
const porFase = f => media((datos?.pasos || []).filter(p => p.fase_id === f.id));
const porcentajeGeneral = () => datos?.fases?.length
  ? Math.round(datos.fases.reduce((s, f) => s + porFase(f), 0) / datos.fases.length) : 0;
const barra = n => '<div class="pr-bar" aria-label="Avance ' + num(n) + '%"><i style="width:' + num(n) + '%"></i></div>';
const boton = (texto, id, clase = 'btn ghost sm') => '<button class="' + clase + '" data-pr="' + id + '">' + texto + '</button>';
const fecha = v => v ? String(v).slice(0,10) : '';
const nombreFase = id => datos?.fases?.find(f => f.id === id)?.nombre || 'General';
const hoy = () => new Date().toISOString().slice(0,10);
const error = e => toast(e.message || 'No se pudo guardar.', 'bad');

export async function vistaProyecto() {
  if (cargando) return;
  cargando = true;
  try {
    datos = await get('/proyecto');
    if (faseActual && !datos.fases.some(f => f.id === faseActual)) faseActual = null;
    pintar();
  } catch (e) {
    $('#view').innerHTML = '<div class="section"><div class="card-box">No se pudo cargar el proyecto: ' + esc(e.message) + '</div></div>';
  } finally {
    cargando = false;
  }
}

function pintar() {
  if (!datos || S.vista !== 'proy') return;
  const totalPasos = datos.pasos.length;
  const terminados = datos.pasos.filter(p => Number(p.porcentaje) === 100).length;
  const progreso = porcentajeGeneral();
  const fase = datos.fases.find(f => f.id === faseActual);
  let html = '<section class="pr-panel fx-vista">';
  html += '<div class="pr-hero"><div class="pr-head"><div><div class="pr-eyebrow">IMPAR · Implementación</div><h2>Avances del proyecto CRM</h2>' +
    '<p>Seguimiento de fases, tareas, necesidades y entregables del proyecto.</p></div><div class="pr-actions">' +
    boton('↻ Actualizar', 'refrescar') +
    (datos.admin ? boton('Administrar accesos','accesos') + boton('+ Nueva fase','nueva-fase','btn sm') : '') +
    '</div></div><div class="pr-stats"><div class="pr-stat"><strong>' + progreso + '%</strong><span>Avance global de las fases</span>' +
    barra(progreso) + '</div><div class="pr-stat"><strong>' + datos.fases.length + '</strong><span>Fases registradas</span></div>' +
    '<div class="pr-stat"><strong>' + terminados + ' / ' + totalPasos + '</strong><span>Pasos finalizados</span></div></div>' +
    '<small class="pr-note">El avance de cada fase es el promedio de sus pasos; el avance global es el promedio de las fases. Una fase sin pasos cuenta como 0%.</small></div>';
  html += '<div class="pr-layout"><aside class="pr-aside"><h3>Fases del proyecto</h3>' +
    '<button class="pr-fase ' + (faseActual ? '' : 'selected') + '" data-pr-fase=""><b>📊 Vista general</b><small>Todas las fases y tareas</small></button>' +
    datos.fases.map((f, i) => '<button class="pr-fase ' + (f.id === faseActual ? 'selected' : '') + '" data-pr-fase="' + esc(f.id) + '">' +
      '<span class="pr-num">' + (i + 1) + '</span><span class="pr-fase-txt"><b>' + esc(f.nombre) + '</b><small>' + porFase(f) + '% completado</small>' +
      barra(porFase(f)) + '</span></button>').join('') +
    '</aside><div class="pr-content">';

  if (fase) {
    html += '<div class="pr-title"><div><h3>' + esc(fase.nombre) + '</h3><p>' + esc(fase.descripcion || 'Sin descripción de la fase.') + '</p></div>' +
      (datos.admin ? '<div>' + boton('Editar fase','editar-fase') + boton('Eliminar','borrar-fase','btn danger sm') + '</div>' : '') + '</div>' +
      pintarBloqueFase(fase);
  } else if (datos.fases.length) {
    html += '<h3 class="pr-section-title">Plan de ejecución</h3>';
    html += datos.fases.map(f => '<div class="pr-fase-resumen">' +
      '<button class="pr-fase-link" data-pr-fase="' + esc(f.id) + '"><b>' + esc(f.nombre) + '</b><span>' + porFase(f) + '% · Ver detalle →</span></button>' +
      '<p>' + esc(f.descripcion || 'Sin descripción') + '</p>' + barra(porFase(f)) +
      '<small>' + datos.pasos.filter(p => p.fase_id === f.id && num(p.porcentaje) === 100).length +
      ' de ' + datos.pasos.filter(p => p.fase_id === f.id).length + ' pasos completados</small></div>').join('');
  } else {
    html += vacio('🗂', 'Aún no hay fases', datos.admin
      ? 'Agregá la primera fase para planificar el proyecto CRM.'
      : 'El administrador cargará las fases y los avances.');
  }
  if (fase) html += pintarComentarios(fase.id) + pintarDocumentos(fase.id);
  else html += pintarComentarios(null) + pintarDocumentos(null);
  html += '</div></div></section>';
  $('#view').innerHTML = html;
  vincular();
}

function pintarBloqueFase(fase) {
  const ps = datos.pasos.filter(p => p.fase_id === fase.id);
  let h = '<div class="pr-summary-line"><span>Avance de la fase</span><b>' + porFase(fase) + '%</b></div>' +
    barra(porFase(fase));
  for (const tipo of ['necesidad','tarea']) {
    const items = ps.filter(p => p.tipo === tipo);
    h += '<div class="pr-block"><div class="pr-block-head"><div><h4>' +
      (tipo === 'necesidad' ? 'Checklist de necesidades' : 'Tareas y entregables') +
      '</h4><small>' + (tipo === 'necesidad' ? 'Requisitos para poder avanzar' : 'Actividades de implementación') +
      '</small></div>' +
      (datos.admin ? boton('+ Agregar', 'nuevo-' + tipo) : '') + '</div>';
    if (!items.length) h += '<div class="pr-empty">No hay ' + (tipo === 'necesidad' ? 'necesidades' : 'tareas') + ' registradas.</div>';
    h += items.map(p => pintarPaso(p)).join('') + '</div>';
  }
  return h;
}

function pintarPaso(p) {
  const editable = datos.admin || p.responsable_id === S.usuario?.id;
  const fin = num(p.porcentaje) === 100;
  let h = '<div class="pr-task" data-paso="' + esc(p.id) + '">' +
    '<div class="pr-task-top"><span class="pr-check ' + (fin ? 'done' : '') + '" aria-hidden="true">' +
    (fin ? '✓' : '') + '</span><div class="pr-task-text"><b>' + esc(p.titulo) + '</b>' +
    (p.detalle ? '<p>' + esc(p.detalle) + '</p>' : '') +
    '<small>Responsable: ' + esc(p.responsable || 'Sin asignar') +
    (p.vence ? ' · Fecha objetivo: ' + esc(fd(p.vence)) : '') + '</small></div>' +
    '<b class="pr-pct">' + num(p.porcentaje) + '%</b></div>' + barra(p.porcentaje);
  if (editable) {
    h += '<div class="pr-task-actions"><label>Actualizar progreso <input class="pr-number" data-pr-num="' + esc(p.id) +
      '" type="number" min="0" max="100" step="5" value="' + num(p.porcentaje) + '"> %</label>' +
      '<button class="btn ghost sm" data-pr-avance="' + esc(p.id) + '">Guardar avance</button>' +
      '<button class="btn ghost sm" data-pr-completar="' + esc(p.id) + '">' + (fin ? 'Reabrir' : 'Marcar 100%') + '</button>' +
      (datos.admin ? boton('Editar','editar-paso:' + p.id) + boton('Eliminar','borrar-paso:' + p.id,'btn danger sm') : '') + '</div>';
  }
  return h + '</div>';
}

function pintarComentarios(faseId) {
  const mensajes = datos.comentarios.filter(c => (c.fase_id || null) === (faseId || null));
  let h = '<div class="pr-block"><div class="pr-block-head"><div><h4>Comentarios y coordinación</h4>' +
    '<small>' + (faseId ? 'Conversación de esta fase' : 'Conversación general del proyecto') +
    '</small></div><span class="pr-count">' + mensajes.length + '</span></div><div class="pr-chat">' +
    (mensajes.length ? mensajes.map(c => '<div class="pr-comment"><div class="pr-comment-head"><b>' + esc(c.autor) + '</b>' +
      '<small>' + esc(fdate(c.creado)) + '</small>' +
      ((datos.admin || c.usuario_id === S.usuario?.id) ? '<button data-pr="borrar-comentario:' + esc(c.id) + '" title="Eliminar comentario">×</button>' : '') +
      '</div><p>' + esc(c.texto).replace(/\n/g, '<br>') + '</p></div>').join('') :
      '<p class="pr-empty">Todavía no hay comentarios. Iniciá la conversación.</p>') +
    '</div><div class="pr-reply"><textarea id="pr-comentario" maxlength="3000" rows="2" placeholder="Compartir una actualización, necesidad o consulta…"></textarea>' +
    '<button class="btn sm" data-pr="enviar-comentario">Publicar</button></div></div>';
  return h;
}

function pintarDocumentos(faseId) {
  const ds = datos.documentos.filter(d => (d.fase_id || null) === (faseId || null));
  return '<div class="pr-block"><div class="pr-block-head"><div><h4>Documentos y archivos</h4>' +
    '<small>PDF, Word, Excel, PowerPoint e imágenes · máximo 10 MB</small></div></div>' +
    '<div class="pr-files">' + (ds.length ? ds.map(d => '<div class="pr-file"><span class="pr-file-icon">📎</span>' +
    '<span class="pr-file-name"><b>' + esc(d.nombre) + '</b><small>' + esc(d.autor || 'Usuario') + ' · ' +
      (Number(d.bytes) / 1048576).toFixed(2) + ' MB · ' + esc(fd(d.creado)) + '</small></span>' +
    '<button class="btn ghost sm" data-pr-doc="' + esc(d.id) + '">Descargar</button>' +
    ((datos.admin || d.usuario_id === S.usuario?.id) ? '<button class="btn danger sm" data-pr="borrar-documento:' +
      esc(d.id) + '">Eliminar</button>' : '') + '</div>').join('') :
      '<p class="pr-empty">Todavía no se adjuntaron documentos.</p>') + '</div>' +
    '<div class="pr-upload"><input id="pr-archivo" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.csv">' +
    '<button class="btn ghost sm" data-pr="subir-documento">Adjuntar documento</button></div></div>';
}

function vincular() {
  const root = $('#view .pr-panel');
  if (!root) return;
  $$('[data-pr-fase]',root).forEach(b => b.onclick = () => {
    faseActual = b.dataset.prFase || null; pintar();
  });
  $$('[data-pr]',root).forEach(b => b.onclick = () => accion(b.dataset.pr));
  $$('[data-pr-avance]',root).forEach(b => b.onclick = () => guardarAvance(b.dataset.prAvance, false));
  $$('[data-pr-completar]',root).forEach(b => b.onclick = () => guardarAvance(b.dataset.prCompletar, true));
  $$('[data-pr-doc]',root).forEach(b => b.onclick = () => descargar(b.dataset.prDoc));
}

async function guardarAvance(id, toggle) {
  const p=datos.pasos.find(x=>x.id===id);
  if (!p) return;
  const campo=$('[data-pr-num="' + id + '"]');
  const valor=toggle ? (num(p.porcentaje)===100?0:100) : Number(campo?.value);
  if (!Number.isInteger(valor) || valor<0 || valor>100) return toast('Ingresá un porcentaje entre 0 y 100.','warn');
  try { await patch('/proyecto/pasos/' + id + '/progreso',{porcentaje:valor}); await vistaProyecto(); toast('Avance actualizado.'); }
  catch(e) { error(e); }
}

async function accion(id) {
  try {
    if (id==='refrescar') return await vistaProyecto();
    if (id==='nueva-fase') return modalFase();
    if (id==='editar-fase') return modalFase(datos.fases.find(f=>f.id===faseActual));
    if (id==='accesos') return modalAccesos();
    if (id==='nuevo-necesidad' || id==='nuevo-tarea') return modalPaso(null,id.slice(6));
    if (id.startsWith('editar-paso:')) return modalPaso(datos.pasos.find(p=>p.id===id.slice(12)));
    if (id==='enviar-comentario') {
      const campo=$('#pr-comentario'),texto=campo?.value.trim();
      if (!texto) return toast('Escribí un comentario.','warn');
      await post('/proyecto/comentarios',{fase_id:faseActual,texto}); await vistaProyecto();
      return toast('Comentario publicado.');
    }
    if (id==='subir-documento') return subir();
    if (id==='borrar-fase') {
      if (!await confirmar('Eliminar fase','Se eliminarán los pasos y comentarios vinculados a esta fase. Los documentos quedarán disponibles en la vista general.','Eliminar')) return;
      await del('/proyecto/fases/'+faseActual); faseActual=null;
    } else if (id.startsWith('borrar-paso:')) {
      if (!await confirmar('Eliminar paso','Esta acción quitará el paso del seguimiento.','Eliminar')) return;
      await del('/proyecto/pasos/'+id.slice(11));
    } else if (id.startsWith('borrar-comentario:')) {
      if (!await confirmar('Eliminar comentario','Se quitará este comentario.','Eliminar')) return;
      await del('/proyecto/comentarios/'+id.slice(18));
    } else if (id.startsWith('borrar-documento:')) {
      if (!await confirmar('Eliminar documento','Se eliminará el archivo de forma permanente.','Eliminar')) return;
      await del('/proyecto/documentos/'+id.slice(17));
    } else return;
    await vistaProyecto(); toast('Cambios guardados.');
  } catch(e) { error(e); }
}

function estructuraModal(titulo,body,guardar='Guardar') {
  modal('<div class="modal-h"><h3>' + titulo + '</h3><button class="x" data-cerrar>✕</button></div>' +
    '<div class="modal-b">' + body + '</div><div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>' +
    '<button class="btn" id="pr-guardar">' + guardar + '</button></div>',true);
  $$('[data-cerrar]').forEach(b=>b.onclick=cerrar);
}
const field = (label,id,value='',type='text',extra='') =>
  '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + type +
  '" value="' + esc(value) + '" ' + extra + '></div>';
const area = (label,id,value='') =>
  '<div class="field"><label for="' + id + '">' + label + '</label><textarea rows="3" id="' + id + '">' + esc(value) + '</textarea></div>';
const valor = id => $('#'+id)?.value.trim()||'';

function modalFase(f) {
  estructuraModal(f?'Editar fase':'Nueva fase',
    field('Nombre *','pr-f-nombre',f?.nombre||'','text','maxlength="150"') +
    area('Descripción / objetivo','pr-f-desc',f?.descripcion||'') +
    field('Orden de presentación','pr-f-orden',f?.orden??datos.fases.length+1,'number','min="0" max="10000"'));
  $('#pr-guardar').onclick=async()=>{
    const b={nombre:valor('pr-f-nombre'),descripcion:valor('pr-f-desc'),orden:Number(valor('pr-f-orden'))};
    if (!b.nombre) return toast('Ingresá el nombre de la fase.','warn');
    try {
      if(f) await patch('/proyecto/fases/'+f.id,b);
      else { const r=await post('/proyecto/fases',b); faseActual=r.id; }
      cerrar(); await vistaProyecto(); toast('Fase guardada.');
    } catch(e) {error(e);}
  };
}

function modalPaso(p,tipoPorDefecto='tarea') {
  const faseId=p?.fase_id||faseActual;
  const opts=datos.fases.map(f=>'<option value="' + esc(f.id) + '" ' + (f.id===faseId?'selected':'') + '>' +
    esc(f.nombre) + '</option>').join('');
  const responsables='<option value="">Sin asignar</option>' +
    datos.usuarios.map(u=>'<option value="' + esc(u.id) + '" ' + (u.id===p?.responsable_id?'selected':'') + '>' +
    esc(u.nombre) + ' · ' + esc(u.rol) + '</option>').join('');
  estructuraModal(p?'Editar paso':'Agregar paso',
    '<div class="field"><label>Fase</label><select id="pr-p-fase">' + opts + '</select></div>' +
    '<div class="field"><label>Tipo</label><select id="pr-p-tipo">' +
    '<option value="tarea" ' + ((p?.tipo||tipoPorDefecto)==='tarea'?'selected':'') + '>Tarea / entregable</option>' +
    '<option value="necesidad" ' + ((p?.tipo||tipoPorDefecto)==='necesidad'?'selected':'') + '>Necesidad / checklist</option></select></div>' +
    field('Nombre del paso *','pr-p-titulo',p?.titulo||'','text','maxlength="220"') +
    area('Descripción y criterios de finalización','pr-p-detalle',p?.detalle||'') +
    '<div class="field"><label>Responsable</label><select id="pr-p-responsable">' + responsables + '</select></div>' +
    '<div class="pr-grid-two">' +
    field('Porcentaje de resolución (0-100)','pr-p-pct',p?.porcentaje??0,'number','min="0" max="100"') +
    field('Fecha objetivo','pr-p-vence',fecha(p?.vence),'date') + '</div>' +
    field('Orden','pr-p-orden',p?.orden??0,'number','min="0" max="10000"'));
  $('#pr-guardar').onclick=async()=>{
    const b={
      fase_id:valor('pr-p-fase'),tipo:valor('pr-p-tipo'),titulo:valor('pr-p-titulo'),
      detalle:valor('pr-p-detalle'),responsable_id:valor('pr-p-responsable')||null,
      porcentaje:Number(valor('pr-p-pct')),vence:valor('pr-p-vence')||null,orden:Number(valor('pr-p-orden'))
    };
    if (!b.titulo || !b.fase_id || !Number.isInteger(b.porcentaje) || b.porcentaje<0 || b.porcentaje>100)
      return toast('Revisá el título, la fase y el porcentaje.','warn');
    try {
      if(p) await patch('/proyecto/pasos/'+p.id,b); else await post('/proyecto/pasos',b);
      cerrar(); await vistaProyecto(); toast('Paso guardado.');
    } catch(e) { error(e); }
  };
}

function modalAccesos() {
  estructuraModal('Usuarios con acceso',
    '<p class="sub">Solo las personas seleccionadas podrán ver el módulo. Los administradores conservan acceso siempre.</p>' +
    '<div class="pr-members">' + datos.usuarios.filter(u=>u.rol!=='admin').map(u=>
      '<label><input type="checkbox" value="' + esc(u.id) + '" data-pr-miembro ' +
      (datos.miembros.includes(u.id)?'checked':'') + '><span><b>' + esc(u.nombre) + '</b>' +
      '<small>' + esc(u.cargo||u.rol) + (u.sucursal?' · '+esc(u.sucursal):'') + '</small></span></label>'
    ).join('') + '</div>','Guardar permisos');
  $('#pr-guardar').onclick=async()=>{
    const usuarios=$$('[data-pr-miembro]:checked').map(e=>e.value);
    try {
      await put('/proyecto/accesos',{usuarios}); cerrar(); await vistaProyecto();
      toast('Permisos actualizados.','ok');
    } catch(e) {error(e);}
  };
}

async function subir() {
  const input=$('#pr-archivo'), f=input?.files?.[0];
  if (!f) return toast('Seleccioná un documento primero.','warn');
  if (f.size>10*1024*1024) return toast('El tamaño máximo es de 10 MB.','warn');
  const form=new FormData();
  form.append('archivo',f);
  if(faseActual) form.append('fase_id',faseActual);
  try {
    const res=await fetch('/api/proyecto/documentos',{method:'POST',headers:{Authorization:'Bearer '+S.token},body:form});
    const data=await res.json();
    if (!res.ok) throw new Error(data.error||'No se pudo adjuntar el documento.');
    await vistaProyecto(); toast('Documento adjuntado.');
  } catch(e) {error(e);}
}

async function descargar(id) {
  const d=datos.documentos.find(x=>x.id===id);
  if (!d) return;
  try {
    const r=await fetch('/api/proyecto/documentos/'+id+'/descargar',{headers:{Authorization:'Bearer '+S.token}});
    if (!r.ok) { const e=await r.json(); throw new Error(e.error||'No se pudo descargar.'); }
    const blob=await r.blob(), url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=d.nombre;a.style.display='none';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(e) {error(e);}
}
