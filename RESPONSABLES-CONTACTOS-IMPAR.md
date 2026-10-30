# IMPAR · Búsqueda global y cambio de responsable para todos · Protocolo 002

## Comportamiento (30/10/2026)

- **Búsqueda:** al escribir 2 o más caracteres en Contactos, cualquier usuario busca en **todos los
  contactos de IMPAR** (nombre, teléfono, email, dirección y teléfonos adicionales). Sin búsqueda, el
  agente sigue viendo sus contactos.
- **Filtro «Libres»:** muestra los contactos sin responsable de toda la empresa.
- **Tomar:** en un contacto libre, el botón «Tomar» lo asigna al usuario en un clic.
- **Cambiar / Pasar:** todos los roles pueden asignar un contacto a otro empleado activo o a sí mismos
  (el selector muestra «Yo» primero). Disponible en la lista y en la Ficha 360°.
- Las negociaciones abiertas del cliente pasan al nuevo responsable con marcador «transferido»,
  registro en transferencias, historial y auditoría. Las cerradas, mensajes y adjuntos no cambian.
- El nuevo responsable recibe la notificación (salvo que se lo haya asignado él mismo).
- Privacidad: en contactos de otro agente se ve que hay una negociación abierta, pero no se puede
  abrir esa negociación; la Ficha 360° y el historial siguen con sus permisos.
- Jefes: ya no quedan limitados a su equipo para reasignar (un agente no puede tener más permisos que su jefe).
- Restricciones que se mantienen: el destino debe ser un empleado activo, visible y no administrador;
  un usuario inactivo no puede reasignar.

## Archivos

- `src/routes/contactos.mjs`: búsqueda global, filtro `filtro=libres`, rutas de responsable para todos.
- `src/responsable-contacto-impar.mjs`: permisos y transferencia.
- `public/js/contactos.js`: filtro, «Tomar», «Cambiar/Pasar» y aviso de búsqueda global.
- `scripts/test-principal-contactos.mjs`: política nueva y destinos inválidos.

## Verificación

Con un usuario agente: buscar un cliente de otro agente (aparece), tomar uno libre (queda a su nombre
y en su tablero) y pasar uno propio a otro agente (le llega la notificación).

## Reversión

Revertir el commit y desplegar con el actualizador. No hay migración.
