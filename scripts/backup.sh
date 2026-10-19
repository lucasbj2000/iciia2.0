#!/usr/bin/env bash
# IMPAR · respaldos ANTES del despliegue. Nunca incluye archivos en Git.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
umask 077

DIR="./backups"; mkdir -p "$DIR"
FECHA="$(date +%Y%m%d_%H%M%S)_$$"
ARCHIVO="$DIR/db_${FECHA}.sql.gz"
TEMP="$ARCHIVO.tmp"
MEDIA_TEMP="$DIR/.media_${FECHA}.tar.gz.tmp"
MEDIA_LOG="$DIR/.media_${FECHA}.log.tmp"
AUTH_TEMP="$DIR/.auth_${FECHA}.tar.gz.tmp"
limpiar() { rm -f "$TEMP" "$MEDIA_TEMP" "$MEDIA_LOG" "$AUTH_TEMP"; }
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

# Credenciales WhatsApp: respaldo OBLIGATORIO. No aceptar advertencias ni
# archivos incompletos. Guardar con nombre final solo tras comprobar el tar.
if [[ -d auth ]]; then
  echo '› Respaldando credenciales WhatsApp…'
  AUTH_OK=0
  for INTENTO in 1 2 3; do
    if tar czf "$AUTH_TEMP" auth; then
      tar -tzf "$AUTH_TEMP" >/dev/null
      mv "$AUTH_TEMP" "$DIR/auth_${FECHA}.tar.gz"
      chmod 600 "$DIR/auth_${FECHA}.tar.gz"
      AUTH_OK=1
      break
    fi
    if [[ "$INTENTO" -lt 3 ]]; then
      echo "⚠ Credenciales activas durante respaldo; reintentando ($INTENTO/3)…" >&2
      sleep 1
    fi
  done
  if [[ "$AUTH_OK" != 1 ]]; then
    echo '✖ No se pudo respaldar íntegramente la sesión WhatsApp. Se canceló el despliegue.' >&2
    exit 1
  fi
fi

# El CRM puede recibir audios/fotos durante todo el día. GNU tar devuelve 1
# si detecta únicamente "file changed as we read it". No confundir ese caso
# con permisos insuficientes, archivos desaparecidos o corrupción del tar.
# Los archivos fuente siguen intactos. Un archive "en_vivo" es BEST-EFFORT
# y nunca se anuncia como copia íntegra/restaurable de ese preciso instante.
MEDIA_COMPLETA=1
if [[ -d media ]]; then
  echo '› Respaldando multimedia activa (sin detener recepción)…'
  MEDIA_COMPLETA=0
  for INTENTO in 1 2; do
    : > "$MEDIA_LOG"
    if tar czf "$MEDIA_TEMP" media 2>"$MEDIA_LOG"; then
      tar -tzf "$MEDIA_TEMP" >/dev/null
      mv "$MEDIA_TEMP" "$DIR/media_${FECHA}.tar.gz"
      chmod 600 "$DIR/media_${FECHA}.tar.gz"
      MEDIA_COMPLETA=1
      break
    else
      TAR_ESTADO="$?"
      CAMBIOS=0
      OTROS_ERRORES=0
      while IFS= read -r LINEA || [[ -n "$LINEA" ]]; do
        case "$LINEA" in
          "tar: media/"*": file changed as we read it")
            CAMBIOS=$((CAMBIOS+1)) ;;
          "tar: Exiting with failure status due to previous errors")
            : ;;
          *) OTROS_ERRORES=1 ;;
        esac
      done < "$MEDIA_LOG"
      if [[ "$TAR_ESTADO" != 1 || "$CAMBIOS" -eq 0 || "$OTROS_ERRORES" -ne 0 ]]; then
        echo '✖ Error de multimedia distinto a archivo modificado; no se continuará.' >&2
        cat "$MEDIA_LOG" >&2
        exit 1
      fi
      if ! tar -tzf "$MEDIA_TEMP" >/dev/null; then
        echo '✖ El respaldo multimedia está dañado y no se utilizará.' >&2
        exit 1
      fi
      if [[ "$INTENTO" -eq 1 ]]; then
        echo '⚠ Algunos archivos multimedia cambiaron durante la lectura; reintentando…' >&2
        sleep 1
      else
        mv "$MEDIA_TEMP" "$DIR/media_en_vivo_${FECHA}.tar.gz"
        chmod 600 "$DIR/media_en_vivo_${FECHA}.tar.gz"
        echo '⚠ Multimedia: copia EN VIVO parcial (puede omitir cambios concurrentes).' >&2
        echo '  La base de datos y auth están respaldadas; media/ original permanece intacto.' >&2
        echo '  Se conservarán los respaldos multimedia íntegros anteriores.' >&2
      fi
    fi
  done
fi

# No descartar el último respaldo multimedia íntegro cuando el nuevo ha sido parcial.
find "$DIR" -type f \( -name 'db_*.sql.gz' -o -name 'auth_*.tar.gz' -o -name 'env_*.backup' -o -name 'media_en_vivo_*.tar.gz' \) -mtime +14 -delete
if [[ "$MEDIA_COMPLETA" == 1 ]]; then
  find "$DIR" -type f -name 'media_*.tar.gz' -mtime +14 -delete
fi

echo "✔ Respaldo PostgreSQL verificado: $ARCHIVO"
if [[ "$MEDIA_COMPLETA" == 0 ]]; then
  echo '⚠ Respaldo multimedia en vivo con advertencias; usar otro respaldo íntegro si hace falta restaurar.' >&2
else
  echo '✔ Respaldo de archivos y credenciales completado.'
fi
