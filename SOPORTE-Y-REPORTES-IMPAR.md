# Soporte interno, reportes y cierre de sesión — IMPAR (Protocolo 002)

## Cierre de sesión
El botón ⏻ no cerraba la sesión: al salir se limpiaban las ayudas interactivas y
`quitarMarcas()` usaba `$(…).forEach` (un solo elemento) en lugar de `$$(…)` (lista).
Sin marcas en pantalla eso lanzaba un error y el cierre nunca se ejecutaba.
Corregido, y el botón ahora cierra la sesión aunque falle cualquier limpieza.
El mismo error estaba en el buscador de guías, los botones heredar/todos/ninguno
y la edición de respuestas rápidas del panel de admin.

También se activó `src/async-errors.mjs`, que existía pero no se cargaba: un error
en una ruta async ahora responde 500 en lugar de detener todo el proceso (y con él
la conexión de WhatsApp hasta que PM2 lo reinicia).

## Soporte (menú «Soporte», visible para todos)
1. El usuario elige **Consulta**, **Informar una falla** o **Pedir una mejora**, y completa
   título, parte del CRM, detalle, impacto (fallas) y una captura opcional.
2. **Gerencia**: la reciben los gerentes que elige el admin. Cualquiera de ellos aprueba
   o rechaza (con motivo). Nadie aprueba su propia solicitud; si no hay otro aprobador,
   pasa directo a administración.
3. **Administración**: el admin confirma si se hace o no. Una consulta puede responderse
   y resolverse en el mismo paso. Luego la marca como resuelta.

Cada usuario ve sus solicitudes y en qué paso están, con notificación en cada avance.
En «Quién aprueba y quién ve» (solo admin) se eligen los gerentes aprobadores y los
**observadores**, que ven todas las solicitudes y el resumen en modo lectura.

El **Resumen** muestra abiertas, fallas que impiden trabajar, tiempos hasta la aprobación
y la resolución, distribución por tipo y estado, en qué parte del CRM se reportan fallas
y la evolución semanal.

Base de datos: migración `029_soporte_impar.sql` (se aplica sola al iniciar).
API: `/api/soporte` (`contexto`, listado, `resumen`, detalle, alta, `comentarios`, `decision`, `config`).

## Reportes
Nuevo diseño con los mismos datos y el mismo alcance de permisos (admin y gerente:
toda la empresa; jefe: su equipo; agente: sus negociaciones). Agrega la comparación
con el período anterior —calculada con el mismo filtro de permisos—, gráfico de
ingresadas y ganadas con detalle al pasar el cursor, embudo con los colores de cada
etapa, equipo ordenable, cola de espera con plazo, y detalle con búsqueda y filtro por etapa.

## Verificación después de desplegar
1. Entrar y tocar ⏻: debe volver a la pantalla de ingreso, también al recargar.
2. Admin › Soporte › «Quién aprueba y quién ve»: elegir gerentes y observadores, Guardar.
3. Con un agente: Soporte › Nueva solicitud › Informar una falla. El gerente aprobador
   recibe la notificación, aprueba; el admin la recibe, confirma y resuelve.
   El agente ve cada paso en «Mis solicitudes».
4. Reportes con un agente: solo «Tus negociaciones» y «Tu rendimiento».
