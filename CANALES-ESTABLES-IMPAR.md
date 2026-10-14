# IMPAR · Estabilidad de Administración/Canales (14/10/2026)

## Síntoma observado
Video reportado: al abrir Administración → Canales la vista vuelve a mostrar los esqueletos de carga varias veces, mientras llegan notificaciones emergentes repetidas «WhatsApp desconectado».

## Hallazgos y medidas correctivas
- La llegada de cada evento SSE `canal:estado` llamaba a `render()` sin importar qué pestaña de Administración estuviera abierta. Ahora actualiza solo el indicador del canal mediante `actualizarEstadoCanal` y no destruye formularios, desplazamiento ni pestañas.
- Los mensajes de conectividad se mostraban como toast en cada cambio. Se suprimen esos toasts repetitivos y las notificaciones del tipo `canal` solo quedan en el centro de avisos.
- La pantalla Canales esperaba en bloque tres peticiones. Se redujo a la petición principal por sucursales; metadatos de Webhook se consultan por separado y no son condición para el listado.
- Si el API de Canales no responde tras nueve segundos se muestra un mensaje con botón «Reintentar carga», en lugar de un skeleton infinito.
- Los resultados de peticiones antiguas se descartan al cambiar de pestaña.
- Baileys antes podía recibir otro intento del monitor mientras un temporizador de reconexión seguía pendiente; ahora cada canal administra su propio temporizador, evita sockets paralelos y descarta eventos de sockets sustituidos.
- Credenciales de WhatsApp se guardan únicamente desde el socket actualmente vigente; un evento QR atrasado no sustituye la condición de conectado.
- Al pedir una desvinculación explícita se cancelan temporizadores y se desactiva el socket; la actualización ordinaria no borra credenciales ni exige volver a escanear.
- Una interrupción temporal se muestra como «Reconectando…». Si la aplicación indica una desvinculación real de WhatsApp, verificar el canal y la sesión en el teléfono.

## Verificaciones
- El CI ejecuta `scripts/verificar.mjs`, `scripts/test-canales-estables.mjs` y las regresiones preexistentes.
- La actualización Hostinger (`scripts/actualizar.sh`) también ejecuta la suite antes de reiniciar.
- No es una prueba contra la sesión real de WhatsApp del VPS, cuya conectividad puede verse afectada por red, WhatsApp/Baileys o sesión revocada.

## Validación después del despliegue
1. Esperar que el actualizador complete salud y login.
2. Refrescar `https://crm.iciia.tech/` e ingresar a Administración → Canales.
3. Observar 1–2 minutos: el panel no debe desaparecer/reconstruirse al variar el estado de conexión.
4. Revisar «Actualizar estados» cuando se desee consultar manualmente.
5. Si un canal sigue en «Reconectando…» o pasa a «Desconectado», revisar PM2, red y vinculación real, sin desvincularlo ni eliminar auth por prueba:
   `pm2 status`
   `pm2 logs iciia-crm --lines 100 --nostream`
6. No enviar al chat credenciales, tokens, archivos auth ni mensajes privados contenidos en logs.

## Límites
El cambio evita recargas y notificaciones excesivas, y corrige carreras conocidas de reconexión. No puede garantizar que WhatsApp permanezca conectado ante cortes reales de red, revocaciones de sesión o restricciones del proveedor. No se tocaron las instancias de NOVA ni se borraron datos de IMPAR.
