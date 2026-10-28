# Pruebas API IMPAR sin alterar la herramienta actual

Protocolo 002. Número +595976992668, Phone Number ID 661580813700225,
WABA ID 703035692081905.

Administración → Pruebas API, disponible únicamente para el usuario `admin`
con rol administrador en IMPAR. La misma restricción se valida en el servidor.
Pegar un token de acceso en el campo privado y ejecutar el diagnóstico.
El token se utiliza solo durante la solicitud, no se persiste ni se devuelve;
el navegador limpia el campo al iniciar la consulta. Usar HTTPS.

El laboratorio consulta identidad/calidad del número, pertenencia al WABA,
apps suscritas y plantillas (hasta 100 resultados por lista, con aviso de
paginación). Un error de permisos de una consulta no oculta las demás.
No requiere App Secret ni configurar un webhook para estas consultas de lectura.

No crea canales, contactos, negociaciones, colas ni automatizaciones. No envía
mensajes ni marca mensajes como leídos. No cambia el canal principal, sesiones
QR, suscripciones, registro del número, facturación ni webhook. No consulta
historial de chats. No hay cambios de base de datos ni nuevas dependencias.

IMPORTANTE: no seguir las instrucciones generales de cambiar el webhook de
Alamo o activar este número como canal normal durante esta fase. La otra
herramienta podría depender de esa misma aplicación. No registrar ni migrar
el número ni eliminar suscripciones. El diagnóstico no certifica que sea seguro
compartir la recepción: eso exige identificar la app y el webhook usados por
la herramienta actual. Las consultas pueden aparecer en los registros técnicos
de Meta, pero no modifican su configuración.

Esta entrega habilita pruebas de conexión y preparación. Envío/recepción reales
quedan pendientes de una fase coordinada con un teléfono de prueba explícito,
lista permitida, almacenamiento separado y revisión de la configuración de la
otra herramienta. No usar conversaciones activas de clientes para probar.
La advertencia de pago de Meta se resuelve por separado; credenciales válidas
no garantizan que se puedan entregar mensajes.

## Validación

npm run check
node scripts/test-meta-laboratorio-impar.mjs
node scripts/test-meta-cloud-impar.mjs
node scripts/test-canales-estables.mjs
node scripts/test-accesos.mjs

En Hostinger: actualizar mediante scripts/actualizar.sh con IMPAR_OBJETIVO_SHA
fijado al commit entregado. El actualizador respalda y valida antes de reiniciar.
Después comprobar /api/health y entrar como admin. Otro usuario, incluso con
rol admin y distinto nombre de usuario, debe recibir 403 en el endpoint del
laboratorio. No se realizaron consultas con credenciales reales en desarrollo.

Reversión: revertir el commit con git revert y desplegar el nuevo commit mediante
el actualizador habitual. No hay migraciones ni datos del laboratorio que borrar.
