#!/usr/bin/env bash
# Respaldo de base de datos, sesiones de WhatsApp y archivos adjuntos
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
DIR="./backups"; mkdir -p "$DIR"
FECHA="$(date +%Y%m%d_%H%M)"
set -a; source <(grep '^DATABASE_URL=' .env); set +a
pg_dump "$DATABASE_URL" | gzip > "$DIR/db_${FECHA}.sql.gz"
[ -d auth ]  && tar czf "$DIR/auth_${FECHA}.tar.gz" auth
[ -d media ] && tar czf "$DIR/media_${FECHA}.tar.gz" media
find "$DIR" -name '*.gz' -mtime +14 -delete
echo "✔ Respaldo en $DIR/db_${FECHA}.sql.gz"
