#!/usr/bin/env bash
# Actualiza el CRM desde GitHub sin downtime perceptible
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "› Descargando cambios…"
git pull --ff-only

echo "› Instalando dependencias…"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

echo "› Aplicando compatibilidad WhatsApp LID/PN…"
node scripts/patch-baileys-lid.mjs

echo "› Verificando el código…"
node scripts/verificar.mjs

echo "› Reiniciando…"
pm2 reload iciia-crm --update-env
pm2 save >/dev/null

echo "✔ Actualizado. Las migraciones de base corren solas al arrancar."
