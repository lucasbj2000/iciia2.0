#!/usr/bin/env bash
# Actualiza el CRM desde GitHub y confirma exactamente qué revisión quedó en producción.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ANTES="$(git rev-parse --short=12 HEAD 2>/dev/null || echo desconocido)"

echo "› Descargando cambios…"
git pull --ff-only

DESPUES="$(git rev-parse --short=12 HEAD)"
echo "  Revisión: ${ANTES} → ${DESPUES}"

echo "› Instalando dependencias…"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

echo "› Aplicando compatibilidad WhatsApp LID/PN…"
node scripts/patch-baileys-lid.mjs

echo "› Verificando el código…"
node scripts/verificar.mjs

echo "› Reiniciando…"
pm2 reload iciia-crm --update-env
pm2 save >/dev/null

# Espera breve para que Express termine migraciones y vuelva a escuchar.
sleep 2

PORT_ACTUAL="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
PORT_ACTUAL="${PORT_ACTUAL:-3000}"

echo "› Confirmando versión en ejecución…"
HEALTH="$(curl -fsS "http://127.0.0.1:${PORT_ACTUAL}/api/health")"
echo "  ${HEALTH}"

if [[ "${HEALTH}" != *"\"build\":\"${DESPUES}\""* ]]; then
  echo "✖ El proceso respondió, pero el build activo no coincide con Git: ${DESPUES}" >&2
  exit 1
fi

echo "✔ Actualizado y confirmado en ${DESPUES}. Las migraciones de base corren solas al arrancar."
