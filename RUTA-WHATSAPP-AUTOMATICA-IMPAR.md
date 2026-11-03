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
3. **Reenvía solo, sin intervención humana** (`src/rescate-no-descifrados-impar.mjs`, cada minuto).
   Si el reintento propio de WhatsApp también falla (segundo aviso) o pasan 5 minutos sin que
   el cliente lo lea, el CRM reenvía el mismo mensaje **una vez** por la otra ruta verificada.
   - No reenvía si el cliente lo leyó después del aviso (se descifró).
   - Nunca reenvía un reenvío: no hay rebotes entre rutas.
   - Si todavía no existe otra ruta, espera y lo reenvía solo cuando WhatsApp la informe
     (normalmente cuando el cliente vuelve a escribir), dentro de las 24 h.
   - Si tampoco se puede leer por la otra ruta, avisa a administración una sola vez.
   En la conversación el agente ve «se reenvió automáticamente por la otra ruta»; el botón
   «Reenviar ahora» aparece solo como respaldo cuando no hay otra ruta.
4. **El admin puede fijar la ruta** en la ficha: Automática (recomendada), Siempre por número
   o Siempre por LID. Quien ya tenía LID activado a mano lo conserva como «Siempre por LID».

Si WhatsApp informa un LID nuevo para el mismo número, el contacto vuelve a «Automática».

Base de datos: migraciones `030_wa_ruta_automatica_impar.sql` y `031_wa_rescate_automatico_impar.sql` (aditivas, se aplican solas al iniciar).
En el log de PM2, la línea `[wa:transporte]` suma `no_descifrados_por_cliente=` y aparece
`[wa:ruta] Aviso de mensaje no descifrado por el cliente…` cuando ocurre (sin números ni contenido).

## Verificación después de desplegar
1. Ficha de un cliente de WhatsApp como admin: la línea «Ruta de envío» indica cuál usa y por qué.
2. Con el cliente del caso reportado: dejar «Automática» y enviar un mensaje; debe llegar legible.
3. `pm2 logs` y buscar `[wa:ruta]` (avisos de no descifrado) y `[wa:rescate]` (reenvíos automáticos).
