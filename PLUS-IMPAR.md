# IMPAR: opciones 6, 12 y 14

## 6. Notas internas y menciones
En cada ficha, la pestaña **Notas internas** permite escribir notas de hasta 5.000 caracteres y mencionar hasta diez empleados activos que ya tienen acceso a esa negociación. Las notas nunca entran en mensajes, WhatsApp ni outbox. El aviso de mención lleva a la ficha; mencionar a alguien no le concede permisos nuevos. Se conservan autor y fecha. Las actualizaciones no reemplazan el chat ni el borrador.

## 12. Historial de cambios
La ficha muestra cambios de la negociación y su contacto en **Historial**. El administrador puede consultar **Administración → Auditoría**, filtrar por sector, usuario o campo y cargar registros anteriores. Registra altas, eliminaciones y campos modificados con actor, fecha, valor anterior y nuevo. Incluye etapas, responsables, datos del contacto, puestos, jerarquía, roles y acceso activo. Los cambios de contraseña se registran como “Actualizada”: nunca se almacenan contraseñas ni hashes en la auditoría.

El registro comienza al instalar esta versión; no reconstruye cambios anteriores. Los procesos sin usuario autenticado aparecen como Sistema. La atribución del usuario usa contexto por petición y configuración local a la transacción, sin compartir identidad entre conexiones. Un cambio revertido por la transacción tampoco deja un registro falso.

## 14. Aplicación y avisos
El botón **Aplicación** ofrece instalación o instrucciones según navegador, además de activación o desactivación de avisos por dispositivo. Requiere HTTPS. La instalación y los permisos dependen del navegador y del sistema operativo. Los avisos llegan mediante la conexión existente del CRM mientras siga conectado, incluso en segundo plano; esta versión no implementa Web Push con la aplicación cerrada.

El service worker solo guarda una página de reconexión e iconos públicos. No guarda API, medios privados, sesiones, datos de clientes, mensajes ni HTML del CRM. Sin conexión, muestra instrucciones para reconectar; no permite operar sobre datos sin conexión. Las actualizaciones no provocan recargas automáticas bruscas.

## Actualización
La migración 008 se aplica automáticamente al iniciar. Agrega tablas, índices y disparadores, sin borrar datos existentes. No requiere nuevas dependencias. Ejecutar el procedimiento habitual de Protocolo 002 sobre `/opt/iciia-crm`, instancia PM2 `iciia-crm`. Revisar el build confirmado por `scripts/actualizar.sh` y recargar el navegador.

## Validación
Verificador de sintaxis, imports y exports; pruebas aisladas con PostgreSQL compatible (PGlite): privacidad de notas, autorización, aislamiento entre empresas, menciones inválidas, rollback, atribución de auditoría, antes/después, cambios de acceso, exclusión de hashes, filtros y cursor. Pruebas del service worker para exclusión de API/media/webhook y navegación sin conexión. Regresión de chat y conversación desde contactos. La instalación y entrega de avisos deben comprobarse en los dispositivos reales tras desplegar.
