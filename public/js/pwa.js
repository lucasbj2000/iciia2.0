import { $, S, modal, cerrar, toast } from './core.js';
let invitacion=null,registro=null;
const instalada=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;
export function iniciarPWA(abrirNegociacion){
  const boton=$('#btn-install-app');
  if(boton){boton.hidden=false;boton.onclick=mostrarOpciones;}
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();invitacion=e;if(boton)boton.hidden=false;});
  window.addEventListener('appinstalled',()=>{invitacion=null;if(boton)boton.hidden=false;toast('IMPAR se instaló en este dispositivo.','ok');});
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(r=>{registro=r;return r.update();}).catch(()=>{});
    navigator.serviceWorker.addEventListener('message',e=>{if(S.token&&e.data?.tipo==='abrir-negociacion'&&/^[0-9a-f-]{36}$/i.test(e.data.ref))abrirNegociacion(e.data.ref);});
  }
}
function mostrarOpciones(){
  const habilitadas=localStorage.getItem('impar_avisos')==='1'&&'Notification' in window&&Notification.permission==='granted';
  modal(`<div class="mh"><h2>IMPAR en tu dispositivo</h2><button class="x" id="pwa-cerrar">✕</button></div><div class="mb"><p>Instalá el CRM para abrirlo desde el escritorio o la pantalla de inicio.</p>${instalada()?'<p>La aplicación ya está abierta en modo instalado.</p>':invitacion?'<button class="btn" id="pwa-instalar">Instalar IMPAR</button>':'<p>En el menú del navegador, elegí <b>Instalar aplicación</b> o <b>Agregar a pantalla de inicio</b>. En iPhone o iPad, usá el botón Compartir de Safari.</p>'}<h3>Avisos en este dispositivo</h3><p>Podés recibir avisos mientras el CRM permanezca conectado, aunque esté en segundo plano. Con la aplicación cerrada no se reciben avisos. La disponibilidad depende del navegador y sus permisos.</p><button class="btn ghost" id="pwa-avisos">${habilitadas?'Desactivar avisos':'Activar avisos'}</button><p id="pwa-estado" role="status"></p></div>`);
  $('#pwa-cerrar').onclick=cerrar;
  const instalar=$('#pwa-instalar');
  if(instalar)instalar.onclick=async()=>{const actual=invitacion;if(!actual)return;instalar.disabled=true;try{await actual.prompt();const resultado=await actual.userChoice;invitacion=null;if(resultado.outcome==='accepted')cerrar();else mostrarOpciones();}catch{instalar.disabled=false;$('#pwa-estado').textContent='Usá el menú del navegador para instalar IMPAR.';}};
  $('#pwa-avisos').onclick=async()=>{
    const estado=$('#pwa-estado');
    if(habilitadas){localStorage.setItem('impar_avisos','0');mostrarOpciones();return;}
    if(!('Notification' in window)){estado.textContent='Este navegador no ofrece avisos. Probá desde la aplicación instalada.';return;}
    try{const permiso=await Notification.requestPermission();if(permiso==='granted'){localStorage.setItem('impar_avisos','1');mostrarOpciones();}else{localStorage.setItem('impar_avisos','0');estado.textContent='Avisos no habilitados. Podés revisar los permisos del sitio en el navegador.';}}catch{estado.textContent='No se pudo habilitar los avisos en este dispositivo.';}
  };
}
export async function notificarApp(n){
  if(!S.token||!document.hidden||localStorage.getItem('impar_avisos')!=='1'||!('Notification' in window)||Notification.permission!=='granted')return;
  const opciones={body:n.msg||'',icon:'/assets/impar-app-192.png',tag:n.id?String(n.id):undefined,data:{ref:n.ref||null}};
  try{if(registro)await registro.showNotification(n.titulo||'IMPAR',opciones);else new Notification(n.titulo||'IMPAR',opciones);}catch{ /* El aviso dentro del CRM continúa disponible. */ }
}
