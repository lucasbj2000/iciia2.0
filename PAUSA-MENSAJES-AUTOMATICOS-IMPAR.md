# IMPAR · Pausa temporal de respuestas automáticas (14/10/2026)

## Motivo
Los clientes de IMPAR ya estaban siendo atendidos desde un CRM anterior. Durante la transición, IMPAR no debe enviar saludos nuevos, pedir nombre/ciudad ni responder automáticamente con IA o bot de recepción.

## Qué cambia
- La migración `013_pausar_automensajes_impar.sql` desactiva `empresas.flags.bot` y `empresas.bot.activo` exclusivamente en la empresa `impar`.
- Todas las negociaciones existentes pasan a `bot_activo=FALSE` y **se mantienen manuales aun si después se reanuda el bot global**.
- Las respuestas automáticas ya encoladas se identifican por mensaje bot, negociación, texto y hora. Se marcan **canceladas**, no se envían después.
- Los mensajes generados por el bot se etiquetan en `outbox.automatico`. El worker comprueba la configuración real de la empresa antes de despachar cada respuesta automática.
- Si el bot estaba consultando OpenAI, verifica otra vez la pausa antes de insertar su respuesta.
- El botón de bot de una negociación no puede reactivarse si la empresa mantiene la pausa.
- Las respuestas manuales, mensajes entrantes, archivos, clientes, negociaciones, números WhatsApp, agentes, historial y el reparto automático de nuevos contactos permanecen disponibles.

## Cómo reactivar más adelante
1. Abrir **Administración → Bot**.
2. Seleccionar **Activar respuestas automáticas** y confirmar.
3. Solo los **contactos nuevos** tendrán el bot habilitado. Las conversaciones existentes quedan manuales.
4. Si la empresa lo desea más adelante, usar **Reactivar bot en conversaciones existentes**, con confirmación expresa.

El botón **Guardar instrucciones** no habilita ni deshabilita el bot. El interruptor general en Funciones ON/OFF no sustituye el botón de activación global del área Bot.

## Despliegue sin pérdida de datos
Usar el Protocolo 002 de IMPAR desde /opt/iciia-crm, con respaldo y commit exacto. La migración es aditiva: no elimina datos, sesiones ni credenciales. **No ejecutar** preparar-impar.sh ni reset-impar.mjs.

## Verificación
1. Actualizar desde GitHub y comprobar el estado del proceso y /api/health.
2. En Administración → Bot ver estado **Automatización pausada · atención manual**.
3. Enviar un mensaje de prueba desde un número controlado: debe ingresar al CRM y **no** recibir contestación automática.
4. Responder manualmente desde un agente: el cliente debe recibir únicamente el mensaje redactado.
5. Confirmar que los envíos automáticos pendientes anteriores aparecen cancelados, no se reenvían.
6. Confirmar que las negociaciones ya abiertas no fueron duplicadas ni modificadas en su responsable.
7. No reactivar el bot hasta decidir el nuevo flujo de atención.

**Importante:** cambiar archivos en GitHub no aplica la pausa instantáneamente en el VPS. Hasta que se despliegue (o se cambien manualmente los flags en la base), las respuestas del código anterior siguen siendo posibles. La prueba automatizada no sustituye una verificación real en el VPS.
