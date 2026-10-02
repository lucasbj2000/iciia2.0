# Mensajes visibles al pulsar Enviar

En la conversación de negociación, Enviar inserta inmediatamente la burbuja de texto/adjunto con estado «enviando», antes de esperar la red. El borrador siguiente sigue disponible y el chat no se reconstruye. Mostrar la burbuja pendiente no significa que WhatsApp haya entregado el mensaje.

El endpoint de envío devuelve el registro guardado y su ID. El evento de actualización correlaciona ese ID con el mensaje local antes de consultar el chat. La confirmación sustituye la burbuja temporal, y una actualización atrasada no la borra. Si la confirmación por evento llega antes que la respuesta HTTP, se conserva el registro real y su estado más reciente. No se compara por texto, de modo que enviar dos textos iguales intencionalmente sigue mostrando dos mensajes distintos.

Si el envío falla antes de confirmarse, se retira la burbuja temporal y se recupera el texto; si el servidor ya lo confirmó por evento, no se restaura ese mismo texto como mensaje fallido. Se mantiene el bloqueo del doble clic, Enter multilínea, el scroll al leer arriba y la vista móvil estable.

No requiere migración, no toca credenciales ni sesiones y conserva los reintentos del worker. Validación: verificador oficial y pruebas aisladas con el POST detenido artificialmente: burbuja visible antes de resolver la solicitud, evento temprano, snapshot atrasado, confirmación por ID sin duplicados y retirada/restauración ante fallo.

Verificación en producción: recargar navegador y enviar un mensaje autorizado. Debe aparecer en el mismo clic como enviando y actualizar su estado posteriormente, sin pantalla de carga. Para volver al código anterior, usar el commit `250c90f3b5b0e94b9c94981b24b821cdefe64d65` y reiniciar PM2; no restaurar ni borrar datos.
