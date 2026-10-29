/* IMPAR · mensajes históricos agregados por admin, nunca enviados por WhatsApp. */
import {$,esc,post,toast,confirmar} from './core.js';

export const botonAnclarHistorico = m => /^\d+$/.test(String(m?.id||''))
  ? '<button type="button" class="btn ghost sm" data-hist-tras="'+esc(m.id)+
    '" title="Insertar mensaje histórico después de éste">✚ aquí</button>' : '';

export function formularioHistorico(){
  return '<details id="f-historico-manual" class="ficha-acordeon" style="margin:8px 0">'+
    '<summary>✚ Registrar mensaje histórico (solo administrador)</summary>'+
    '<div class="card-box" style="margin-top:6px">'+
    '<p class="sub">Se agrega al historial sin enviarse por WhatsApp, sin modificar la etapa y dejando constancia de quién lo incorporó.</p>'+
    '<div class="row" style="flex-wrap:wrap;gap:8px">'+
    '<div class="field" style="flex:1;min-width:120px"><label>¿Quién escribió?</label>'+
    '<select id="hist-dir"><option value="in">Cliente</option><option value="out">Agente</option></select></div>'+
    '<div class="field" style="flex:1;min-width:160px"><label>Ubicación</label>'+
    '<select id="hist-modo"><option value="fecha">Fecha y hora</option>'+
    '<option value="antes">Antes de un mensaje</option><option value="despues">Después de un mensaje</option></select></div>'+
    '<div class="field" id="hist-fecha-zona" style="flex:2;min-width:190px">'+
    '<label>Fecha y hora del mensaje</label><input id="hist-fecha" type="datetime-local" step="1"></div></div>'+
    '<small id="hist-referencia" style="display:none"></small>'+
    '<div class="field"><label>Contenido</label><textarea id="hist-texto" rows="3" maxlength="10000" '+
    'placeholder="Contenido histórico, sin envío a WhatsApp"></textarea></div>'+
    '<button type="button" class="btn sm" id="hist-guardar">Registrar sin enviar</button>'+
    '</div></details>';
}
export function activarCargaHistorica(id,refrescar){
  const form=$('#f-historico-manual'),chat=$('#chatbox');
  if(!form||!chat)return;
  const now=new Date();
  $('#hist-fecha').value=new Date(now.getTime()-now.getTimezoneOffset()*60000)
    .toISOString().slice(0,19);
  const modo=$('#hist-modo'),fecha=$('#hist-fecha-zona'),referencia=$('#hist-referencia');
  let ancla='';
  const cambiar=()=>{
    const posicion=modo.value!=='fecha';
    fecha.hidden=posicion;
    referencia.style.display=posicion?'block':'none';
    referencia.textContent=posicion
      ?(ancla?'Se insertará '+(modo.value==='antes'?'antes':'después')+
        ' del mensaje #'+ancla:'Seleccioná «✚ aquí» en el mensaje que quieras utilizar.')
      :'';
  };
  modo.onchange=cambiar;
  chat.addEventListener('click',e=>{
    const b=e.target.closest('[data-hist-tras]');
    if(!b||!chat.contains(b))return;
    ancla=b.dataset.histTras;
    modo.value='despues';cambiar();form.open=true;
    form.scrollIntoView({behavior:'smooth',block:'nearest'});
    $('#hist-texto').focus();
  });
  $('#hist-guardar').onclick=async()=>{
    const boton=$('#hist-guardar'),texto=$('#hist-texto').value.trim();
    if(!texto)return toast('Ingresá el mensaje histórico.','warn');
    const payload={direccion:$('#hist-dir').value,texto,modo:modo.value};
    if(modo.value==='fecha'){
      const d=new Date($('#hist-fecha').value);
      if(!Number.isFinite(d.getTime()))return toast('Elegí una fecha y hora válidas.','warn');
      payload.fecha=d.toISOString();
    }else{
      if(!ancla)return toast('Seleccioná antes un mensaje con «✚ aquí».','warn');
      payload.referenciaId=ancla;
    }
    const ok=await confirmar('Registrar mensaje histórico',
      'Se agregará como mensaje del '+(payload.direccion==='in'?'cliente':'agente')+
      ', etiquetado como carga administrativa. <b>No se enviará por WhatsApp.</b>',
      'Registrar',false);
    if(!ok)return;
    boton.disabled=true;
    try{
      await post('/negociaciones/'+id+'/historico',payload);
      $('#hist-texto').value='';
      toast('Mensaje histórico registrado sin enviar por WhatsApp.','ok');
      await refrescar(id);
    }catch(e){toast(e.message,'bad','Carga histórica');}
    finally{boton.disabled=false;}
  };
}
