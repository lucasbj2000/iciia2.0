# IMPAR · Respuestas citadas · Protocolo 002

## Comportamiento

- **Cliente cita un mensaje:** la conversación muestra arriba de su mensaje el texto citado,
  con «Cliente» o «Nosotros» según quién lo escribió. Al tocar la cita, el chat se desplaza al
  mensaje original y lo resalta; si es anterior a lo cargado, avisa que se carguen los mensajes anteriores.
- **Agente cita un mensaje:** botón ↩ en cada mensaje (visible al pasar el mouse; siempre visible en
  pantallas táctiles). Aparece «Respondiendo a…» sobre el campo de texto; ✕ o Escape lo cancela.
  El mensaje sale por WhatsApp como respuesta citada y el cliente la ve igual que en su teléfono.
- Funciona en WhatsApp QR (Baileys) y WhatsApp Cloud API. Messenger/Instagram muestran la cita solo en el CRM.
- Se puede citar cualquier mensaje del mismo cliente, también de negociaciones anteriores. El servidor
  rechaza citas de otro cliente o de otra empresa.
- Si el mensaje citado no tiene ID de WhatsApp (carga histórica, mensajes muy antiguos), el CRM
  muestra la cita y el envío sale como mensaje normal.

## Archivos

- `src/migrations/026_citas_mensajes_impar.sql`: columnas aditivas `mensajes.cita` y `outbox.cita`.
- `src/citas-impar.mjs`: vincula el ID citado con el mensaje del CRM y valida la cita al enviar.
- `src/channels/baileys.mjs`: lee `contextInfo` al recibir; envía con `quoted`.
- `src/channels/meta.mjs`: lee `context.id` al recibir; envía `context.message_id`.
- `src/worker.mjs`, `src/core.mjs`, `src/routes/negociaciones.mjs`: transporte y guardado de la cita.
- `public/js/ficha.js`, `public/citas.css`, `public/index.html`: visualización y botón Responder.
- `scripts/test-citas-impar.mjs`: prueba en `actualizar.sh` y CI.

## Despliegue y verificación

`cd /opt/iciia-crm && bash scripts/actualizar.sh`. Recargar el CRM con Ctrl+F5.

1. Desde un teléfono de prueba, responder citando un mensaje del agente: la cita aparece en el CRM.
2. En el CRM, tocar ↩ en un mensaje del cliente y enviar: en el teléfono llega como respuesta citada.
3. Tocar una cita: el chat salta al mensaje original.

## Reversión

Revertir el commit y desplegar con el actualizador. Las columnas `cita` pueden permanecer; los
mensajes se muestran sin la cita.
