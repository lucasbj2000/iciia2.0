# PROTOCOLO 002 — ICIIA 2.0

## 1. Alcance

Este protocolo define cómo se diagnostican, corrigen, actualizan, validan y despliegan los cambios del sistema **ICIIA 2.0**.

Repositorio oficial:

`lucasbj2000/iciia2.0`

La rama `main` es la fuente de verdad del código que se considera listo para producción.

---

## 2. Objetivo

Cuando se solicite una corrección, mejora o nueva función bajo **Protocolo 002**, el trabajo deberá:

1. Revisar primero el estado actual del repositorio.
2. Identificar la causa del problema o los módulos afectados.
3. Realizar el cambio sin romper funciones existentes.
4. Validar sintaxis, imports, exports y configuración.
5. Mantener compatibilidad con el VPS de producción.
6. Registrar los cambios en GitHub con un commit descriptivo.
7. Entregar instrucciones exactas para actualizar el VPS de Hostinger.
8. Incluir procedimiento de verificación posterior al despliegue.
9. Evitar publicar secretos, contraseñas, tokens o archivos de producción.

---

## 3. Arquitectura de referencia

ICIIA 2.0 utiliza actualmente:

- Node.js 20+
- Express
- PostgreSQL
- PM2
- Nginx
- SSE para tiempo real
- WhatsApp QR mediante Baileys
- WhatsApp Cloud API / Messenger / Instagram mediante Meta
- Frontend servido desde `public/`
- Backend en `src/`
- Migraciones en `src/migrations/`
- Scripts operativos en `scripts/`

No se deberá cambiar esta arquitectura de forma destructiva sin documentar primero la migración necesaria.

---

## 4. Flujo de trabajo obligatorio

### Fase A — Diagnóstico

Antes de modificar código:

- revisar la versión actual de `main`;
- localizar los archivos relacionados;
- revisar dependencias y configuración;
- determinar si el cambio afecta base de datos, API, frontend, canales, sesiones, adjuntos o infraestructura;
- comprobar si requiere una migración SQL.

Si el problema está en producción, se analizarán también los errores, logs o síntomas que se proporcionen.

### Fase B — Implementación

Los cambios deberán ser mínimos y controlados.

Se deberá evitar:

- reescribir módulos completos sin necesidad;
- eliminar compatibilidad existente sin justificación;
- guardar secretos dentro del repositorio;
- modificar datos reales directamente desde el código;
- usar múltiples instancias PM2 mientras Baileys dependa de sockets en memoria.

### Fase C — Validación

Antes de considerar terminada una actualización se deberá ejecutar o comprobar, según corresponda:

```bash
npm install
npm run check
```

El verificador oficial es:

```bash
node scripts/verificar.mjs
```

Además, cuando el cambio lo requiera, se comprobarán:

- arranque del servidor;
- conexión a PostgreSQL;
- endpoint `/api/health`;
- autenticación;
- permisos y aislamiento por empresa;
- migraciones;
- carga de archivos;
- SSE;
- canales afectados;
- comportamiento del frontend.

---

## 5. Cambios de base de datos

Nunca se deben modificar manualmente las tablas de producción como método normal de actualización.

Los cambios estructurales deben agregarse como una nueva migración dentro de:

`src/migrations/`

Las migraciones deben:

- ejecutarse dentro de transacciones PostgreSQL y registrar su marcador en la misma transacción;
- poder ejecutarse una sola vez;
- preservar los datos existentes;
- incluir valores por defecto cuando sean necesarios;
- evitar eliminar información salvo autorización explícita;
- ser compatibles con la versión que se desplegará.

---

## 6. Seguridad

Nunca deberán subirse a GitHub:

- `.env`
- contraseñas;
- claves JWT;
- tokens de Meta;
- sesiones de WhatsApp;
- contenido de `auth/`;
- contenido de `media/`;
- dumps de base de datos;
- logs con información sensible.

El archivo `.env.example` deberá contener solamente nombres de variables y valores de ejemplo seguros.

---

## 7. Entrega de cada actualización

Cada intervención bajo Protocolo 002 deberá terminar con un resumen que indique:

- problema o mejora solicitada;
- causa encontrada, si corresponde;
- archivos modificados;
- cambios realizados;
- validaciones efectuadas;
- commit generado;
- si existe migración de base de datos;
- instrucciones de despliegue;
- instrucciones de verificación;
- procedimiento de reversión cuando el cambio sea sensible.

Cuando sea útil, también se entregará un paquete comprimido del código actualizado para conservarlo o cargarlo manualmente.

---

## 8. Despliegue en Hostinger VPS

Directorio de producción recomendado:

```bash
/opt/iciia-crm
```

**Flujo permanente simplificado:**

```bash
cd /opt/iciia-crm && bash scripts/actualizar.sh
```

El script incluye automáticamente el respaldo. No hace falta ejecutar comandos separados
de `git reset`, `npm ci`, `pm2 reload` o respaldo para una actualización normal.

**Orden obligatorio desde octubre de 2026 (incidente PostgreSQL MIN(UUID)):**

1. validar que el repositorio es `lucasbj2000/iciia2.0`, rama `main` y working tree sin cambios;
2. tomar bloqueo exclusivo para impedir dos despliegues simultáneos;
3. consultar `origin/main` y verificar avance **fast-forward** (admite fijar `IMPAR_OBJETIVO_SHA`);
4. crear respaldo íntegro de PostgreSQL, `auth/` y `media/` **antes de tocar el código**;
5. aplicar el commit y ejecutar dependencias y pruebas obligatorias;
6. aplicar migraciones en una **transacción PostgreSQL** (SQL y marcador juntos) con advisory lock; **si falla, no reiniciar PM2**;
7. reiniciar una sola instancia `iciia-crm`; verificar build exacto en health, base de datos, login y estado de PM2;
8. comprobar mediante `scripts/verificar-publicacion.sh` que el dominio público devuelve la revisión correcta y el mismo HTML/JS que hay en el VPS; informar explícitamente diferencias de caché/proxy;
9. confirmar mediante una prueba funcional con un agente si el cambio toca mensajería o permisos.

**Reglas de protección:** nunca borrar `auth/`, `media/`, `.env` ni reiniciar la vinculación de WhatsApp como parte de la instalación.
Un error anterior al reinicio restaura el código sin reiniciar el proceso que ya funciona.
Un error de salud tras el reinicio intenta restaurar el código anterior y PM2.
Las migraciones PostgreSQL ya confirmadas **no se deshacen con `git reset`**; para cambios incompatibles o destructivos es obligatorio un plan de restauración validado antes del despliegue.
Si el servicio local funciona pero falla la comparación pública (caché/CDN), se informa el error y **no se derriba un servidor saludable por un problema de publicación**.

**Primera incorporación del nuevo actualizador** (una sola vez, desde una copia que aún tiene el script antiguo):
```bash
cd /opt/iciia-crm &&
git diff --quiet &&
git diff --cached --quiet &&
git fetch origin main &&
bash scripts/backup.sh &&
BASE="$(git rev-parse HEAD)" &&
git merge --ff-only origin/main &&
IMPAR_BASE_SHA="$BASE" bash scripts/actualizar.sh
```
Después de esa instalación se usa únicamente el comando simplificado.

---

## 9. Verificación posterior al despliegue

Después de cada actualización:

```bash
pm2 status
pm2 logs iciia-crm --lines 100
curl -f https://TU_DOMINIO/api/health
```

También se deberá probar manualmente la función que motivó la actualización.

Una actualización no se considera completada hasta que el servicio quede operativo.

---

## 10. Reversión

Si una actualización genera un problema en producción:

1. no borrar datos;
2. guardar los logs relevantes;
3. identificar el commit anterior estable;
4. revertir el código de manera controlada;
5. reiniciar ICIIA;
6. verificar `/api/health`;
7. corregir el problema en una nueva revisión.

Las migraciones destructivas deberán incluir un plan específico de reversión antes del despliegue.

---

## 11. Forma de invocar el protocolo

Ejemplos:

- **“Protocolo 002: corregir el error del login.”**
- **“Protocolo 002: agregar una función al módulo de contactos.”**
- **“Protocolo 002: revisar por qué WhatsApp no reconecta.”**
- **“Protocolo 002: preparar la versión para Hostinger.”**

Al recibir una solicitud de este tipo, se tomará siempre como base la versión más reciente del repositorio `lucasbj2000/iciia2.0`.

---

## 12. Principio de producción

GitHub contiene el código.

El VPS de Hostinger contiene la ejecución y los datos reales.

Los secretos y datos de producción permanecen en el VPS.

El flujo esperado es:

```text
Solicitud
   ↓
Diagnóstico
   ↓
Cambio de código
   ↓
Validación
   ↓
Commit en GitHub
   ↓
Backup del VPS
   ↓
Actualización desde GitHub
   ↓
Verificación
```

Este documento constituye el **PROTOCOLO 002 — ICIIA 2.0**.
