# IMPAR · Enlaces de WhatsApp por agente · Protocolo 002

## Comportamiento

- Cada usuario activo tiene un enlace **directo a WhatsApp**: `https://wa.me/595976992667?text=…`
  con el saludo «Hola, vengo de parte de <Nombre>». No pasa por el dominio
  del CRM, por eso no se cuentan aperturas; sí se cuentan los clientes recibidos.
  El número se puede cambiar con `IMPAR_WA_ENLACE` en `.env` (los enlaces ya enviados no cambian).
- Opcional: `https://crm.iciia.tech/w/<usuario>` sigue disponible como enlace corto que redirige
  al mismo `wa.me` y además registra aperturas.
- Cuando el cliente envía ese saludo (puede agregar su consulta), la conversación se asigna
  directamente a ese usuario, sin bot de recepción ni reparto por sucursal, aunque el cliente
  ya tuviera otro responsable o una negociación abierta con otra persona. Queda en el historial
  «🔗 Asignado a <Nombre> por su enlace de WhatsApp» y el usuario recibe la notificación.
- Atribución: WhatsApp no informa desde qué enlace llegó un cliente, por eso viaja en el saludo
  «Hola, vengo de parte de <Nombre completo>». Se compara sin tildes ni mayúsculas, y una letra
  dañada por WhatsApp (signo de reemplazo) cuenta como comodín. Un nombre incompleto o repetido no asigna.
  Si el cliente borra el saludo entero y escribe otra cosa, entra por el flujo normal.
- Prueba real del 29/10/2026: la primera versión llevaba una marca invisible y un emoji; WhatsApp los
  mostró como signos de reemplazo. El saludo actual no lleva ninguno de los dos. Los mensajes que
  lleguen con la marca anterior se siguen reconociendo.
- Usuarios: botón 🔗 junto a «Cerrar sesión» con su enlace, botón Copiar y métricas de 30 días.
- Administración → «🔗 Enlaces WhatsApp»: todos los enlaces, aperturas y clientes recibidos.
- Usuarios inactivos: su enlace abre WhatsApp sin saludo y no asigna.

## Archivos

- `src/migrations/028_enlaces_agentes_impar.sql`: tabla `enlaces_clics_impar` y columna
  `negociaciones.enlace_agente_id` (aditiva).
- `src/enlaces-agentes-impar.mjs`: marca, saludo, lectura y respaldo por nombre.
- `src/routes/enlaces-impar.mjs` y `src/server.mjs`: `/w/:usuario` (público, límite 60/min por IP),
  `/api/enlaces/mio` y `/api/enlaces` (admin).
- `src/core.mjs`: asignación al ingresar el mensaje.
- `public/js/enlaces-impar.js`, `public/js/app.js`, `public/js/admin.js`, `public/index.html`.
- `scripts/test-enlaces-agentes-impar.mjs`: en `actualizar.sh` y CI.

## Verificación después del despliegue

1. `curl -sI https://crm.iciia.tech/w/ana.ferreira | grep -i location` → `wa.me/595976992667?text=…`.
2. Desde un celular de prueba (no el de IMPAR), abrir el enlace de un usuario y enviar el saludo:
   la negociación aparece asignada a ese usuario con «🔗 Asignado … por su enlace de WhatsApp».
3. Repetir desde un número que ya tenga otro responsable: pasa al usuario del enlace.

## Reversión

Revertir el commit y desplegar con el actualizador. La tabla y la columna pueden permanecer; los
enlaces dejan de redirigir con saludo y la asignación vuelve al flujo normal.
