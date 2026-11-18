#!/usr/bin/env bash
# Instala la pasarela en MODO CENTRAL en el servidor del CRM (se registra como un interno de la central IP).
# Uso, en el servidor:  bash /opt/iciia-crm/pasarela-telefono/instalar-central.sh
# Qué hace: instala las dependencias de la pasarela en esta carpeta, crea pasarela.env (permisos 600)
# si no existe y, si el firewall «ufw» está activo, abre el puerto SIP local y el rango de audio (UDP).
# No arranca nada ni toca el CRM.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
N=$(node -v | grep -oE '[0-9]+' | head -1); if [ "$N" -lt 20 ]; then echo "Se necesita Node.js 20 o superior (tenés $(node -v))."; exit 1; fi
echo "1/3 Instalando dependencias de la pasarela en $DIR…"
npm install --omit=dev --no-audit --no-fund -s
if [ ! -f pasarela.env ]; then
  cp pasarela.env.ejemplo pasarela.env; chmod 600 pasarela.env
  sed -i 's#^CRM_URL=.*#CRM_URL=https://crm.iciia.tech#; s/^# PASARELA_MODO=central/PASARELA_MODO=central/; s/^# SIP_SERVIDOR=/SIP_SERVIDOR=/; s/^# SIP_PUERTO=7560/SIP_PUERTO=7560/; s/^# SIP_USUARIO=/SIP_USUARIO=/; s/^# SIP_CLAVE=/SIP_CLAVE=/; s/^# SIP_PUERTO_LOCAL=/SIP_PUERTO_LOCAL=/; s/^# RTP_PUERTO_DESDE=/RTP_PUERTO_DESDE=/; s/^# RTP_PUERTO_HASTA=/RTP_PUERTO_HASTA=/' pasarela.env
  echo "2/3 Se creó pasarela.env con el modo central."
else echo "2/3 pasarela.env ya existe: no se toca."; fi
LOCAL=$(grep -E '^SIP_PUERTO_LOCAL=' pasarela.env | cut -d= -f2); LOCAL=${LOCAL:-5062}
DESDE=$(grep -E '^RTP_PUERTO_DESDE=' pasarela.env | cut -d= -f2); DESDE=${DESDE:-40000}
HASTA=$(grep -E '^RTP_PUERTO_HASTA=' pasarela.env | cut -d= -f2); HASTA=${HASTA:-40100}
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "$LOCAL"/udp comment 'IMPAR pasarela SIP' >/dev/null; ufw allow "$DESDE:$HASTA"/udp comment 'IMPAR pasarela audio' >/dev/null
  echo "3/3 Firewall: abiertos $LOCAL/udp y $DESDE-$HASTA/udp."
else echo "3/3 ufw no está activo: si el proveedor del servidor tiene un firewall propio, abrí ahí $LOCAL/udp y $DESDE-$HASTA/udp."; fi
echo
echo "Ahora:"
echo "  a) Completá el token del CRM y la contraseña del interno:  nano $DIR/pasarela.env"
echo "  b) Probá sin llamar a nadie:  cd $DIR && node pasarela.mjs --probar"
echo "  c) Dejala funcionando:  pm2 start $DIR/pasarela.mjs --name pasarela-central --cwd $DIR && pm2 save"
