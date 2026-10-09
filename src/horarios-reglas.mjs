/** Reglas sin efectos secundarios para horario laboral de IMPAR. */
export const ZONA_IMPAR = 'America/Asuncion';
export const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
export const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
export const minutos = h => HORA.test(String(h||'').slice(0,5))
  ? Number(h.slice(0,2))*60+Number(h.slice(3,5)) : NaN;
export const normalizar = h => String(h||'').slice(0,5);
export function horaValida(entrada,salida) {
  return HORA.test(entrada)&&HORA.test(salida)&&minutos(entrada)<minutos(salida);
}
export function fechaLocal(date=new Date()) {
  const d=new Intl.DateTimeFormat('en-CA',{
    timeZone: ZONA_IMPAR,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(date);
  const p=Object.fromEntries(d.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const fecha=`${p.year}-${p.month}-${p.day}`;
  return {fecha,hora:`${p.hour}:${p.minute}`,
    dia:new Date(`${fecha}T12:00:00Z`).getUTCDay()};
}
export function calcularAviso({activo,salida,hora,decision,hasta,confirmado_para}) {
  if(!activo || !HORA.test(normalizar(salida)) || !HORA.test(normalizar(hora))) {
    return {mostrar:false,objetivo:null,faltan:null};
  }
  const objetivo=decision==='extra' && HORA.test(normalizar(hasta))?normalizar(hasta):normalizar(salida);
  const faltan=minutos(objetivo)-minutos(hora);
  return {mostrar:faltan>=0 && faltan<=10 && normalizar(confirmado_para)!==objetivo,
    objetivo,faltan};
}
