#!/usr/bin/env bash
# IMPAR · Protocolo 002 (seguro). Un comando para actualizar desde GitHub.
# Respaldo automático, pruebas, migraciones atómicas antes de PM2, health real
# y comparación del código público con lo que ofrece crm.iciia.tech.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ORIGEN="$(git remote get-url origin)"
if ! printf '%s' "$ORIGEN" | grep -Eq 'lucasbj2000/iciia2[.]0([.]git)?$'; then
  echo '✖ Repositorio incorrecto: este actualizador es SOLO para IMPAR.' >&2; exit 1
fi
if [[ "$(git branch --show-current)" != main ]]; then
  echo '✖ No estás en la rama main de IMPAR; no se actualizará.' >&2; exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo '✖ Hay cambios locales versionados. No se sobrescribirán.' >&2; exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  echo '✖ Falta flock; no se puede garantizar un solo despliegue a la vez.' >&2; exit 1
fi
exec 9>/tmp/impar-iciia2-actualizar.lock
if ! flock -n 9; then
  echo '✖ Otra actualización de IMPAR está en ejecución. Esperá a que termine.' >&2; exit 1
fi

ANTES_SHA="${IMPAR_BASE_SHA:-$(git rev-parse HEAD)}"
git cat-file -e "${ANTES_SHA}^{commit}" || { echo '✖ SHA anterior inválido.' >&2; exit 1; }
if ! git merge-base --is-ancestor "$ANTES_SHA" HEAD; then
  echo '✖ La revisión anterior no corresponde a este historial.' >&2; exit 1
fi

echo '› Consultando cambios de IMPAR en GitHub…'
git fetch origin main
DESTINO_SHA="$(git rev-parse origin/main)"
if [[ -n "${IMPAR_OBJETIVO_SHA:-}" && "$DESTINO_SHA" != "$IMPAR_OBJETIVO_SHA" ]]; then
  echo '✖ Main no coincide con el SHA solicitado: actualizá la referencia antes de seguir.' >&2; exit 1
fi
if ! git merge-base --is-ancestor HEAD "$DESTINO_SHA"; then
  echo '✖ La revisión local no es antecesora de origin/main. No se fuerza el historial.' >&2; exit 1
fi

if [[ "$ANTES_SHA" == "$DESTINO_SHA" && "$(git rev-parse HEAD)" == "$DESTINO_SHA" ]]; then
  echo "✔ IMPAR ya tiene el código ${DESTINO_SHA:0:12}. No se reinició PM2."
  echo '› Comprobando publicación actual (solo lectura)…'
  bash scripts/verificar-publicacion.sh
  exit 0
fi

echo '› Creando respaldo ANTES de modificar código o reiniciar WhatsApp…'
bash scripts/backup.sh

# La reversión AUTOMÁTICA solo afecta código y dependencias.
# Restaurar datos de PostgreSQL requiere un procedimiento manual supervisado.
REINICIADO=0
recuperar(){
  codigo="$?"
  trap - ERR
  echo '✖ Falló la actualización de IMPAR; restaurando código anterior.' >&2
  echo '  Aviso: las migraciones ya confirmadas en PostgreSQL NO se revierten automáticamente.' >&2
  if [[ "$(git rev-parse HEAD)" != "$ANTES_SHA" ]]; then
    git reset --hard "$ANTES_SHA" || true
    npm ci --omit=dev || true
    node scripts/patch-baileys-lid.mjs || true
  fi
  if [[ "$REINICIADO" == 1 ]]; then
    pm2 reload iciia-crm --update-env || true
    pm2 save >/dev/null || true
  fi
  echo "  Código restaurado: $(git rev-parse --short=12 HEAD)" >&2
  exit "$codigo"
}
trap recuperar ERR

echo '› Aplicando únicamente fast-forward de GitHub…'
git merge --ff-only "$DESTINO_SHA"
DESPUES="$(git rev-parse --short=12 HEAD)"
echo "  Revisión: ${ANTES_SHA:0:12} → $DESPUES"

echo '› Instalando dependencias…'
npm ci --omit=dev
echo '› Compatibilidad WhatsApp (sin borrar auth ni vinculación)…'
node scripts/patch-baileys-lid.mjs

echo '› Ejecutando verificaciones obligatorias…'
node scripts/verificar.mjs
node scripts/test-ayudas.mjs
node scripts/test-horarios.mjs
node scripts/test-login.mjs
node scripts/test-canales-estables.mjs
node scripts/test-pausa-bot.mjs
node scripts/test-recepcion-sucursales.mjs
node scripts/test-catalogos-impar.mjs
node scripts/test-importar-bitrix.mjs
node scripts/test-accesos.mjs
node scripts/test-eliminar-usuario.mjs
node scripts/test-historial-chat.mjs
node scripts/test-wa-reintentos.mjs
node scripts/test-principal-contactos.mjs
node scripts/test-telefonos-impar.mjs
node scripts/test-busqueda-contactos.mjs
node scripts/test-ficha360-cierre.mjs
node scripts/test-chat-amplio.mjs
node scripts/test-enlaces-chat.mjs
node scripts/test-central-unica-impar.mjs
node scripts/test-publicacion-central.mjs
bash -n scripts/verificar-publicacion-central.sh

echo '› Ejecutando migraciones atómicas en PostgreSQL ANTES de reiniciar PM2…'
node --input-type=module -e '
  import "dotenv/config";
  import {migrar,pool} from "./src/db.mjs";
  try { await migrar(); console.log("✔ Migraciones PostgreSQL confirmadas"); }
  finally { await pool.end(); }
'

echo '› Reiniciando una sola instancia PM2 de IMPAR…'
REINICIADO=1
pm2 reload iciia-crm --update-env

PORT_ACTUAL="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
PORT_ACTUAL="${PORT_ACTUAL:-3000}"
PASO=0
CORRECTO=0
echo '› Verificando revisión exacta, PostgreSQL y autenticación…'
while [[ "$PASO" -lt 30 ]]; do
  PASO=$((PASO+1))
  SALUD="$(curl --max-time 4 -fsS "http://127.0.0.1:${PORT_ACTUAL}/api/health" 2>/dev/null || true)"
  ACCESO="$(curl --max-time 4 -fsS "http://127.0.0.1:${PORT_ACTUAL}/api/login/health" 2>/dev/null || true)"
  if [[ "$SALUD" == *"\"ok\":true"* && "$SALUD" == *"\"build\":\"$DESPUES\""* &&
        "$ACCESO" == *"\"ok\":true"* && "$ACCESO" == *"\"build\":\"$DESPUES\""* ]]; then
    HTTP_LOGIN="$(curl --max-time 5 -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"usuario":"__verificar_impar__","password":"__prueba__"}' "http://127.0.0.1:$PORT_ACTUAL/api/login" 2>/dev/null || true)"
    if [[ "$HTTP_LOGIN" == 401 ]]; then CORRECTO=1; break; fi
  fi
  sleep 2
done
if [[ "$CORRECTO" != 1 ]]; then
  echo '✖ Falló health/login de la revisión nueva. Consultá PM2 y PostgreSQL.' >&2
  false
fi
pm2 save >/dev/null
trap - ERR
echo "✔ IMPAR operativo en Hostinger: $DESPUES y autenticación verificada."

echo '› Verificando lo servido públicamente en crm.iciia.tech…'
PUBLICO_OK=0
for INTENTO in 1 2 3; do
  if bash scripts/verificar-publicacion.sh; then PUBLICO_OK=1; break; fi
  [[ "$INTENTO" == 3 ]] || sleep 5
done
if [[ "$PUBLICO_OK" != 1 ]]; then
  echo '⚠ El servidor local está operativo, pero la publicación pública no coincide.' >&2
  echo '  Por seguridad, NO se restaura un servidor saludable por fallo de caché/proxy.' >&2
  echo '  Revisá scripts/verificar-publicacion.sh y la configuración de Nginx/Hostinger.' >&2
  exit 2
fi
echo '✔ Actualización IMPAR terminada. Faltan pruebas funcionales con agente/WhatsApp.'
