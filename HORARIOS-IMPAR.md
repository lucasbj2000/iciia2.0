# IMPAR — Sesión estable y control de horarios (Protocolo 002)

## Cambios de sesión
- La pantalla de login queda oculta mientras se valida una sesión que ya existe. El empleado ve una pantalla discreta «Restableciendo tu sesión».
- Ante fallas temporales de red o de la base de datos, la pantalla ofrece **Reintentar conexión** y **Cambiar usuario**; no elimina el token automáticamente.
- El JWT dura **al menos 8 horas** desde su emisión. Si la variable JWT_EXPIRA ya define una duración mayor, se respeta.
- Mientras el usuario utiliza el sistema, el token se renueva antes de caducar y se vuelve a conectar el canal de eventos SSE.
- La renovación no se prolonga indefinidamente para una pestaña abandonada: se suspende si no hay actividad de la persona durante 30 minutos. Una sesión realmente caducada o inválida sí requiere volver a identificarse.
- Los tokens creados antes de actualizar pueden conservar su vencimiento anterior. Una vez realizado un nuevo login, se aplica la duración actualizada.

## Horarios
**Administración → Horarios laborales**

1. Elegir «Toda IMPAR» para definir horarios de entrada y salida por día de la semana.
2. Marcar cuáles días son laborables. Los valores iniciales son lunes a viernes, 08:00–17:00; el administrador debe ajustarlos a la jornada real.
3. Seleccionar un agente en «Editar horario de» para definir excepciones (Personalizado) día por día. Si no existe una excepción, se aplica el horario general.
4. Guardar todos los horarios.
5. Consultar «Salidas de hoy» para ver quién confirmó salir normalmente, quién se queda y hasta qué hora.

El sistema utiliza la zona horaria **America/Asuncion**. En esta versión los horarios de cada jornada deben comenzar y terminar **el mismo día**.

## Avisos a agentes
- Si el agente tiene su sesión y el CRM está visible, durante los diez minutos previos a su hora de salida aparece una tarjeta discreta.
- «Salgo a las HH:MM» confirma la salida normal.
- «Me quedaré más tiempo» permite elegir la nueva hora final de la jornada.
- «Recordarme en 2 minutos» pospone temporalmente la pregunta, sin registrar una respuesta.
- Al extender el horario, vuelve a avisar diez minutos antes de la hora extraordinaria para confirmar el final de la jornada o extenderlo nuevamente.
- Solo se registra la **previsión de salida**. No marca disponibilidad fuera de horario automáticamente, no cierra la sesión y no envía mensajes a los clientes.
- Al cerrar o suspender la aplicación, las notificaciones dentro de la página no sustituyen alarmas del sistema operativo.

## Migración
`src/migrations/012_horarios_y_salidas.sql` crea:
- `horarios_empresa`
- `horarios_agentes`
- `horarios_respuestas`

La migración es aditiva; no borra clientes, agentes, negociaciones, mensajes ni sesiones de WhatsApp.

## Verificación después del despliegue
1. Ejecutar el respaldo y el script habitual de actualización.
2. Confirmar que `/api/health` responde con el nuevo build y que PM2 está online.
3. Abrir CRM con un usuario que ya tiene sesión; el login no debe aparecer antes de cargar el contenido.
4. Comprobar que una reconexión momentánea no borra la sesión.
5. Acceder como administrador a «Horarios laborales», ajustar el horario real y guardar.
6. Configurar una salida de prueba para un agente dentro de los próximos diez minutos. Abrir su sesión y comprobar el aviso.
7. Confirmar horario normal. Verificar en el panel de administrador.
8. Probar extensión (por ejemplo, +30 minutos) y revisar que aparezca la nueva salida en el panel.
9. Confirmar que el usuario puede seguir enviando y recibiendo mensajes durante su jornada.

## Reversión
Mantener el respaldo realizado antes del despliegue. En caso de incidencia guardar los logs y volver al commit anterior estable mediante el procedimiento del Protocolo 002. Las nuevas tablas no requieren borrarse para volver a ejecutar código anterior. **No** ejecutar `scripts/preparar-impar.sh` ni `scripts/reset-impar.mjs`: son procedimientos de reinicialización que no corresponden a esta actualización.
