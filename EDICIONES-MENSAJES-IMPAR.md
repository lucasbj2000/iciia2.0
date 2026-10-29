# IMPAR · Mensajes editados por clientes · Protocolo 002

## Comportamiento

- Cuando un cliente edita un mensaje en WhatsApp, la conversación del CRM muestra el texto nuevo
  con la marca «✎ Editado» (y cuántas veces). Al tocarla se ve el texto anterior original.
- Una edición atrasada nunca reemplaza a una más nueva (se compara la hora de cada edición).
- Si el mensaje todavía estaba en cola, se corrige antes de entrar a la conversación.
- Si el original nunca llegó (por ejemplo, no se pudo descifrar), se registra la versión editada,
  solo si ese mensaje no existe ya en una conversación (nunca duplica).
- La edición se toma de `messages.update` y también del `protocolMessage` que llega por
  `messages.upsert` (cuando Baileys retiene eventos en su buffer no siempre emite el update).
  Se aplica una sola vez gracias a la hora de la edición.
- Se ignoran ediciones propias, de grupos y de estados. Las ediciones de nuestros mensajes desde el
  teléfono principal no modifican el CRM.
- Alcance: WhatsApp QR (Baileys). WhatsApp Cloud API no está incluido en este cambio.

## Archivos

- `src/migrations/027_mensajes_editados_impar.sql`: columna aditiva `mensajes.editado`.
- `src/channels/baileys.mjs`: `messages.update` con `editedMessage` → `recibirEdicion`; contador `ediciones=`.
- `src/worker.mjs`, `src/core.mjs`: la edición en cola llega a la conversación con su marca.
- `public/js/ficha.js`, `public/citas.css`: marca «✎ Editado» y texto anterior.
- `scripts/test-ediciones-impar.mjs`: en `actualizar.sh` y CI.

## Despliegue y verificación

`cd /opt/iciia-crm && bash scripts/actualizar.sh` y recargar el CRM con Ctrl+F5.
Desde un teléfono de prueba, enviar un mensaje, editarlo en WhatsApp y comprobar en el CRM el texto
nuevo, la marca «✎ Editado» y el texto anterior.

## Reversión

Revertir el commit y desplegar con el actualizador. La columna `editado` puede permanecer.
