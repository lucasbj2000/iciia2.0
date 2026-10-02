# Organigrama y carga inicial IMPAR

Administrador: menú Organigrama. Gerencia puede consultar; los cambios y la importación son exclusivos del administrador.

El sector permite altas, edición de nombre/usuario/cargo/rol/sucursal/línea/superior/correo/teléfono, cambio de contraseña y baja/reactivación. Una baja bloquea el acceso y conserva el historial. Reasignar subordinados antes de dar de baja a su superior. No permite jerarquías circulares, superior inactivo, autobaja del administrador ni pérdida del último administrador.

Actualizar desde el commit de entrega, ejecutar `bash scripts/actualizar.sh`, recargar navegador. La migración 007 agrega los campos y la tabla de originales; no borra datos. Después ingresar como admin y usar Organigrama → Importar clientes y empleados con `impar-importacion.json`. Los datos personales y contraseñas iniciales se entregan por separado y nunca se versionan en GitHub.

La importación es transaccional: 20 empleados, equipos por sucursal, jefaturas bajo gerencia, contactos con responsables según coincidencia exacta del vendedor (sin diferencias por acentos/mayúsculas). No crea negociaciones ni envía mensajes. Reimportar no duplica el archivo y no restablece contraseñas ni puestos de usuarios existentes. Conserva cada fila original y todas las columnas SAP. Consolida contactos por código SAP/documento; no fusiona personas distintas solo por compartir teléfono. Los números cortos se conservan como datos originales y no se interpretan como identidades WhatsApp válidas.

Los vendedores que no coinciden se muestran pendientes. Organigrama → Vincular vendedores SAP con empleados permite resolverlos mediante selección explícita. No se suponen equivalencias de nombres ni se crean empleados no incluidos en la nómina.

Verificación realizada: migraciones y carga completa en PostgreSQL embebido aislado, 8497 filas conservadas, repetición sin duplicados, contraseñas existentes preservadas; contratación/baja y rechazo de ciclos/autobaja/subordinados activos. El hash de contraseña se simuló en esta prueba de integración; producción usa bcrypt 12. Verificador oficial de sintaxis/imports/exports y .gitignore. La carga efectiva y comprobación de canales requieren producción.

Reversión del código: volver al commit anterior 42c17efb97cca8302ec47956747d97653424b0e8 y reiniciar PM2. Los campos nuevos no impiden el código anterior; no eliminar las tablas ni los clientes para revertir la interfaz. Para deshacer una importación efectiva restaurar el respaldo PostgreSQL previo con el servicio detenido, solo en la instancia IMPAR.
