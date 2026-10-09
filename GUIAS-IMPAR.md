# IMPAR · Guías interactivas para usuarios nuevos

## Qué se agregó

- **Ayuda** en la barra superior, visible a usuarios autorizados.
- **Mini ayudas «?»** en filtros, botones, fases, reportes, calendario y otras funciones habituales.
- **Recorrido guiado** que marca controles reales de la pantalla sin modificarlos.
- **Bienvenida opcional** en el primer ingreso. Se puede posponer; se registra que ya fue ofrecida.
- **Ayuda contextual** en conversaciones, incluyendo mensajes, bot, notas, transferencia y adjuntos. El sistema no inserta controles extra en el compositor de WhatsApp para mantener estable la vista móvil.
- **Pestaña «Ayudas guiadas» de Administración** para habilitar por defecto, restringir por empleado y decidir si mostrar bienvenida y mini ayudas.
- **Configuración persistente en PostgreSQL** y actualización de preferencias por SSE.

## Activación

Por precaución, la configuración inicial tiene las ayudas desactivadas para todos. El administrador debe habilitarlas desde:

**Administración → Ayudas guiadas → Ayudas activadas por defecto → Guardar configuración**.

Para mostrar u ocultar ayudas a una persona:
1. Buscar su nombre en la misma pestaña.
2. Seleccionar «Mostrar ayudas», «Ocultar ayudas» o «Según ajuste general».
3. Guardar la configuración.

**Mostrar a todos** activa el valor general y limpia las excepciones; **Ocultar a todos** desactiva el valor general y limpia las excepciones. **Restablecer todos** solo cambia las excepciones a «Según ajuste general». Estos atajos requieren guardar.

## Funcionamiento para empleados

1. Al entrar, la persona con permiso puede ver una invitación discreta para conocer el CRM. No se abre automáticamente un recorrido que bloquee la gestión.
2. Puede tocar **Conocer el CRM** o **Ahora no**.
3. El botón **Ayuda** siempre permite volver al índice de explicaciones y abrir un nuevo recorrido.
4. Los iconos **?** explican qué hace cada elemento; se pueden tocar en el celular.
5. Si el administrador deshabilita ayudas a un empleado conectado, los controles desaparecen automáticamente.

## Seguridad y compatibilidad

- Restricción de acceso configurada en el servidor, no solo ocultamiento visual.
- No se publican usuarios, preferencias ni documentos desde rutas públicas.
- No se alteran clientes, mensajes, negociaciones, canales, sesiones de WhatsApp ni roles.
- La nueva migración SQL es **011_guias_interactivas.sql**; agrega solamente tablas nuevas.
- El módulo no necesita APIs externas, servicios pagos ni credenciales adicionales.

## Verificación después de actualizar

- Comprobar que **/api/health** responda correctamente.
- Entrar como administrador y habilitar las ayudas globalmente.
- Ingresar con un empleado autorizado y confirmar que aparecen Ayuda y mini signos «?».
- Ocultar ayudas a ese empleado y comprobar que desaparecen.
- Conectar con otro usuario sin autorización y comprobar que no acceda a las guías.
- Revisar **Negociaciones → ficha de cliente → chat** en móvil: la caja de escritura y el botón Enviar deben mantener su tamaño habitual.
- Abrir un recorrido, avanzar y cerrarlo sin enviar mensajes ni modificar clientes.
- Volver a ingresar y verificar que no reaparezca la bienvenida si ya se descartó.

## Despliegue

Desde **/opt/iciia-crm**, realizar el respaldo y ejecutar **scripts/actualizar.sh** en la instancia IMPAR. Nunca ejecutar **preparar-impar.sh** ni **reset-impar.mjs** para esta actualización. Verificar que el remoto del repositorio sea **lucasbj2000/iciia2.0**.

## Limitaciones de la validación

La validación de GitHub cubre sintaxis, imports y pruebas unitarias de visibilidad; las operaciones con PostgreSQL, la interfaz real y el comportamiento móvil deben comprobarse después del despliegue en el servidor IMPAR.
