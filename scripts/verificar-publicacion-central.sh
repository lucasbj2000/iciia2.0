#!/usr/bin/env bash
# IMPAR / verificación POSDESPLIEGUE. No cambia datos, sesiones ni WhatsApp.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO="$(git remote get-url origin)"
if ! [[ "$REPO" == *'lucasbj2000/iciia2.0'* ]]; then
  echo "✖ No estás en el repositorio IMPAR."; exit 1
fi

SHA="$(git rev-parse --short=12 HEAD)"
RUTA="https://crm.iciia.tech"
MARCA='name="impar-ui-build" content="busqueda-principal-20261019-3"'
IMPORT="import { vistaContactos } from './contactos.js?v=impar-busqueda-principal-20261019-3';"
ANTIGUO="No hay líneas WhatsApp habilitadas para tu sucursal"
AVISO="Seleccionar..."
CHECK_DIR="$(mktemp -d)"
trap 'rm -rf "$CHECK_DIR"' EXIT

echo "› Verificando archivos locales IMPAR ($SHA)…"
grep -Fq "$MARCA" public/index.html || { echo "✖ index.html antiguo. No se ha actualizado este directorio."; exit 1; }
grep -Fq "$IMPORT" public/js/app.js || { echo "✖ app.js no importa el nuevo formulario."; exit 1; }
grep -Fq 'type="hidden" id="c-chat-canal"' public/js/contactos.js || {
 echo "✖ Contactos sigue mostrando el selector antiguo."; exit 1; }
if grep -Fq "$ANTIGUO" public/js/contactos.js; then
  echo "✖ Contactos contiene el aviso antiguo."; exit 1
fi

echo "› Consultando versión y archivos servidos al público (sin iniciar sesión)…"
CURL_ARGS=(--fail --silent --show-error --location --max-time 15
  --header 'Cache-Control: no-cache' --header 'Pragma: no-cache')

if ! curl "${CURL_ARGS[@]}" "$RUTA/api/health?impar_ver=$SHA" > "$CHECK_DIR/health"; then
  echo "✖ La API pública no respondió. Revisá HTTPS / proxy / VPS."; exit 1
fi
if ! node -e "
 const fs=require('node:fs');
 let r;
 try {r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'))}catch{process.exit(2)}
 if(!r.ok || r.build!==process.argv[2]) process.exit(1);
 " "$CHECK_DIR/health" "$SHA"; then
  echo "✖ La URL pública ejecuta una revisión del servidor DIFERENTE a $SHA."
  echo "  Revisá PM2, la ruta de la app y el destino de Nginx/Hostinger."; exit 1
fi
if ! curl "${CURL_ARGS[@]}" "$RUTA/?impar_ver=$SHA" > "$CHECK_DIR/index"; then
  echo "✖ No respondió la página pública."; exit 1
fi
if ! grep -Fq "$MARCA" "$CHECK_DIR/index"; then
  echo "✖ La web pública entrega un index.html ANTIGUO aunque la API esté actualizada."
  echo "  Revisá caché de Hostinger/CDN/Nginx o el root de la web."; exit 1
fi
if ! curl "${CURL_ARGS[@]}" "$RUTA/js/app.js?v=impar-busqueda-principal-20261019-3" > "$CHECK_DIR/app"; then
  echo "✖ No está accesible el módulo JS público."; exit 1
fi
if ! grep -Fq "$IMPORT" "$CHECK_DIR/app"; then
  echo "✖ app.js servido al público es ANTIGUO. Revisá caché/CDN."; exit 1
fi
if ! curl "${CURL_ARGS[@]}" "$RUTA/js/contactos.js?v=impar-busqueda-principal-20261019-3" > "$CHECK_DIR/contactos"; then
  echo "✖ No está accesible el módulo Contactos."; exit 1
fi
if ! grep -Fq 'type="hidden" id="c-chat-canal"' "$CHECK_DIR/contactos" ||
  grep -Fq "$ANTIGUO" "$CHECK_DIR/contactos"; then
  echo "✖ El JS de Contactos servido al público tiene el selector antiguo."; exit 1
fi

echo "✔ IMPAR ($SHA) PUBLICADO correctamente: backend, HTML y JS actualizados."
echo "✔ El formulario público ya no ofrece selección de líneas por sucursal."
echo "  Comprobación pendiente con usuario autenticado: iniciar conversación de prueba."
