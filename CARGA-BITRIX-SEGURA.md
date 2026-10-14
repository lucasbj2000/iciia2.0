# IMPAR — Importación segura de contactos desde Bitrix

## Objetivo
Agregar nuevos contactos del CSV de Bitrix sin crear duplicados y sin modificar datos de fichas ya existentes, especialmente responsables, nombres y números.

## Procedimiento
1. Actualizar exclusivamente la instancia de IMPAR mediante Protocolo 002.
2. Entrar con cuenta de **Administrador**.
3. Ir a **Administración → 🛡 Carga Bitrix**. También se puede acceder desde **Contactos → Importar sin duplicados**.
4. Elegir el CSV de Bitrix (hasta 1 MB). Las columnas requeridas son: **Responsable; Teléfono del trabajo; Nombre; Apellido**. Se acepta CSV UTF-8 o Windows-1252 y campos delimitados por punto y coma.
5. Revisar los responsables: el sistema sugiere una coincidencia exacta sin distinguir mayúsculas ni tildes. Si no encuentra un usuario activo único de IMPAR, el administrador debe seleccionarlo manualmente o dejar el grupo sin importar.
6. Pulsar **Previsualizar sin guardar**. Se comparan teléfonos normalizados, nombres, duplicados internos y responsables contra la base real.
7. Confirmar únicamente las altas marcadas como **Listo para insertar**.
8. Revisar el resumen y, opcionalmente, volver a previsualizar: los clientes insertados ahora aparecerán como existentes.

## Regla no destructiva
- No se ejecutan UPDATE ni DELETE sobre contactos previos.
- Un teléfono ya registrado se omite, aunque en el CSV figure con otro nombre o responsable.
- Un nombre existente con otro teléfono se envía a revisión manual.
- Si el mismo teléfono o nombre aparece en dos filas del CSV, ambas filas se excluyen de la importación hasta corregir el archivo.
- Un responsable no identificado nunca se asigna automáticamente a otro empleado.
- Se utiliza una transacción y bloqueo de carga; se verifica que la vista previa siga correspondiendo a la base actual.
- Si la base cambió durante la revisión, se cancela la carga para que se vuelva a previsualizar.
- Las inserciones hacen además una comprobación SQL WHERE NOT EXISTS del teléfono y nombre.
- No se crea ninguna negociación ni se modifica una negociación existente.
- Los contactos nuevos sí quedan asociados al usuario activo que el administrador confirmó y a su sucursal/línea actuales.

## Revisión previa del archivo entregado
El archivo Bitrix del 14 de octubre de 2026 contenía 150 filas.
- 4 filas involucradas en 2 conflictos de teléfono dentro del CSV.
- 3 filas con nombres incompletos o interpretados como valores numéricos.
- 143 filas candidatas a comparar con el CRM.
- 26 filas cuyo responsable de origen se llama «IMPAR DIGITAL»; corresponde verificar si es un usuario real y, de lo contrario, decidir la asignación adecuada.

Los recuentos definitivos de nuevos/existentes se obtienen exclusivamente desde el endpoint autenticado de vista previa. **No asumir que 143 = 143 altas nuevas**.

## Protección de datos
El CSV de clientes NO está incorporado al repositorio GitHub ni a estos documentos. El navegador del administrador lo procesa y envía únicamente al API autenticado para comparar y confirmar. El sistema no conserva el CSV entero como archivo público.

## Alcance y validación
Se comprueba sintaxis e imports mediante GitHub Actions y pruebas de conciliación con registros de ejemplo. El número exacto de contactos que ya están en IMPAR solo se conoce ejecutando la vista previa con una cuenta autorizada conectada a la base de producción.
