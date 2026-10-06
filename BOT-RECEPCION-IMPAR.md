# Recepción automática de IMPAR

## Comportamiento
- Cliente sin responsable: pregunta nombre y ciudad en un único mensaje. Guarda los datos y elige la sucursal más cercana mediante distancia geográfica desde la ciudad informada. Reparte entre agentes activos y visibles de esa sucursal por carga; conserva la línea de WhatsApp de ingreso.
- Reconoce ciudades con y sin acentos, CDE, PJC y abreviaturas habituales. Incluye 171 localidades de Paraguay; si la ciudad no se reconoce o se mencionan varias distintas, pregunta nuevamente y deja la consulta para revisión humana tras un máximo de intentos. No inventa una ubicación.
- Cliente con responsable activo: conserva al responsable, incluso después de un cierre. Mensaje: «[Agente], tu agente responsable, te dará retorno en un momento. ¿Qué producto necesitás?».
- Después de solicitar el producto, registra la respuesta en la conversación y se silencia. También se silencia cuando un agente interviene. No repite el saludo por cada mensaje.
- Si no hay agentes activos en la sucursal más cercana, deja la negociación pendiente en esa sucursal; no la desvía silenciosamente a otra ciudad.
- Cuando se solicita una ubicación durante la recepción, comparte el enlace de la sucursal mencionada, asignada o cercana a la ciudad indicada. Los enlaces de Asunción y Madame Lynch se conservaron tal como los proporcionó el usuario, aunque son iguales.

## Ubicaciones y fuentes
Las coordenadas de sucursales se obtuvieron de los enlaces de Google Maps publicados por IMPAR en https://www.impar-papeles.com.py/sucursales:
- Casa Matriz (Asunción): -25.2991778, -57.6356097.
- Lambaré: -25.3526614, -57.6023125.
- CDE: -25.5050402, -54.6376159.
- Encarnación: -27.3300948, -55.8638838.
- Fernando de la Mora / Madame Lynch: -25.2892772, -57.5488351.
- PJC: -22.5620638, -55.7210496.

Los nombres de sucursales del organigrama se vinculan sin renombrar empleados: Matriz → Asunción; Fernando de la Mora → Madame Lynch; CDE/PJC y nombres completos equivalentes. La distancia se aproxima desde el centro de la ciudad, no desde la casa del cliente ni por tiempo de viaje.

Datos de ciudades: extracto PY de GeoNames descargado el 06/10/2026, filtrado a localidades con al menos 500 habitantes registrados. https://download.geonames.org/export/dump/PY.zip y https://www.geonames.org/about.html. Atribución: GeoNames, licencia Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/. La selección de datos y los alias son adaptaciones para este CRM.

## Mensajes y seguridad
La recepción estructurada funciona sin clave de OpenAI. Espera cuatro segundos de silencio y responde una sola vez a cada ráfaga. Usa estado persistente por negociación, bloqueo de fila y escritura transaccional de mensaje/outbox para evitar respuestas repetidas o parciales. Tope de cinco respuestas automáticas por recepción. No publica las instrucciones internas del bot, precios ni stock. La brevedad reduce mensajes innecesarios; no garantiza evitar restricciones de WhatsApp.

## Respuesta rápida bancaria
El recurso original `resources/impar-datos-bancarios.jpg` se copia al almacenamiento persistente de archivos al iniciar, se registra en la base y se agrega una respuesta rápida de empresa con imagen. La preparación es idempotente: no duplica archivos ni plantillas al reiniciar. Aparece en la ficha, Respuestas y acciones → Respuestas rápidas. El agente selecciona la plantilla, revisa la imagen y pulsa Enviar; no se envía automáticamente.

## Instalación y validación
Migración 009: agrega estado de recepción por negociación y habilita recepción, anti-duplicado, respuestas rápidas, adjuntos y silencio al responder un agente para IMPAR. Conserva contactos, empleados, contraseñas, canales y sesiones. Al iniciar se prepara la plantilla bancaria.

Validados sintaxis/imports/exports y pruebas aisladas con PGlite: ingesta real, programación del bot, no exposición de instrucciones, clientes nuevos/existentes, datos y abreviaturas, cálculo de cercanía, agentes activos, ausencia de agentes, enlaces, límites, doble procesamiento, aislamiento entre empresas y silencio al intervenir una persona. La plantilla bancaria se comprueba dos veces para verificar su idempotencia. La entrega real de mensajes depende del canal conectado y debe probarse después del despliegue.
