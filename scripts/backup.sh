#!/usr/bin/env bash
# IMPAR · respaldos ANTES del despliegue. Nunca incluye archivos en Git.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
umask 077

DIR="./backups"; mkdir -p "$DIR"
FECHA="$(date +%Y%m%d_%H%M%S)_$$"
ARCHIVO="$DIR/db_${FECHA}.sql.gz"
TEMP="$ARCHIVO.tmp"
limpiar() { rm -f "$TEMP"; }
trap limpiar EXIT

if [[ ! -f .env ]]; then
  echo '✖ Falta .env: no se puede verificar la base que se respaldará.' >&2
  exit 1
fi
set -a
# La base indicada por DATABASE_URL es la de ESTA instancia, no NOVA.
source <(grep '^DATABASE_URL=' .env)
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo '✖ DATABASE_URL no está configurada; respaldo cancelado.' >&2
  exit 1
fi
echo '› Respaldando PostgreSQL de IMPAR…'
pg_dump "$DATABASE_URL" | gzip -c > "$TEMP"
gzip -t "$TEMP"
[[ -s "$TEMP" ]] || { echo '✖ Respaldo vacío; abortando actualización.' >&2; exit 1; }
mv "$TEMP" "$ARCHIVO"
chmod 600 "$ARCHIVO"
# Variables de producción: copia privada en VPS; nunca se suben a GitHub.
cp -- .env "$DIR/env_${FECHA}.backup"
chmod 600 "$DIR/env_${FECHA}.backup"

if [[ -d auth ]]; then
  tar czf "$DIR/auth_${FECHA}.tar.gz" auth
  chmod 600 "$DIR/auth_${FECHA}.tar.gz"
fi
if [[ -d media ]]; then
  tar czf "$DIR/media_${FECHA}.tar.gz" media
  chmod 600 "$DIR/media_${FECHA}.tar.gz"
fi
# Conservar respaldo al menos 14 días. Borrar antiguos solo al completar uno nuevo.
find "$DIR" -type f \( -name 'db_*.sql.gz' -o -name 'auth_*.tar.gz' -o -name 'media_*.tar.gz' -o -name 'env_*.backup' \) -mtime +14 -delete

echo "✔ Respaldo íntegro y verificado: $ARCHIVO"
