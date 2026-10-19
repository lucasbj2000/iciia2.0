# IMPAR — ICIIA 2.0 / Protocolo 002

Versión 3.0.0: una empresa, ingreso directo, identidad verde/gris/blanco y microanimaciones de hojas de papel. Conserva sucursales, canales, agentes, roles, negociaciones, mensajería, reportes, calendario y configuración. El catálogo apunta al sitio oficial; no representa una integración de stock.


## Actualizaciones habituales (Protocolo 002, versión reforzada)

**No ejecutar** `preparar-impar.sh`, `reset-impar.mjs` ni scripts de conversión inicial al actualizar un sistema ya operativo.

### Primera instalación del actualizador reforzado

El VPS que tenga todavía el actualizador anterior lo incorpora UNA SOLA VEZ usando:

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

### Todas las actualizaciones siguientes

```bash
cd /opt/iciia-crm && bash scripts/actualizar.sh
```

El script hace automáticamente un backup completo verificado, adquiere un lock,
confirma avance fast-forward, ejecuta la suite de pruebas, aplica las migraciones
SQL en una transacción antes de tocar PM2, comprueba la autenticación y la revisión
exacta del servidor y compara los bytes de HTML y JS publicados en el dominio.

Si fallan las pruebas o PostgreSQL, **no reinicia el CRM operativo**.
Si falla el reinicio o el login, restaura la versión anterior del código e
intenta restaurar PM2. Si solamente falla la comparación pública, informa el
error y conserva el backend nuevo si sigue sano.

**Limitación:** confirmar una migración SQL no equivale a que pueda deshacerse con
`git reset`. Para cambios que borren/transformen datos, se requiere una
estrategia específica de reversión antes de desplegar. Ninguna actualización
normal debe eliminar `auth/`, `media/`, `.env`, usuarios o conversaciones.

Para consultar la publicación sin hacer cambios:

```bash
cd /opt/iciia-crm && bash scripts/verificar-publicacion.sh
```

La coincidencia de código y autenticación **no demuestra** que los mensajes
WhatsApp se estén entregando; probar recepción/envío con un agente real cuando
se cambien canales o chat.

## Conversión inicial autorizada

Ejecutar únicamente en `/opt/iciia-crm`, repositorio `lucasbj2000/iciia2.0`, con PostgreSQL propio de esta instancia. El script valida el remoto, pero el operador debe comprobar que DATABASE_URL corresponde a ICIIA 2.0.

1. Descargar el SHA indicado en la entrega y actualizar por fast-forward.
2. `npm ci --omit=dev`
3. `node scripts/patch-baileys-lid.mjs`
4. `bash scripts/preparar-impar.sh`

El script solicita por terminal la contraseña del administrador, sin publicarla. Respalda base en formato pg_dump, .env, adjuntos y sesiones; detiene PM2; borra las tablas operativas; retira auth/media; cambia la clave JWT; configura `admin`; reinicia y espera health. No se generan datos demo. Se crea una sucursal Central y las plantillas iniciales del sistema. Habrá que cargar los agentes y reconectar WhatsApp. El respaldo contiene datos anteriores y permanece protegido en el VPS.

Un arranque normal nunca borra datos ni restablece contraseñas. Si hay empresas anteriores, el arranque exige la conversión explícita.

## Validación

`npm run check`

`node --experimental-vm-modules scripts/test-impar.mjs`

Después de convertir: comprobar `/api/health`, versión `3.0.0-impar` y build exacto; ingresar como admin; verificar tablero/contactos vacíos, logo, ausencia de selector/alta de empresas; crear agente y canal, conectar WhatsApp y probar recepción/envío. El despliegue y estas pruebas requieren el VPS.

## Reversión

Detener `iciia-crm`. Seleccionar el directorio `backups/impar-reset-*` de la conversión. Restaurar `environment.env` como `.env` con permisos 600; restaurar `database.dump` mediante `pg_restore --clean --if-exists --no-owner` en la base exclusiva de ICIIA 2.0; recuperar los directorios configurados desde `files-0.tar.gz` y `files-1.tar.gz`. Volver al commit previo a esta entrega y reiniciar PM2. Revisar health e ingreso. No restaurar sobre ICIIA original ni fusionar sesiones viejas y nuevas.
