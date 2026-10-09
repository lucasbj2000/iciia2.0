/* IMPAR · renovación silenciosa de sesiones activas.
   No cierra la sesión por cortes de red ni por un error aislado. */
import { S,post,salir } from './core.js';
let timer=null,enProceso=null;
const expiracion=token=>{
  try{
    const b=token.split('.')[1];
    const pad=b.replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(atob(pad)).exp*1000;
  }catch{return 0;}
};
export async function renovarSesion(reiniciarStream){
  if(!S.token)return false;
  if(enProceso)return enProceso;
  const tokenActual=S.token;
  enProceso=(async()=>{
    try{
      const r=await post('/sesion/renovar',{});
      if(tokenActual!==S.token)return false;
      if(r.token){
        S.token=r.token;
        localStorage.setItem('iciia_token',r.token);
        reiniciarStream?.();
      }
      return true;
    }catch(e){
      // Desconexión temporal, 503 y errores de otras rutas no fuerzan logout.
      if(e.status===401 && tokenActual===S.token){detenerRenovacion();salir();}
      return false;
    }
  })();
  try{return await enProceso;}finally{enProceso=null;}
}
export function iniciarRenovacion(reiniciarStream){
  detenerRenovacion();
  const revisar=async()=>{
    if(!S.token||document.visibilityState==='hidden')return;
    const exp=expiracion(S.token),restante=exp-Date.now();
    // Token con menos de seis horas de validez: renovamos antes del vencimiento.
    if(restante<6*3600000){
      await renovarSesion(reiniciarStream);
    }
  };
  timer=setInterval(revisar,5*60000);
  document.addEventListener('visibilitychange',revisar);
  window.addEventListener('focus',revisar);
  // La renovación inicial cubre cuentas con tokens antiguos cercanos a vencer.
  revisar();
}
export function detenerRenovacion(){
  if(timer)clearInterval(timer);
  timer=null;
}
window.addEventListener('impar:salir',detenerRenovacion);
