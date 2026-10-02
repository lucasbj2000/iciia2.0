# Conversación desde Contactos · IMPAR

Cada contacto incluye el botón Conversación. Abrirlo consulta el estado actual y no crea una negociación. Si no existe una activa, permite seleccionar una línea WhatsApp de la sucursal y escribir el mensaje inicial. Enviar crea una negociación en Contactado a cargo del usuario que envía, con el bot apagado, y guarda el mensaje y su salida pendiente en la misma transacción. La entrega efectiva sigue el worker y los reintentos del canal; no se muestra como entregado antes de enviarse.

Si existe una activa, muestra el responsable, etapa, sucursal y línea. Solo su responsable recibe el acceso directo al chat y su ubicación. Al abrirlo se limpian los filtros del tablero, se selecciona la etapa en móvil, se ubica la tarjeta y se abre la ficha de conversación. Para otro responsable o una negociación sin asignar, muestra el aviso sin crear otra ni cambiar la asignación.

El servidor comprueba el alcance del contacto, la empresa y el canal. La comprobación de negociación activa se repite al enviar y bloquea la fila del contacto durante la transacción: dos envíos simultáneos desde este botón no crean dos negociaciones. Una operación fallida revierte la negociación, mensaje y salida completos. Los teléfonos locales móviles de Paraguay con o sin cero se normalizan a 595; los incompletos se rechazan.

No necesita migración ni borra contactos, empleados, negociaciones o sesiones. Archivos modificados: `public/js/contactos.js`, `public/js/negociaciones.js`, `src/routes/contactos.mjs`; nuevo servicio `src/conversacion-contacto.mjs`.

Validación: verificador oficial de sintaxis/imports/exports y prueba SQL aislada con todas las migraciones sobre PostgreSQL embebido. Casos: consulta sin alta, permisos, otra empresa, canal ajeno, mensaje vacío, teléfono inválido, rollback de salida, primer mensaje, normalización, intento repetido sin duplicar, responsable ajeno y nueva negociación después de cierre. La entrega WhatsApp real requiere una línea operativa en producción.

Después de actualizar: recargar el navegador; Contactos → Conversación de un cliente sin activa → escribir y enviar un mensaje autorizado. Debe abrir la ficha en Contactado y mostrar el mensaje pendiente/enviado según el canal. Repetir el botón debe avisar que existe una activa. Probar con otro responsable debe mostrar el aviso sin acceso directo ni nueva negociación. Cancelar el compositor no debe crear nada.

Reversión: volver al commit anterior `b3632cf32617963048bf5ed628aa5423a2d0fbf0` y reiniciar PM2. No restaurar ni borrar la base: las negociaciones y mensajes creados son compatibles con la versión anterior.
