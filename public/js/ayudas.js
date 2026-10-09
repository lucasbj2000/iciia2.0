/* IMPAR · guía de descubrimiento no intrusiva para los usuarios autorizados. */
import { $, $$, esc, S, get, patch, toast } from './core.js';

const GUIAS = {
  neg: {
    titulo:'Negociaciones', descripcion:'Este tablero reúne los contactos comerciales y su estado de atención.',
    primer:'Elegí una etapa y abrí una tarjeta para ver el historial y hablar con el cliente.',
    items:[
      ['#f-q','Buscar conversaciones','Encontrá una negociación por nombre, teléfono o título.','Los filtros no cambian ni borran información.'],
      ['#f-origen','Origen del contacto','Mostrá únicamente conversaciones recibidas desde un canal determinado.','Seleccioná Todos los orígenes para volver a verlas todas.'],
      ['#f-marcador','Marcadores','Filtrá clientes frecuentes, transferidos o casos cargados manualmente.','Los marcadores ayudan a identificar situaciones particulares.'],
      ['#f-agente','Agente responsable','Filtrá las negociaciones de un asesor cuando tu rol lo permita.','No reasigna clientes; solamente cambia la vista.'],
      ['.etapa-tab','Etapas del proceso','Cada pestaña representa un momento del trabajo comercial.','Seleccioná una etapa para ver sus tarjetas en el celular.'],
      ['.col-h','Columnas del tablero','Cada columna agrupa las negociaciones según su estado.','Las tarjetas se organizan por etapa.'],
      ['.card[data-id]','Tarjeta del cliente','Abrí la tarjeta para consultar mensajes, datos, notas y seguimiento.','No necesitás crear otra negociación si ya hay una abierta.'],
      ['#b-rapida','Crear negociación rápida','Iniciá una gestión manual desde el tablero.','Verificá antes que el cliente no tenga una gestión activa.'],
      ['#b-manual','Carga manual','Registrá una atención recibida por otro medio.','Usá esta opción para no perder seguimientos.']
    ]
  },
  con:{
    titulo:'Contactos',descripcion:'Consultá los datos y antecedentes de los clientes de IMPAR.',
    primer:'Buscá un cliente, abrí su ficha y revisá si tiene una conversación activa.',
    items:[
      ['#c-buscar','Buscar cliente','Buscá personas por nombre, teléfono, correo o dirección.','La lista se filtra mientras escribís.'],
      ['#c-nuevo','Nuevo contacto','Cargá los datos de una persona que todavía no está registrada.','Revisá el teléfono para evitar duplicaciones.'],
      ['[data-conversacion]','Conversación','Abrí la gestión del cliente o iniciá una nueva cuando corresponda.','Si ya hay una gestión activa, el sistema procura llevarte a ella.'],
      ['[data-360]','Ficha 360°','Consultá los datos del contacto y sus antecedentes comerciales.','Ideal antes de volver a contactar a un cliente.'],
      ['#c-import','Importar','Subí clientes mediante el archivo permitido, si tenés acceso.','Verificá el formato y los datos antes de importar.'],
      ['#c-export','Exportar','Descargá un listado de contactos si tu rol tiene permiso.','Tratá los datos descargados como información empresarial.']
    ]
  },
  com:{
    titulo:'Comunicación interna',descripcion:'Espacio para coordinar tareas y mensajes con otros empleados.',
    primer:'Seleccioná un grupo o compañero y escribí un mensaje interno.',
    items:[
      ['.ci-side','Listado de conversaciones','Elegí a quién escribir o qué grupo abrir.','Estos mensajes son internos; no se envían al cliente.'],
      ['.ci-main','Conversación interna','Revisá el intercambio con el grupo o compañero seleccionado.','Usá este espacio para coordinaciones del equipo.'],
      ['#ci-msg','Escribir mensaje interno','Redactá lo que quieras comunicar a tus compañeros.','Comprobá el destinatario antes de enviar.'],
      ['#ci-enviar','Enviar mensaje interno','Publicá tu mensaje en la conversación seleccionada.','No sustituye al chat del cliente.']
    ]
  },
  cal:{
    titulo:'Calendario',descripcion:'Consultá actividades, reuniones, capacitaciones y fechas importantes.',
    primer:'Elegí una fecha o utilizá Nuevo evento para organizar una actividad.',
    items:[
      ['#cal-prev','Mes anterior','Retrocedé un mes en el calendario.'],
      ['#cal-next','Mes siguiente','Avanzá un mes en el calendario.'],
      ['#cal-hoy','Volver a hoy','Regresá al mes y fecha actuales.'],
      ['#cal-nuevo','Crear evento','Agregá una reunión, actividad o capacitación.','Completá los datos antes de guardarlo.'],
      ['.cal-d[data-dia]','Día del calendario','Tocá el día para ver los eventos registrados.']
    ]
  },
  rep:{
    titulo:'Reportes',descripcion:'Indicadores para comprender resultados de ventas y atención.',
    primer:'Elegí un período y revisá las métricas de tu ámbito de trabajo.',
    items:[
      ['#r-rango','Período de consulta','Cambiá el rango de días utilizado para los indicadores.','Un período más amplio puede mostrar tendencias distintas.'],
      ['.kpi','Indicadores principales','Resúmenes de negociaciones, cierres, conversión y tiempos.','La información depende de tus permisos y responsabilidades.'],
      ['#r-export','Exportar reporte','Descargá los datos disponibles para analizarlos.'],
      ['.bar','Gráficos y barras','Visualizá la distribución de las negociaciones y resultados.']
    ]
  },
  cfg:{
    titulo:'Configuración personal',descripcion:'Gestioná tu perfil, contraseña y preferencias de uso del CRM.',
    primer:'Revisá tus datos, mantené tu clave segura y marcá correctamente tu disponibilidad.',
    items:[
      ['#p-guardar','Guardar perfil','Guardá los cambios realizados en tus datos personales.'],
      ['#p-pass','Cambiar contraseña','Actualizá tu clave de ingreso.','No compartas tus contraseñas con otras personas.'],
      ['#p-tema','Tema de pantalla','Elegí un estilo claro u oscuro.','Solo cambia la apariencia de tu pantalla.'],
      ['#p-dens','Densidad','Definí si preferís ver más información con menos espacio entre elementos.'],
      ['#p-disp','Disponibilidad','Indicá si estás disponible para atender conversaciones.','El estado puede influir en la atención y asignación de contactos.'],
      ['#p-rapidas','Respuestas rápidas','Gestioná frases frecuentes para usarlas al atender clientes.']
    ]
  },
  proy:{
    titulo:'Avances del CRM',descripcion:'Seguimiento de las fases, necesidades y entregables del proyecto.',
    primer:'Abrí una fase, consultá su checklist y agregá avances si tenés una tarea asignada.',
    items:[
      ['.pr-stats','Avance general','Resumen del porcentaje de finalización de las fases del proyecto.'],
      ['.pr-fase','Fases del proyecto','Elegí una fase para conocer sus tareas y necesidades.'],
      ['.pr-task','Tarea o necesidad','Revisá el porcentaje, responsable y fecha objetivo.','El responsable puede actualizar su avance.'],
      ['.pr-reply','Comentarios del proyecto','Conversá con los participantes autorizados sobre la fase o el proyecto.'],
      ['.pr-upload','Documentos del proyecto','Adjuntá archivos necesarios para las tareas y entregables.'],
      ['[data-pr="accesos"]','Permisos del proyecto','El administrador elige quién puede ver esta sección.']
    ]
  },
  org:{
    titulo:'Organigrama',descripcion:'Conocé la estructura de sucursales, empleados y responsabilidades.',
    primer:'Consultá dónde trabaja cada persona y quién forma parte de cada equipo.',
    items:[
      ['.org-direccion','Dirección y gerencia','Personal de dirección y gestión general.'],
      ['.org-rama','Equipos por sucursal','Agrupa jefaturas y agentes de cada sucursal.'],
      ['#org-alta','Contratar empleado','El administrador puede registrar personal nuevo.'],
      ['[data-edit]','Gestionar empleado','Permite modificar datos, rol y estado de un empleado.']
    ]
  },
  adm:{
    titulo:'Administración',descripcion:'Herramientas de gestión del sistema, los usuarios y sus reglas.',
    primer:'Abrí la pestaña de la función que quieras configurar; los cambios afectan al uso del CRM.',
    items:[
      ['[data-adm="canales"]','Canales de atención','Controlá los números y las conexiones de mensajería.','Desconectar una línea puede interrumpir la recepción de mensajes.'],
      ['[data-adm="usuarios"]','Usuarios','Creá, bloqueá y asigná roles a empleados.'],
      ['[data-adm="diseno"]','Diseño y módulos','Configurá la marca y qué secciones están disponibles.'],
      ['[data-adm="flags"]','Funciones ON/OFF','Activá o desactivá capacidades del CRM para la empresa.','Revisá el impacto de cada función antes de desactivarla.'],
      ['[data-adm="ayudas"]','Ayudas interactivas','Elegí qué usuarios pueden acceder a las guías y mini explicaciones.'],
      ['[data-adm="etapas"]','Etapas comerciales','Organizá las etapas del flujo de negociaciones.'],
      ['[data-adm="bot"]','Bot de recepción','Definí cómo actúa la recepción automática de clientes.'],
      ['[data-adm="mensajeria"]','Salud de mensajería','Consultá conexiones e incidencias de comunicación.'],
      ['[data-adm="audit"]','Auditoría','Revisá el historial de cambios registrado por el sistema.']
    ]
  }
};

const COMUNES = [
  ['#chatbox','Historial de mensajes','Revisá los mensajes intercambiados con este cliente.','Desplazate para consultar mensajes anteriores.'],
  ['#msg','Escribir al cliente','Redactá una respuesta para la conversación actual.','Revisá el destinatario antes de enviar.'],
  ['#remsg','Recontactar cliente cerrado','Podés escribir nuevamente a un cliente cuya gestión se cerró.','El sistema inicia una nueva gestión de contacto.'],
  ['#f-enviar','Enviar respuesta','Envía el texto que escribiste al canal del cliente.','Presioná una sola vez y verificá el estado del mensaje.'],
  ['#f-rege','Enviar y re gestionar','Envía un nuevo mensaje y genera una gestión después del cierre.'],
  ['#f-adj','Adjuntar archivo','Agregá imágenes, documentos u otros archivos permitidos a la conversación.'],
  ['#f-bot','Bot automático','Indica si el bot puede responder en esta negociación.'],
  ['[data-tab="t-notas"]','Notas internas','Registrá información interna para el equipo.','Estas notas no son mensajes al cliente.'],
  ['[data-tab="t-det"]','Detalle de negociación','Consultá datos comerciales y herramientas de transferencia.'],
  ['#f-transferir','Transferir atención','Asigná la negociación a otro integrante de IMPAR.','Verificá al nuevo responsable antes de confirmar.'],
  ['#btn-burger','Menú de navegación','En celulares, abre las secciones disponibles para tu usuario.'],
  ['#disp-pill','Disponibilidad','Indicá tu estado de atención; afecta cómo recibe trabajo tu cuenta.','Actualizalo al comenzar o terminar tu turno.'],
  ['#noti-btn','Notificaciones','Revisá mensajes, eventos y alertas de seguimiento pendientes.'],
  ['#btn-tema','Modo claro u oscuro','Cambiá la apariencia visual sin alterar los datos del CRM.'],
  ['#btn-install-app','Aplicación IMPAR','Accedé a opciones de instalación y avisos desde tu dispositivo.'],
  ['#btn-salir','Cerrar sesión','Terminá tu sesión de forma segura cuando dejes de usar el CRM.']
];
const NAVEGACION = {
  neg:'Organizá y respondé conversaciones con clientes.',
  con:'Consultá fichas y datos de contactos.',
  com:'Mensajes internos con los compañeros.',
  cal:'Agenda de eventos y actividades.',
  rep:'Indicadores e informes de rendimiento.',
  proy:'Avance de las tareas de implementación del CRM.',
  cfg:'Datos, contraseña y preferencias personales.',
  org:'Organigrama y estructura de IMPAR.',
  adm:'Ajustes de gestión reservados a administración.'
};

let estado={habilitado:false,mini_ayudas:false,bienvenida:false,recorrido_visto:true,administrador:false};
let iniciada=false, observar=null, programado=false, tooltip=null, panel=null, bienvenida=null, bienvenidaLista=false;
let recorrido=null, marco=null, tarjeta=null, fondo=null;
const esMovil = () => matchMedia('(max-width:900px)').matches;
const visible = el => !!el && el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden';
const itemsActuales = () => [...COMUNES, ...(GUIAS[S.vista]?.items||[])].map(([selector,titulo,descripcion,consejo]) => ({selector,titulo,descripcion,consejo:consejo||''}));
const listaActual = () => itemsActuales().filter(x=>document.querySelector(x.selector) && visible(document.querySelector(x.selector)));
const delEstado = () => $('#guia-abrir');
function cerrarTooltip(){
  tooltip?.remove(); tooltip=null;
}
function cerrarPanel(){
  panel?.remove(); panel=null;
}
function quitarMarcas(){
  $$('.guia-mini').forEach(x=>x.remove());
  $('[data-guia-activa]').forEach(e=>{
    if(e.dataset.guiaTituloGenerado==='1')e.removeAttribute('title');
    e.removeAttribute('data-guia-activa');e.removeAttribute('data-guia-titulo-generado');
  });
  $('[data-guia-nav]').forEach(e=>{
    if(e.dataset.guiaTituloOriginal==='__ausente__')e.removeAttribute('title');
    else e.title=e.dataset.guiaTituloOriginal||'';
    e.removeAttribute('data-guia-nav');e.removeAttribute('data-guia-titulo-original');
  });
}
function desactivar(){
  bienvenidaLista=false;
  cerrarTooltip(); cerrarPanel(); quitarMarcas(); cerrarBienvenida();
  terminarRecorrido(false,false);
  if(delEstado())delEstado().hidden=true;
}
function cerrarBienvenida(){
  bienvenida?.remove(); bienvenida=null;
}

export async function actualizarAyudas(){
  try { estado=await get('/ayudas/estado'); }
  catch { estado={habilitado:false,mini_ayudas:false,bienvenida:false,recorrido_visto:true}; }
  if(!estado.habilitado){desactivar();return estado;}
  if(delEstado())delEstado().hidden=false;
  programarDecoracion();
  if(estado.bienvenida && !estado.recorrido_visto && !bienvenidaLista){
    bienvenidaLista=true;
    setTimeout(()=>{if(estado.bienvenida && !estado.recorrido_visto)crearBienvenida();},2100);
  }else if(!estado.bienvenida || estado.recorrido_visto)cerrarBienvenida();
  return estado;
}
export async function iniciarAyudas(){
  if(!iniciada){
    iniciada=true;
    delEstado()?.addEventListener('click',abrirPanel);
    document.addEventListener('click',e=>{
      const b=e.target.closest('[data-guia-indice]');
      if(b){e.preventDefault();e.stopPropagation();const item=itemsActuales()[Number(b.dataset.guiaIndice)];if(item)abrirTooltip(item,b);return;}
      if(tooltip && !tooltip.contains(e.target))cerrarTooltip();
    },true);
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'){
        if(recorrido)terminarRecorrido(false,true);
        else if(panel)cerrarPanel();
        else cerrarTooltip();
      }
      if((e.key==='Enter'||e.key===' ') && e.target.matches('.guia-mini')){
        e.preventDefault(); e.target.click();
      }
    });
    const contenedores=['#view','#nav','#modals'];
    observar=new MutationObserver(()=>programarDecoracion());
    contenedores.forEach(sel=>{const el=$(sel);if(el)observar.observe(el,{childList:true,subtree:true});});
    window.addEventListener('impar:salir', cerrarAyudas);
    window.addEventListener('resize',()=>{cerrarTooltip();situarRecorrido();},{passive:true});
    document.addEventListener('scroll',()=>{cerrarTooltip();situarRecorrido();},true);
  }
  return actualizarAyudas();
}

export function ayudasCambioDeVista(){
  cerrarTooltip(); cerrarPanel();
  if(recorrido) terminarRecorrido(false,false);
  programarDecoracion();
}

function programarDecoracion(){
  if(programado || !iniciada || !estado.habilitado)return;
  programado=true;
  requestAnimationFrame(()=>{
    programado=false;decorar();
    if(bienvenidaLista && estado.bienvenida && !estado.recorrido_visto && !bienvenida)crearBienvenida();
  });
}
function decorar(){
  if(!estado.habilitado)return;
  $$('[data-nav]').forEach(b=>{
    const t=NAVEGACION[b.dataset.nav];
    if(t){
      if(!b.dataset.guiaNav)b.dataset.guiaTituloOriginal=b.hasAttribute('title')?b.title:'__ausente__';
      b.title=t;b.dataset.guiaNav='1';
    }
  });
  if(!estado.mini_ayudas){quitarMarcas();return;}
  const items=itemsActuales();
  items.forEach((item,index)=>{
    let targets=[];
    try{targets=[...document.querySelectorAll(item.selector)];}catch{return;}
    targets.forEach((el,n)=>{
      if(!visible(el))return;
      if(el.dataset.guiaActiva)return;
      el.dataset.guiaActiva='1';
      if(!el.title){el.title=item.descripcion;el.dataset.guiaTituloGenerado='1';}
      // Las ayudas de filas/columnas repetidas se encuentran en el centro de ayuda
      // y no se repiten decenas de veces en pantalla.
      if(n>0 || targets.length>8 && n>0)return;
      if(el.closest('#nav'))return;
      const icon=document.createElement('span');
      icon.className='guia-mini';icon.setAttribute('role','button');icon.tabIndex=0;
      icon.setAttribute('aria-label','Explicar: '+item.titulo);
      icon.dataset.guiaIndice=String(index);
      icon.textContent='?';
      const field=el.closest('.field'), label=field?.querySelector('label');
      if(label && !el.matches('label')){
        label.append(' ',icon);
      }else if(el.matches('.kpi,.pr-task,.org-rama,.ci-side,.ci-main,.pr-stats,.org-direccion,.pr-reply,.pr-upload,.cal-d,.card[data-id]')){
        el.classList.add('guia-relativa'); el.appendChild(icon); icon.classList.add('guia-mini-esquina');
      }else if(el.matches('.col-h')){
        el.appendChild(icon);
      }else{
        el.insertAdjacentElement('afterend',icon);
      }
    });
  });
}
function abrirTooltip(item,ancla){
  if(!estado.habilitado)return;
  cerrarTooltip(); cerrarPanel();
  const el=document.createElement('div');el.className='guia-tooltip';el.setAttribute('role','dialog');
  el.innerHTML='<div class="guia-pop-head"><span class="guia-icono">i</span><strong>'+esc(item.titulo)+
    '</strong><button type="button" class="guia-x" aria-label="Cerrar">×</button></div>'+
    '<p>'+esc(item.descripcion)+'</p>'+(item.consejo?'<small>Consejo: '+esc(item.consejo)+'</small>':'')+
    '<button class="guia-boton-texto" type="button">Ver otras ayudas →</button>';
  document.body.appendChild(el); tooltip=el;
  el.querySelector('.guia-x').onclick=cerrarTooltip;
  el.querySelector('.guia-boton-texto').onclick=abrirPanel;
  const box=ancla.getBoundingClientRect(), w=Math.min(330,window.innerWidth-20);
  el.style.width=w+'px';
  const left=Math.max(10,Math.min(window.innerWidth-w-10,box.left));
  const alto=el.getBoundingClientRect().height;
  const top=box.bottom+10+alto>window.innerHeight ? Math.max(10,box.top-alto-10) : box.bottom+10;
  el.style.left=left+'px';el.style.top=top+'px';
}
function abrirPanel(){
  if(!estado.habilitado)return;
  cerrarTooltip(); cerrarPanel();
  const actual=GUIAS[S.vista]||GUIAS.neg;
  const root=document.createElement('section');root.className='guia-panel';root.setAttribute('role','dialog');root.setAttribute('aria-label','Ayuda de IMPAR');
  root.innerHTML='<div class="guia-panel-cab"><div class="guia-panel-brand">IMPAR · GUÍA INTERACTIVA</div>'+
    '<button class="guia-x" id="guia-panel-cerrar" aria-label="Cerrar">×</button></div>'+
    '<div class="guia-panel-scroll"><h2>¿Qué querés aprender?</h2><p class="guia-panel-sub">Elegí una explicación o seguí el recorrido de esta pantalla.</p>'+
    '<div class="guia-pagina"><b>'+esc(actual.titulo)+'</b><p>'+esc(actual.descripcion)+'</p>'+
    '<div class="guia-primer">Primer paso · '+esc(actual.primer)+'</div></div>'+
    '<button class="btn guia-tour-iniciar" id="guia-recorrido">▶ Recorrer esta pantalla</button>'+
    '<h3>Elementos de esta pantalla</h3>'+
    listaActual().map(item=>'<button class="guia-fila" data-guia-lista="'+esc(item.selector)+'">'+
      '<span class="guia-item-ico">?</span><span><b>'+esc(item.titulo)+'</b><small>'+esc(item.descripcion)+'</small></span><span>›</span></button>').join('')+
    '<p class="guia-pie">Podés volver a abrir esta guía desde el botón Ayuda. No modifica ninguna negociación ni envía mensajes.</p>'+
    '</div>';
  document.body.appendChild(root);panel=root;
  root.querySelector('#guia-panel-cerrar').onclick=cerrarPanel;
  root.querySelector('#guia-recorrido').onclick=()=>abrirRecorrido();
  $$('[data-guia-lista]',root).forEach(b=>b.onclick=()=>{
    const item=itemsActuales().find(x=>x.selector===b.dataset.guiaLista);
    if(!item)return;
    const target=document.querySelector(item.selector);
    if(!target)return;
    cerrarPanel();
    target.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
    setTimeout(()=>abrirTooltip(item,target),250);
  });
}
function crearBienvenida(){
  if(!bienvenidaLista || bienvenida || !estado.habilitado || !$('#app') || $('#app').classList.contains('hidden') || $('#modals .mask'))return;
  bienvenida=document.createElement('div');bienvenida.className='guia-bienvenida';
  bienvenida.innerHTML='<span class="guia-bienvenida-ico">✦</span><div><b>¿Primera vez en IMPAR?</b>'+
    '<p>Te mostramos para qué sirve cada sector, sin interrumpir tu trabajo.</p>'+
    '<div><button class="btn sm" id="guia-empezar">Conocer el CRM</button>'+
    '<button class="btn ghost sm" id="guia-despues">Ahora no</button></div></div>';
  document.body.appendChild(bienvenida);
  bienvenida.querySelector('#guia-empezar').onclick=async()=>{await marcarVisto();cerrarBienvenida();abrirRecorrido();};
  bienvenida.querySelector('#guia-despues').onclick=async()=>{await marcarVisto();cerrarBienvenida();};
}
async function marcarVisto(){
  if(!estado.habilitado || estado.recorrido_visto)return;
  try {await patch('/ayudas/recorrido',{visto:true});estado.recorrido_visto=true;}catch{}
}
export function abrirRecorrido(previsualizar=false){
  if(!estado.habilitado && !previsualizar)return;
  cerrarPanel();cerrarTooltip();cerrarBienvenida();
  const items=itemsActuales().filter(x=>visible(document.querySelector(x.selector)));
  const inicio=[
    {selector:esMovil()?'#btn-burger':'#nav',titulo:'Tu menú de trabajo',descripcion:'Estas son las secciones a las que tu usuario puede acceder.'},
    {selector:'#v-title',titulo:'¿Dónde estás?',descripcion:'Este título te indica el sector del CRM que tenés abierto.'},
    {selector:'#disp-pill',titulo:'Tu disponibilidad',descripcion:'Revisá tu estado de atención antes de comenzar a trabajar.'},
    ...items.filter(x=>!COMUNES.some(c=>c[0]===x.selector)).slice(0,4),
    {selector:'#guia-abrir',titulo:'Tu guía siempre disponible',descripcion:'Volvé a abrir Ayuda cuando quieras aprender una función.'}
  ];
  const pasos=inicio.filter(x=>visible(document.querySelector(x.selector)));
  if(!pasos.length)return;
  recorrido={pasos,indice:0,previsualizar};
  fondo=document.createElement('div');fondo.className='guia-fondo';fondo.setAttribute('aria-hidden','true');
  fondo.addEventListener('click',()=>terminarRecorrido(false,true));
  marco=document.createElement('div');marco.className='guia-marco';marco.setAttribute('aria-hidden','true');
  tarjeta=document.createElement('div');tarjeta.className='guia-recorrido';tarjeta.setAttribute('role','dialog');
  tarjeta.setAttribute('aria-modal','true');
  document.body.append(fondo,marco,tarjeta);
  pintarRecorrido();
}
function pintarRecorrido(){
  if(!recorrido || !tarjeta)return;
  const i=recorrido.indice,p=recorrido.pasos[i];
  tarjeta.innerHTML='<div class="guia-recorrido-sobre">IMPAR · PASO '+(i+1)+' DE '+recorrido.pasos.length+'</div>'+
    '<h3>'+esc(p.titulo)+'</h3><p>'+esc(p.descripcion)+'</p>'+
    (p.consejo?'<div class="guia-recorrido-consejo">💡 '+esc(p.consejo)+'</div>':'')+
    '<div class="guia-recorrido-puntos">'+recorrido.pasos.map((x,k)=>'<i class="'+(k===i?'activo':'')+'"></i>').join('')+'</div>'+
    '<div class="guia-recorrido-controles"><button type="button" class="btn ghost sm" id="guia-saltar">Salir</button>'+
    (i>0?'<button type="button" class="btn ghost sm" id="guia-atras">Anterior</button>':'')+
    '<button type="button" class="btn sm" id="guia-siguiente">'+(i===recorrido.pasos.length-1?'Terminar':'Siguiente →')+'</button></div>';
  tarjeta.querySelector('#guia-saltar').onclick=()=>terminarRecorrido(true,true);
  if(i>0)tarjeta.querySelector('#guia-atras').onclick=()=>{recorrido.indice--;pintarRecorrido();};
  tarjeta.querySelector('#guia-siguiente').onclick=()=>{
    if(recorrido.indice>=recorrido.pasos.length-1)terminarRecorrido(true,true);
    else {recorrido.indice++;pintarRecorrido();}
  };
  situarRecorrido();
  tarjeta.querySelector('#guia-siguiente')?.focus({preventScroll:true});
}
function situarRecorrido(){
  if(!recorrido || !tarjeta || !marco)return;
  const p=recorrido.pasos[recorrido.indice],el=document.querySelector(p.selector);
  if(!visible(el)){marco.style.display='none';tarjeta.style.left='max(12px,calc(50vw - 155px))';tarjeta.style.top='35vh';return;}
  const r=el.getBoundingClientRect();
  marco.style.display='block';
  marco.style.left=Math.max(3,r.left-4)+'px';
  marco.style.top=Math.max(3,r.top-4)+'px';
  marco.style.width=Math.min(window.innerWidth-6,r.width+8)+'px';
  marco.style.height=Math.min(window.innerHeight-6,r.height+8)+'px';
  const w=Math.min(340,window.innerWidth-24),h=tarjeta.getBoundingClientRect().height;
  const top=r.bottom+16+h>window.innerHeight-12?Math.max(12,r.top-h-16):r.bottom+16;
  tarjeta.style.left=Math.max(12,Math.min(window.innerWidth-w-12,r.left))+'px';
  tarjeta.style.top=Math.max(12,Math.min(window.innerHeight-h-12,top))+'px';
  tarjeta.style.width=w+'px';
}
function terminarRecorrido(completado,guardar){
  if(!recorrido)return;
  const preview=recorrido.previsualizar;
  recorrido=null;marco?.remove();tarjeta?.remove();fondo?.remove();marco=null;tarjeta=null;fondo=null;
  if(guardar && !preview)marcarVisto();
  if(completado)toast('¡Bien! Podés volver a la guía cuando la necesites.');
}
export function cerrarAyudas(){
  desactivar();estado={habilitado:false,mini_ayudas:false,bienvenida:false,recorrido_visto:true};
}
