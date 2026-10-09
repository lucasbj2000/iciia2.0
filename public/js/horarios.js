/* Horarios IMPAR · administración y confirmación de salida de agentes. */
import { $, $$, esc, S, get, post, put, toast } from './core.js';
const DIAS=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const porDefecto=(dia)=>({dia,activo:dia>=1&&dia<=5,entrada:'08:00',salida:'17:00'});
let cfg=null,seleccionado='empresa',avisador=null,avisoAbierto=null,ultimaConsulta=0,posponerHasta=0,enConsulta=false;
const tiempo=h=>String(h||'').slice(0,5);
const editarDia = (h,modo='empresa') =>
  '<div class="ho-fila" data-ho-dia="'+h.dia+'">'+
   '<b>'+DIAS[h.dia]+'</b>'+
   (modo!=='empresa'?'<label><input data-ho-override type="checkbox" '+(h.personalizado?'checked':'')+'> Personalizado</label>':'')+
   '<label><input data-ho-activo type="checkbox" '+(h.activo?'checked':'')+
      (modo!=='empresa'&&!h.personalizado?' disabled':'')+'> Laborable</label>'+
   '<label>Entrada <input data-ho-entrada type="time" value="'+esc(tiempo(h.entrada))+'" '+(modo!=='empresa'&&!h.personalizado?'disabled':'')+'></label>'+
   '<label>Salida <input data-ho-salida type="time" value="'+esc(tiempo(h.salida))+'" '+(modo!=='empresa'&&!h.personalizado?'disabled':'')+'></label>'+
  '</div>';
function comprobar(h){
  const minutos=x=>Number(x.slice(0,2))*60+Number(x.slice(3,5));
  return /^\d{2}:\d{2}$/.test(h.entrada)&&/^\d{2}:\d{2}$/.test(h.salida)&&minutos(h.salida)>minutos(h.entrada);
}
function leerActual(){
  if(!cfg)return;
  const filas=$$('.ho-fila');
  if(!filas.length)return;
  const nuevas=filas.map(el=>({
    dia:Number(el.dataset.hoDia),
    activo:el.querySelector('[data-ho-activo]').checked,
    entrada:el.querySelector('[data-ho-entrada]').value,
    salida:el.querySelector('[data-ho-salida]').value,
    personalizado:seleccionado==='empresa'||!!el.querySelector('[data-ho-override]')?.checked
  }));
  if(nuevas.some(x=>x.personalizado&&!comprobar(x)))throw new Error('La hora de salida debe ser posterior a la entrada en todos los días.');
  if(seleccionado==='empresa')cfg.empresa=nuevas.map(({personalizado,...x})=>x);
  else{
    cfg.excepciones=cfg.excepciones.filter(x=>x.usuario_id!==seleccionado);
    cfg.excepciones.push(...nuevas.filter(x=>x.personalizado).map(({personalizado,...x})=>({...x,usuario_id:seleccionado})));
  }
}
function pintarEditor(){
  const caja=$('#ho-editor');if(!caja||!cfg)return;
  const empresa=seleccionado==='empresa';
  const u=cfg.usuarios.find(x=>x.id===seleccionado);
  const filas=cfg.empresa.map(base=>{
    const personal=cfg.excepciones.find(x=>x.usuario_id===seleccionado&&x.dia===base.dia);
    return {...base,...(personal||{}),personalizado:!!personal};
  });
  caja.innerHTML='<div class="ho-editor-head"><h3>'+(!empresa?'Horario de '+esc(u?.nombre||'agente'):'Horario general de IMPAR')+'</h3>'+
   '<p class="sub">'+(empresa?'Definí los días de atención y su entrada/salida.':'Los días sin personalización heredan los horarios generales.')+'</p></div>'+
   '<div class="ho-dias">'+filas.map(h=>editarDia(h,seleccionado)).join('')+'</div>';
  $$('[data-ho-override]',caja).forEach(el=>el.onchange=()=>{
    const fila=el.closest('.ho-fila');
    const base=cfg.empresa[Number(fila.dataset.hoDia)];
    fila.querySelector('[data-ho-activo]').disabled=!el.checked;
    fila.querySelector('[data-ho-entrada]').disabled=!el.checked;
    fila.querySelector('[data-ho-salida]').disabled=!el.checked;
    if(!el.checked){
      fila.querySelector('[data-ho-activo]').checked=base.activo;
      fila.querySelector('[data-ho-entrada]').value=base.entrada;
      fila.querySelector('[data-ho-salida]').value=base.salida;
    }
  });
}
async function estadoHoy(){
  const caja=$('#ho-hoy');if(!caja)return;
  try{
    const data=await get('/horarios/salidas-hoy');
    const activos=data.agentes.filter(x=>x.activo);
    caja.innerHTML='<div class="ho-hoy-titulo"><h3>Salidas de hoy · '+esc(data.fecha)+'</h3>'+
      '<small>Paraguay '+esc(data.horaActual)+' · respuestas de los agentes</small></div>'+
      (activos.length?'<div class="ho-respuestas">'+activos.map(x=>'<div class="ho-respuesta">'+
      '<span><b>'+esc(x.nombre)+'</b><small>'+esc(x.sucursal||'')+' · '+esc(x.entrada)+'–'+esc(x.salida)+'</small></span>'+
      '<strong class="'+(x.decision==='extra'?'ho-extra':x.decision==='normal'?'ho-normal':'')+'">'+
       (x.decision==='extra'?'Se queda hasta '+esc(x.hasta):x.decision==='normal'?'Sale a horario':'Sin confirmar')+'</strong></div>').join('')+'</div>':
      '<p class="sub">No hay agentes programados para hoy.</p>');
  }catch(e){caja.textContent='No se pudo obtener las confirmaciones de salida: '+e.message;}
}
export async function administrarHorarios(){
  const host=$('#adm-body');
  if(!host)return;
  host.innerHTML='<div class="card-box">Cargando horarios de IMPAR…</div>';
  cfg=await get('/horarios/config');seleccionado='empresa';
  host.innerHTML='<div class="card-box ho-admin"><div class="ho-head"><div><h2>Horarios laborales de IMPAR</h2>'+
    '<p class="sub">Aviso para agentes 10 minutos antes de la salida. Zona horaria: Paraguay (Asunción).</p></div>'+
    '<button class="btn sm" id="ho-guardar">Guardar todos los horarios</button></div>'+
    '<div class="ho-selector"><label>Editar horario de <select id="ho-persona"><option value="empresa">Toda IMPAR · horario base</option>'+
    cfg.usuarios.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.nombre)+' · '+esc(u.sucursal||'')+'</option>').join('')+
    '</select></label></div><div id="ho-editor"></div>'+
    '<div class="ho-aviso-info">Cada agente confirmará si sale a su hora normal o si continuará trabajando. Si extiende el turno, el CRM le volverá a consultar 10 minutos antes de su nueva salida. Las respuestas son una previsión, no una marcación automática de asistencia.</div></div>'+
    '<div class="card-box" id="ho-hoy"></div>';
  pintarEditor();await estadoHoy();
  $('#ho-persona').onchange=e=>{
    const nueva=e.target.value;
    try{leerActual();seleccionado=nueva;pintarEditor();}
    catch(err){toast(err.message,'bad');e.target.value=seleccionado;}
  };
  $('#ho-guardar').onclick=async()=>{
    const b=$('#ho-guardar');try{
      leerActual();b.disabled=true;
      await put('/horarios/config',{empresa:cfg.empresa,excepciones:cfg.excepciones});
      toast('Horarios y excepciones actualizados','ok');
      await estadoHoy();
    }catch(e){toast(e.message,'bad');}finally{b.disabled=false;}
  };
}

function cerrarAviso(){
  avisoAbierto?.remove();avisoAbierto=null;
}
function mostrarAviso(s){
  if(avisoAbierto && avisoAbierto.dataset.hoObjetivo===s.objetivo)return;
  cerrarAviso();
  const div=document.createElement('section');
  div.className='ho-aviso';
  div.dataset.hoObjetivo=s.objetivo;
  div.innerHTML='<div class="ho-alerta-cab"><span class="ho-reloj">◷</span><div><b>Tu jornada está por finalizar</b>'+
   '<small>Salida prevista: '+esc(s.objetivo)+' · faltan '+s.faltan+' minuto(s)</small></div></div>'+
   '<p>¿Vas a salir a tu hora o te quedarás más tiempo? Confirmá tu planificación para informar a administración.</p>'+
   '<div class="ho-alerta-acciones"><button class="btn sm" data-ho-normal>Salgo a las '+esc(s.objetivo)+'</button>'+
   '<button class="btn ghost sm" data-ho-extender>Me quedaré más tiempo</button></div>'+
   '<div class="ho-extension hidden"><label>¿Hasta qué hora? <input type="time" data-ho-hasta min="'+esc(s.objetivo)+'"></label>'+
   '<button class="btn sm" data-ho-confirma-extra>Confirmar extensión</button></div>'+
   '<button class="ho-posponer" data-ho-posponer>Recordarme en 2 minutos</button><div class="ho-error" role="alert"></div>';
  document.body.appendChild(div);avisoAbierto=div;
  const confirmar=async(decision)=>{
    const b=div.querySelector('[data-ho-normal]');b.disabled=true;
    const h=div.querySelector('[data-ho-hasta]').value;
    try{
      const r=await post('/horarios/mi-turno/responder',{decision,hasta:decision==='extra'?h:null,objetivo:s.objetivo});
      cerrarAviso();toast(r.decision==='extra'?'Salida prevista hasta '+r.hasta:'Salida normal confirmada','ok','Horario laboral');
    }catch(e){div.querySelector('.ho-error').textContent=e.message;b.disabled=false;}
  };
  div.querySelector('[data-ho-normal]').onclick=()=>confirmar('normal');
  div.querySelector('[data-ho-extender]').onclick=()=>{
    div.querySelector('.ho-extension').classList.remove('hidden');
    const input=div.querySelector('[data-ho-hasta]');
    if(!input.value){
      const mins=Number(s.objetivo.slice(0,2))*60+Number(s.objetivo.slice(3))+30;
      input.value=String(Math.min(23,Math.floor(mins/60))).padStart(2,'0')+':'+String(mins%60).padStart(2,'0');
    }
    input.focus();
  };
  div.querySelector('[data-ho-confirma-extra]').onclick=()=>confirmar('extra');
  div.querySelector('[data-ho-posponer]').onclick=()=>{posponerHasta=Date.now()+2*60000;cerrarAviso();};
}
export async function comprobarSalida(){
  if(!S.token||S.usuario?.rol!=='agente'||document.visibilityState==='hidden'||enConsulta)return;
  if(Date.now()<posponerHasta)return;
  enConsulta=true;
  try{
    const s=await get('/horarios/mi-turno');
    if(!S.token || S.usuario?.rol!=='agente')return;
    if(s.mostrarAviso)mostrarAviso(s);
    else cerrarAviso();
  }catch(e){/* No se cierra sesión por fallos de red; vuelve a intentar en el próximo ciclo. */}
  finally{enConsulta=false;ultimaConsulta=Date.now();}
}
export function iniciarControlTurnos(){
  clearInterval(avisador);avisador=null;cerrarAviso();
  if(S.usuario?.rol!=='agente')return;
  comprobarSalida();
  avisador=setInterval(comprobarSalida,60000);
}
export function detenerControlTurnos(){
  clearInterval(avisador);avisador=null;cerrarAviso();posponerHasta=0;
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.token)comprobarSalida();});
window.addEventListener('impar:salir',detenerControlTurnos);
