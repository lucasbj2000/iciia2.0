import { $, $$, esc, get, post, fdate, toast } from './core.js';
const campos={titulo:'Título',etapa:'Etapa',agente_id:'Responsable',responsable_id:'Responsable del contacto',sucursal:'Sucursal',linea:'Línea',valor:'Valor',monto_cierre:'Monto de cierre',motivo:'Motivo',bot_activo:'Bot',nombre:'Nombre',tel:'Teléfono',email:'Correo',doc:'Documento',ciudad:'Ciudad',direccion:'Dirección',notas:'Notas del contacto',usuario:'Usuario',rol:'Rol',cargo:'Cargo',superior_id:'Superior',equipo:'Equipo',nacimiento:'Nacimiento',activo:'Acceso activo',oculto:'Usuario oculto',contraseña:'Contraseña',registro:'Registro',nota_interna:'Nota interna'};
const operacion={INSERT:'Alta',UPDATE:'Cambio',DELETE:'Eliminación'};
const valor=v=>v==null?'—':typeof v==='object'?JSON.stringify(v,null,2):String(v);
export function tablaCambios(rows){
  return `<div class="cambios-tabla"><table><thead><tr><th>Fecha / usuario</th><th>Registro / campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>${rows.map(c=>`<tr><td>${fdate(c.ts)}<br><b>${esc(c.usuario)}</b></td><td>${esc(c.entidad)} · ${esc(operacion[c.operacion]||c.operacion)}<br>${esc(campos[c.campo]||c.campo)}<small class="audit-id">${esc(c.entidad_id)}</small></td><td><pre>${esc(valor(c.anterior))}</pre></td><td><pre>${esc(valor(c.nuevo))}</pre></td></tr>`).join('')||'<tr><td colspan="4">Todavía no hay cambios registrados.</td></tr>'}</tbody></table></div>`;
}
export function notasHTML(){return `<div class="notas-aviso">Notas internas · no se envían al cliente</div><div id="notas-lista" class="notas-lista" aria-live="polite"></div><form id="nota-form" class="nota-form"><div class="field"><label for="nota-texto">Nota interna</label><textarea id="nota-texto" required maxlength="5000" rows="3" placeholder="Instrucciones para el equipo…"></textarea></div><div class="field"><label for="nota-menciones">Mencionar (opcional, hasta 10)</label><select id="nota-menciones" multiple size="3" aria-describedby="nota-ayuda"></select><small id="nota-ayuda">Solo empleados que ya tienen permiso para esta negociación. Usá Ctrl/Cmd para seleccionar varios en PC.</small></div><div id="nota-error" class="err" role="alert"></div><button class="btn" type="submit" id="nota-guardar">Guardar nota interna</button></form>`;}
export async function cargarNotas(id){
  const box=$('#notas-lista');if(!box)return;
  const revision=box._revision=(box._revision||0)+1;
  const result=await get(`/negociaciones/${id}/notas`);
  if($('#notas-lista')!==box||box._revision!==revision)return;
  const scroll=box.scrollTop;
  box.innerHTML=result.notas.map(n=>`<article class="nota"><b>${esc(n.autor_nombre)}</b><small>${fdate(n.ts)}</small><div>${esc(n.texto)}</div>${(n.mencionados||[]).length?`<p class="nota-tags">${n.mencionados.map(u=>`<span>@${esc(u.nombre)}</span>`).join(' ')}</p>`:''}</article>`).join('')||'<p class="sub">Sin notas internas.</p>';
  box.scrollTop=scroll;
  const select=$('#nota-menciones'), seleccionados=[...select.selectedOptions].map(o=>o.value);
  select.innerHTML=result.colaboradores.map(u=>`<option value="${u.id}" ${seleccionados.includes(u.id)?'selected':''}>${esc(u.nombre)} · ${esc(u.rol)}</option>`).join('');
}
export function conectarNotas(id){
  let busy=false;
  const form=$('#nota-form');if(!form)return;
  form.onsubmit=async e=>{
    e.preventDefault();if(busy)return;
    const input=$('#nota-texto'),boton=$('#nota-guardar'),error=$('#nota-error');
    const original=input.value,texto=original.trim(),menciones=[...$('#nota-menciones').selectedOptions].map(o=>o.value);
    if(!texto)return;if(menciones.length>10){error.textContent='Podés mencionar hasta 10 personas.';return;}
    busy=true;boton.disabled=true;error.textContent='';
    try{
      await post(`/negociaciones/${id}/notas`,{texto,menciones});
      if($('#nota-form')!==form)return;
      if(input.value===original)input.value='';
      toast('Nota interna guardada','ok');await cargarNotas(id);
    }catch(ex){if($('#nota-form')===form)error.textContent=ex.message;}finally{busy=false;boton.disabled=false;}
  };
}
export async function cargarCambiosNeg(id){
  const box=$('#f-cambios');if(!box)return;
  const revision=box._revision=(box._revision||0)+1;
  const result=await get(`/negociaciones/${id}/cambios`);
  if($('#f-cambios')!==box||box._revision!==revision)return;
  box.innerHTML=tablaCambios(result.cambios);
}
