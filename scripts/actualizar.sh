#!/usr/bin/env bash
# IMPAR · Protocolo 002. Despliegue con verificación real de login y recuperación segura.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

RUTA="$(pwd)"
ORIGEN="$(git remote get-url origin)"
if ! printf '%s' "$ORIGEN" | grep -Eq 'lucasbj2000/iciia2[.]0([.]git)?$'; then
  echo '✖ Repositorio incorrecto; este script solo actualiza IMPAR.' >&2; exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo '✖ Hay cambios locales versionados; no se actualizará para evitar sobrescribirlos.' >&2; exit 1
fi

ANTES_SHA="${IMPAR_BASE_SHA:-$(git rev-parse HEAD)}"
git cat-file -e "${ANTES_SHA}^{commit}" || { echo '✖ SHA anterior no válido' >&2; exit 1; }
if ! git merge-base --is-ancestor "$ANTES_SHA" HEAD; then
  echo '✖ El SHA anterior no corresponde al historial actual.' >&2; exit 1
fi

echo '› Descargando el commit de IMPAR…'
git pull --ff-only origin main
DESPUES="$(git rev-parse --short=12 HEAD)"
echo "  Revisión: ${ANTES_SHA:0:12} → $DESPUES"

# Se activa la recuperación únicamente después de confirmar el repositorio.
REINICIADO=0
recuperar() {
  codigo="$?"
  trap - ERR
  echo '✖ Falló la actualización/verificación. Se restaurará el commit anterior.' >&2
  if [[ "$(git rev-parse HEAD)" != "$ANTES_SHA" ]]; then
    git reset --hard "$ANTES_SHA" || true
    npm ci --omit=dev || true
    node scripts/patch-baileys-lid.mjs || true
  fi
  if [[ "$REINICIADO" = 1 ]]; then
    pm2 reload iciia-crm --update-env || true
    pm2 save >/dev/null || true
  fi
  echo "  Revisión restaurada: $(git rev-parse --short=12 HEAD)" >&2
  exit "$codigo"
}
trap recuperar ERR

echo '› Instalando dependencias…'
npm ci --omit=dev
echo '› Compatibilidad WhatsApp…'
node scripts/patch-baileys-lid.mjs
echo '› Ejecutando verificaciones obligatorias…'
node scripts/verificar.mjs
node scripts/test-ayudas.mjs
node scripts/test-horarios.mjs
node scripts/test-login.mjs

echo '› Reiniciando el CRM…'
REINICIADO=1
pm2 reload iciia-crm --update-env

PORT_ACTUAL="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
PORT_ACTUAL="${PORT_ACTUAL:-3000}"
PASO=0
CORRECTO=0
echo '› Verificando servicio y circuito de autenticación…'
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
  echo '✖ El nuevo servidor no confirmó el circuito de login. Revisá PM2 y PostgreSQL.' >&2
  false
fi
pm2 save >/dev/null
trap - ERR
echo "✔ IMPAR operativo: revisión $DESPUES, base de datos y autenticación confirmadas."
