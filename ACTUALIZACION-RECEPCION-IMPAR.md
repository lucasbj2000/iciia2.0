# Recepción de Papelerías IMPAR · Protocolo 002

## Comportamiento

- Se activa la recepción estructurada de IMPAR sin necesitar una clave de IA.
- Solo una ficha creada por un mensaje entrante después de actualizar, sin responsable, obtiene elegibilidad. Las fichas anteriores, incluidos contactos importados sin responsable, siguen en atención manual.
- Bienvenida: «¡Hola! Te damos la bienvenida a Papelerías IMPAR. ¿Con qué sucursal querés hablar?».
- El menú usa las sucursales activas con agentes habilitados y visibles. Excluye cualquier sucursal llamada Central. Acepta número, nombre y alias conocidos. Conserva la numeración enviada a cada cliente.
- El cliente permanece sin responsable hasta elegir. El reparto es por menor carga entre agentes activos de la sucursal elegida; actualiza la ficha y la negociación, con historial y notificación interna.
- Si no hay elección en **2 horas corridas desde que se registra la bienvenida**, deriva en silencio a un agente de **Matriz**. Los mensajes sin elección no reinician el plazo.
- La fecha queda en PostgreSQL; un worker la comprueba cada 30 segundos y continúa después de reinicios. Una elección recibida antes del vencimiento se respeta aunque se procese después.
- Al asignar un responsable o intervenir una persona, el bot deja de responder. También revalida estas condiciones antes de enviar un mensaje en cola.
- No pide nombre ni ciudad, no repite el menú y no cambia el número institucional de WhatsApp.

**Configuración necesaria:** debe existir exactamente una sucursal activa cuyo nombre contenga «Matriz», con al menos un usuario de rol agente activo y visible. Central es independiente y no se usa como reemplazo. Si falta Matriz o su personal, registra el problema, avisa una vez a administradores y reintenta; nunca deriva a otra sucursal arbitraria.

## Archivos principales y migración

- `src/core.mjs`: distingue altas nuevas, reingresos y altas concurrentes; guarda elegibilidad.
- `src/recepcion-impar.mjs`: menú, selección, reparto, vencimiento y silencio para fichas anteriores.
- `src/worker.mjs`, `src/bot.mjs`: procesamiento persistente y validación antes del envío.
- `src/routes/admin.mjs`, `src/routes/negociaciones.mjs`, `public/js/admin.js`: reactivación limitada a recepciones elegibles y explicación del flujo.
- `src/migrations/019_recepcion_sucursales_impar.sql`: añade el plazo/index, silencia conversaciones anteriores, cancela su cola automática antigua y activa IMPAR. Conserva mensajes manuales, fichas, responsables y sesiones.
- `scripts/test-recepcion-sucursales.mjs`: pruebas funcionales de ingesta, recepción y worker con datos ficticios.
- `scripts/test-recepcion-sucursales-pg.mjs`: pruebas en esquema aislado de PostgreSQL, incluidos bloqueo concurrente, reparto y vencimiento.
- Actualizador y GitHub Actions incluyen las nuevas pruebas. El verificador y la regresión de chat usan rutas compatibles con Windows y espacios.

La migración se ejecuta una sola vez con el mecanismo transaccional del sistema. No debe ejecutarse manualmente para reactivar el bot; el administrador puede pausarlo y reanudarlo desde Administración → Bot.

## Actualizar el VPS

Con el código publicado en `main`, ejecutar en la sesión habitual del VPS:

```bash
cd /opt/iciia-crm && bash scripts/actualizar.sh
```

El actualizador verifica el repositorio y avance fast-forward, respalda PostgreSQL y sesiones, instala dependencias, valida, aplica la migración antes de reiniciar una instancia PM2 y comprueba health, login y publicación pública. Preserva `.env`, `auth/` y `media/`.

## Verificación posterior

```bash
pm2 status
curl -f https://crm.iciia.tech/api/health
```

Comprobar con números de prueba controlados:

1. Cliente existente con responsable: no recibe bot ni cambia de responsable.
2. Ficha existente sin responsable: no recibe bienvenida.
3. Número nuevo: recibe bienvenida una vez y menú sin Central; la ficha y negociación quedan sin responsable.
4. Elegir una sucursal: ficha y negociación se asignan a un agente de esa sucursal y se notifica al agente.
5. Otro número nuevo sin elección durante 2 horas: termina con agente de Matriz, sin mensaje automático adicional.
6. Intervenir manualmente antes de elegir: el bot deja de responder y no deriva al vencer.
7. Confirmar en Administración → Bot el estado activo y la configuración real de Matriz y sus agentes.

Las pruebas automatizadas no envían mensajes a clientes reales. No se debe afirmar activación en producción hasta ejecutar el actualizador y completar estas comprobaciones.

## Reversión

Pausar primero en Administración → Bot para detener saludos y cancelar pendientes automáticos. Publicar una reversión del commit y usar el actualizador habitual. La columna aditiva `recepcion_vence` puede permanecer: no borrar fichas, responsables, historial, mensajes, `auth/` ni `media/`. La activación en `empresas` persiste en la base aunque se revierta Git, por eso la pausa previa es obligatoria. Las asignaciones ya realizadas se conservan.
