# IMPAR · corrección de recepción WhatsApp · Protocolo 002

Síntoma reportado: el cliente recibe lo enviado desde CRM, pero sus respuestas
llegan al teléfono principal y no se registran en `inbox`. Liberar el buffer de
eventos no resolvió el incidente. La recuperación en producción queda pendiente
de despliegue y prueba con un agente y un teléfono real.

## Errores reproducidos

1. El adaptador `wa-cache-reintentos.mjs` devolvía promesas; Baileys 6.7.24 lee
   `msgRetryCache.get()` sin `await`. El contador se convertía en
   `[object Promise]1`, se omitía solicitar el original al teléfono y las
   comparaciones de límite de recuperación no funcionaban. Ahora la caché es
   síncrona, con la misma capacidad y caducidad.
2. La cola offline de Baileys dejaba `isProcessing=true` si un procesador
   rechazaba. El parche de recepción aísla cada error y libera la bandera en
   `finally`. Los demás nodos continúan en orden. No se envía un ACK adicional
   ni se marca como recibido el nodo que falló.

Estos errores están probados en el código utilizado, pero los datos aportados
no permiten atribuirles por sí solos la totalidad del corte actual. Se agregan
contadores del transporte antes del descifrado para distinguir falta de nodos,
mensajes no disponibles, tipo msmsg y errores de cola. Sólo se imprimen cifras.

## Verificación

- `node scripts/verificar.mjs`
- `node scripts/test-wa-reintentos.mjs`
- `node scripts/test-baileys-recepcion-instalado.mjs` (requiere `npm ci`)
- Pruebas existentes de buffer, LID, canales y estados de entrega.
- CI ejecuta el parche dos veces y las funciones extraídas del paquete instalado
  con transporte simulado. Comprueba recuperación 1→2, solicitud al teléfono,
  límites y continuación de clientes después de una notificación fallida.
- El test instalado también se ejecuta desde `test-wa-reintentos.mjs` en el VPS,
  por lo que el actualizador anterior lo incluye antes de reiniciar PM2.

## Despliegue y comprobación operativa

Usar `bash scripts/actualizar.sh` desde `/opt/iciia-crm`, con el SHA aprobado de
`main` en `IMPAR_OBJETIVO_SHA`. El actualizador respalda antes de modificar y
verifica dependencias, migraciones existentes, una instancia PM2 y publicación.
Esta corrección no añade migraciones ni modifica credenciales o chats.

Después, un cliente debe iniciar una conversación, recibir la respuesta del
agente y responder otra vez; comprobar ambas entradas en CRM. Probar también
una conversación existente. No declarar restablecida la recepción únicamente
porque `/api/health` esté correcto.

Si el flujo falla, consultar las líneas `[wa:recepcion]` y `[wa:transporte]`
filtradas a sus campos numéricos. No compartir logs completos, claves ni chats.
Los contadores de transporte se reinician con cada socket; los contadores de
recepción duran mientras exista el estado del canal dentro del proceso.

## Reversión

El actualizador conserva su reversión automática de código/dependencias ante
fallos de instalación o salud. Ante una regresión funcional, revertir en GitHub
el commit de esta corrección y desplegar esa nueva revisión con el mismo
actualizador. No restaurar PostgreSQL ni borrar `auth/`. La versión anterior
`c95fbf8b4e5e` también tenía recepción fallida, por lo que volver a ella no
constituye una solución al incidente. Los mensajes que WhatsApp no reentregue
no pueden considerarse recuperados sin evidencia en `inbox` y la conversación.
