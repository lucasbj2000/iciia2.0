# IMPAR · Ficha 360° estable y varios números por cliente

## Problema
Al abrir la Ficha 360° desde Contactos, un fallo o demora del API podía dejar el modal con un spinner perpetuo.
También había responsables de contactos sin negociaciones que recibían un rechazo del API aun cuando tenían permitido consultar su ficha.

## Cambios de interfaz
- Ficha 360 con carga máxima de 16 segundos, error comprensible y botón Reintentar.
- El responsable o agente de una negociación activa puede editar nombre, email, documento, ciudad, dirección y notas.
- No se puede editar libremente el responsable desde esos campos; permanece la acción específica de transferencia.
- El teléfono principal queda visible pero no se sobrescribe al editar. Los teléfonos secundarios se agregan o desvinculan desde **Teléfonos vinculados**.

## Número único por identidad
- Nueva tabla `contacto_telefonos`, índice único por `empresa_id,tel_norm`.
- Compatibilidad con normalización histórica de IMPAR: últimos ocho dígitos.
- Un teléfono puede vincularse a un único contacto en una empresa. La validación consulta también los teléfonos principales históricos.
- El servidor toma un bloqueo PostgreSQL para evitar altas concurrentes del mismo teléfono.
- Los números duplicados preexistentes no se fusionan automáticamente. Requieren revisión humana.
- No se cambian responsables, sucursales, conversaciones, archivos ni historiales al registrar otro teléfono.
- Sólo el responsable o un agente asignado a una negociación activa puede añadir/quitar números; las fichas ajenas permanecen protegidas.
- El teléfono principal no puede eliminarse desde este flujo. Tampoco se desvincula un número usado por una conversación activa.
- Al crear un contacto nuevo, si su número corresponde a una ficha existente, se devuelve un conflicto y no se crea otra ficha.

## Operación WhatsApp multiteléfono
- Si un número secundario vuelve a escribir, el CRM lo asocia con el mismo `contacto_id` y reutiliza la negociación abierta cuando corresponde.
- El mensaje entrante registra `remitente_numero` cuando WhatsApp lo proporciona, para que el agente sepa de cuál número provino.
- Cada negociación conserva `telefono_destino` como número de salida: al iniciar chat desde Contactos puede elegirse el destino, y dentro de la negociación puede cambiarse sin crear ni duplicar clientes.
- Si entra un nuevo mensaje desde otro teléfono vinculado, el destino de respuesta se actualiza a ese número. El agente puede seleccionarlo manualmente si desea responder a otro número.
- El mensaje WhatsApp se encola una sola vez y los reintentos de envío siguen el mecanismo existente.
- Los mensajes anteriores no se modifican: si no existía información de número remitente, se mantienen sin inventarlo.
- Los historiales se siguen agrupando por el mismo contacto, pero las negociaciones permanecen independientes para reportes.

## Seguridad y límites
- Una coincidencia de solo nombre no demuestra que dos teléfonos pertenezcan a una persona: la vinculación debe ser realizada expresamente por el empleado autorizado.
- La colisión por los últimos ocho dígitos se trata de manera conservadora: no se vincula ni fusiona sin revisión.
- El prefijo internacional debe informarse para agregar teléfonos válidos.
- Si Baileys envía solo identificadores `@lid` sin número PN disponible, no se adivina un teléfono.
- Esta migración preserva registros existentes y no modifica credenciales ni sesiones WhatsApp.

## Validación
Las verificaciones automatizadas cubren errores de carga, permisos de edición, colisiones y migración 018 ejecutada sobre PostgreSQL real con datos ficticios. La validación final requiere abrir una Ficha 360° con un agente asignado y confirmar recepción/envío al número seleccionado en el Hostinger real.
