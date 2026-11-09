/* IMPAR · motivos de Meta cuando no entrega un mensaje de la línea verificada (sin dependencias). */
/** Códigos de error de Meta en palabras para el agente. */
const MOTIVOS = {
  131047: 'pasaron más de 24 h desde el último mensaje del cliente por esta línea (solo se permiten plantillas)',
  131026: 'el número no tiene WhatsApp o no puede recibir mensajes',
  131042: 'falta el método de pago en la cuenta de WhatsApp de Meta',
  131049: 'Meta limitó los mensajes de marketing a este número',
  131050: 'el cliente pidió no recibir mensajes de marketing',
  131051: 'tipo de mensaje no admitido',
  131052: 'no se pudo descargar el archivo',
  131053: 'el archivo no es válido para WhatsApp',
  131056: 'demasiados mensajes seguidos a este número; esperá un momento',
  131021: 'no se puede enviar a este mismo número',
  131031: 'la cuenta de WhatsApp de Meta está bloqueada',
  131000: 'error interno de Meta; volvé a intentar',
  130472: 'Meta no entregó el mensaje por una prueba interna suya',
  470: 'pasaron más de 24 h desde el último mensaje del cliente (solo se permiten plantillas)'
};
export const motivoMeta = codigo => MOTIVOS[Number(codigo)] || (codigo ? `código ${codigo}` : '');
