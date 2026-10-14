# IMPAR · Panel administrativo de accesos

## Ubicación
CRM de IMPAR: https://crm.iciia.tech/ → Administración → 🔐 Accesos y exportación.

## Funcionalidades
1. **Verificar / actualizar:** consulta los usuarios reales desde PostgreSQL cada vez que se pulsa. Muestra nombre, usuario, rol, sucursal, línea, estado y último ingreso.
2. **Buscar:** filtrar por empleado, usuario, cargo/rol o sucursal sin modificar registros.
3. **Exportar listado CSV:** descarga los registros visibles en un CSV con UTF-8 y separador de punto y coma. El CSV incluye la leyenda "No recuperable" en la columna de contraseña actual, nunca hashes ni claves.
4. **Generar nuevas claves:** seleccionar uno o varios empleados activos (máximo 30 por operación, excluye administradores), confirmar escribiendo RESTABLECER y revalidar con la contraseña de administrador. Se crean claves aleatorias de 18 caracteres, diferenciadas por usuario; se reemplazan sus hashes bcrypt dentro de una transacción.
5. **Entregar credenciales:** tras éxito, aparece un modal de una sola visualización con usuario y nueva clave. Permite copiar el acceso individual o exportar CSV de esas nuevas credenciales exclusivamente en ese momento. No se guardan las contraseñas en el historial, servidor o almacenamiento del navegador.

## Seguridad
- Todos los endpoints del panel llevan `requiere('admin')` en el servidor; ocultar la pestaña no es la única protección.
- Los GET son sólo lectura, siempre consultan el estado actual y envían Cache-Control: no-store.
- Nadie puede recuperar contraseñas anteriores: el sistema conserva solamente hashes bcrypt.
- Las contraseñas temporales **sustituyen las anteriores** para nuevos inicios de sesión; las sesiones JWT que ya estén abiertas pueden continuar hasta su vencimiento.
- Se exige contraseña actual de administrador y confirmación escrita para restablecer, y hay un límite de intentos. Nunca se restablecen cuentas inactivas, ocultas o administradoras mediante el lote.
- El reseteo no afecta datos, negociaciones, clientes, permisos, sucursales ni sesiones WhatsApp.
- El archivo con claves temporales se genera en el navegador del administrador y es sensible. Guardarlo únicamente en un lugar privado y entregar cada acceso individualmente, evitando grupos.

## Flujo de uso
1. Ingresar con usuario administrador.
2. Ir a Administración → Accesos y exportación.
3. Hacer clic en Verificar / actualizar para obtener la base actual.
4. Descargar CSV sin cambiar contraseñas, o seleccionar únicamente las cuentas que necesitan un acceso nuevo.
5. Para generar nuevas claves: ingresar contraseña propia de admin, escribir RESTABLECER y confirmar.
6. Copiar cada credencial de forma individual o descargar el CSV de nuevas claves, que no podrá recuperarse más tarde.

## Despliegue
Este cambio debe actualizarse desde el repositorio `lucasbj2000/iciia2.0` mediante el Protocolo 002, en `/opt/iciia-crm` con respaldo y despliegue validado. No alterar el repositorio, servidor ni datos de NOVA.

## Pruebas
GitHub Actions ejecuta `scripts/test-accesos.mjs` y `scripts/verificar.mjs` antes de considerar la revisión lista. Las pruebas automáticas no equivalen a comprobar directamente la base de datos real de IMPAR en producción.
