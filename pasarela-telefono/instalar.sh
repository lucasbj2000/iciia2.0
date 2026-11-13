#!/usr/bin/env bash
# Instala la pasarela telefónica IMPAR en Raspberry Pi OS (Trixie) o Debian 13 / Ubuntu 25.04+.
# Correr como el usuario normal (NO root):  bash instalar.sh
set -euo pipefail
if [ "$(id -u)" = "0" ]; then echo "Corré este script con tu usuario normal, no como root."; exit 1; fi
DESTINO="$HOME/pasarela-telefono"
ORIGEN="$(cd "$(dirname "$0")" && pwd)"
echo "1/5 Instalando paquetes del sistema (pide la contraseña de sudo)…"
sudo apt-get update -qq
sudo apt-get install -y -qq pipewire pipewire-pulse wireplumber libspa-0.2-bluetooth pulseaudio-utils bluez nodejs npm
V=$(pipewire --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo 0)
if [ "$(printf '%s\n1.4\n' "$V" | sort -V | head -1)" != "1.4" ]; then
  echo "Atención: PipeWire $V es anterior a 1.4 y no trae telefonía Bluetooth. Usá Raspberry Pi OS Trixie o Debian 13."; exit 1
fi
N=$(node -v | grep -oE '[0-9]+' | head -1); if [ "$N" -lt 20 ]; then echo "Se necesita Node.js 20 o superior (tenés $(node -v))."; exit 1; fi
echo "2/5 Copiando el programa a $DESTINO…"
mkdir -p "$DESTINO"; cp -r "$ORIGEN"/{pasarela.mjs,lib,package.json,pasarela.env.ejemplo} "$DESTINO"/
cd "$DESTINO" && npm install --omit=dev --no-audit --no-fund -s
[ -f pasarela.env ] || { cp pasarela.env.ejemplo pasarela.env; chmod 600 pasarela.env; }
echo "3/5 Dejando el servicio de usuario activo aunque nadie inicie sesión…"
sudo loginctl enable-linger "$USER"
mkdir -p "$HOME/.config/systemd/user" && cp "$ORIGEN/pasarela-telefono.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
echo "4/5 Listo. Ahora:"
echo "   a) Emparejá el celular:  bluetoothctl  →  power on · agent on · scan on · pair XX:XX… · trust XX:XX… · connect XX:XX…"
echo "   b) Pegá el token del CRM en $DESTINO/pasarela.env  (nano $DESTINO/pasarela.env)"
echo "   c) Probá:  cd $DESTINO && node pasarela.mjs --probar"
echo "5/5 Cuando la prueba diga que todo está bien:  systemctl --user enable --now pasarela-telefono"
