# Chat estable y multilínea · IMPAR

Enviar en la conversación del cliente y en comunicación interna actualiza únicamente los mensajes. Mantiene los nodos sin cambios, el borrador del siguiente mensaje y la posición de lectura. Al enviar se sigue el mensaje nuevo; al recibir, solo se baja automáticamente si el agente ya estaba al final. Las respuestas desactualizadas se descartan y no pueden pintar sobre otra conversación. Los eventos de entrega del worker actualizan el estado sin abrir otra vez la ficha.

Los campos de mensaje son textarea: Enter agrega una nueva línea. El envío se realiza con el botón. Se bloquea el doble clic mientras la solicitud está pendiente y se recupera el texto si falla. Un fallo al consultar la conversación después de guardar el mensaje se informa como fallo de actualización, sin decir que el envío fracasó ni inducir otro envío.

En PC la ficha es más ancha y alta y el campo de escritura tiene 96 px de altura. En móvil el CRM tiene un marco fijo y el desplazamiento queda dentro de cada vista. La ficha usa el alto visible del navegador, se adapta al teclado y conserva accesibles las pestañas, mensajes y envío. Los datos y herramientas están en paneles desplegables para dejar espacio a la conversación. El texto se mantiene en 16 px para evitar el zoom automático de los campos. No se bloquea el zoom manual.

No hay migración de base ni cambio de credenciales o sesiones. El worker mantiene el mismo mecanismo de envío y añade un evento al cambiar pendiente a enviado/error.

Validación: verificador oficial; pruebas de DOM aislado para ambos chats con solicitudes asíncronas, múltiples líneas, borrador durante envío, doble clic, error de red, identidad del modal/campo/mensajes y conservación del scroll al leer arriba. Los eventos de viewport se comprueban con cambios de altura. La prueba aislada no sustituye la comprobación del teclado y gestos en dispositivos reales.

Después del despliegue, recargar con Ctrl+F5. Probar un mensaje autorizado de varias líneas: Enter debe insertar un salto y Enviar debe agregarlo sin pantalla de carga. Escribir otro borrador mientras responde la solicitud; debe conservarse. Leer mensajes anteriores mientras llega otro; no debe saltar al final. En móvil abrir la conversación, mostrar/ocultar el teclado y desplazarse por los mensajes y las pestañas: el fondo del CRM debe quedarse fijo.

Reversión de código: commit anterior `0ee2b0c2adc86e6cbcee3154cc9433d7a8af5f15` y reinicio de PM2. Los mensajes existentes siguen siendo compatibles; no restaurar ni borrar la base para revertir la interfaz.
