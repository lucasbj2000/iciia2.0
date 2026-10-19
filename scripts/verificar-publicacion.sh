#!/usr/bin/env bash
# IMPAR · verificar la versión REAL publicada; no cambia datos ni sesiones.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ORIGEN="$(git remote get-url origin)"
if ! printf '%s' "$ORIGEN" | grep -Eq 'lucasbj2000/iciia2[.]0([.]git)?$'; then
  echo '✖ Repositorio equivocado; verificación exclusiva de IMPAR.' >&2; exit 1
fi
RUTA="${IMPAR_PUBLIC_URL:-https://crm.iciia.tech}"
SHA="$(git rev-parse --short=12 HEAD)"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
ARGS=(--fail --silent --show-error --location --max-time 15
  --header 'Cache-Control: no-cache' --header 'Pragma: no-cache')
echo "› Comprobando dominio público de IMPAR: ${RUTA} ($SHA)…"

curl "${ARGS[@]}" "$RUTA/api/health?ver=$SHA" > "$TEMP/health"
node - "$TEMP/health" "$SHA" <<'NODE'
const fs=require('node:fs');
const [archivo,sha]=process.argv.slice(2);
let v;try{v=JSON.parse(fs.readFileSync(archivo,'utf8'))}catch(e){
  console.error('✖ La respuesta /api/health no es JSON válido.');process.exit(1);
}
if(v.ok!==true||v.build!==sha){
  console.error('✖ Revisión pública distinta del código local: '+(v.build||'desconocida')+' ≠ '+sha);
  process.exit(1);
}
NODE

# Revisar CONTENIDO y no solo nombres/versiones que pueden permanecer iguales.
for ARCHIVO in index.html js/app.js js/contactos.js; do
  LOCAL="public/$ARCHIVO"
  case "$ARCHIVO" in
    index.html) URL="$RUTA/?ver=$SHA" ;;
    *) URL="$RUTA/$ARCHIVO?ver=$SHA" ;;
  esac
  curl "${ARGS[@]}" "$URL" > "$TEMP/respuesta"
  if ! cmp -s "$LOCAL" "$TEMP/respuesta"; then
    echo "✖ La URL pública entrega $ARCHIVO diferente del código local." >&2
    echo '  Revisá raíz Nginx, caché de Hostinger/CDN y service workers.' >&2
    exit 1
  fi
  echo "  ✔ $ARCHIVO coincide exactamente"
done

if grep -Fq 'No hay líneas WhatsApp habilitadas para tu sucursal' "$TEMP/respuesta"; then
  echo '✖ El formulario antiguo de selección de WhatsApp volvió a publicarse.' >&2
  exit 1
fi
echo "✔ IMPAR ($SHA) PUBLICADO: backend, HTML y JS coinciden exactamente."
echo '  Falta comprobar el flujo operativo con un agente y WhatsApp real.'
