# Ruta de envío WhatsApp automática (número / LID) — IMPAR (Protocolo 002)

## El problema
WhatsApp está migrando contactos a una identidad interna llamada LID. Cuando un cliente
ya conversa por LID y el CRM le escribe a su número, su teléfono puede no descifrar el
mensaje y lo muestra como **«Esperando mensaje. Esto puede tomar tiempo»**. Hasta ahora
la ruta LID solo se activaba a mano, contacto por contacto, desde la ficha.

## Qué hace ahora el CRM
1. **Responde por la misma vía por la que escribe el cliente.** Cada mensaje entrante
   indica si llegó por número o por LID; la respuesta sale por esa misma identidad
   (siempre que WhatsApp haya confirmado la equivalencia número ↔ LID de ese cliente).
2. **Detecta cuando el cliente no pudo descifrar.** El teléfono del cliente avisa a WhatsApp
   («retry»). El CRM anota ese fallo en la ruta usada y los próximos mensajes salen por la otra.
   Si un mensaje se lee sin avisos, esa ruta queda confirmada. Los fallos de más de 30 días se olvidan.
3. **Avisa en la conversación.** El mensaje afectado muestra «Puede que el cliente vea
   “Esperando mensaje”» con un botón **Reenviar**, que lo envía de nuevo por la ruta corregida
   (una sola vez por mensaje). Nada se reenvía solo, para no duplicar pedidos.
4. **El admin puede fijar la ruta** en la ficha: Automática (recomendada), Siempre por número
   o Siempre por LID. Quien ya tenía LID activado a mano lo conserva como «Siempre por LID».

Si WhatsApp informa un LID nuevo para el mismo número, el contacto vuelve a «Automática».

Base de datos: migración `030_wa_ruta_automatica_impar.sql` (aditiva, se aplica sola al iniciar).
En el log de PM2, la línea `[wa:transporte]` suma `no_descifrados_por_cliente=` y aparece
`[wa:ruta] Aviso de mensaje no descifrado por el cliente…` cuando ocurre (sin números ni contenido).

## Verificación después de desplegar
1. Ficha de un cliente de WhatsApp como admin: la línea «Ruta de envío» indica cuál usa y por qué.
2. Con el cliente del caso reportado: dejar «Automática» y enviar un mensaje; debe llegar legible.
3. `pm2 logs` y buscar `[wa:ruta]`: cada aviso de no descifrado queda registrado.
