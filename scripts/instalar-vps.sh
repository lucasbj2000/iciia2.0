#!/usr/bin/env bash
# ============================================================
# iciia2.0 · Instalador para VPS Ubuntu (Hostinger)
# Uso:  sudo bash scripts/instalar-vps.sh tu-dominio.com tu@email.com
# ============================================================
set -euo pipefail

DOMINIO="${1:-}"
EMAIL="${2:-}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="iciia_crm"
DB_USER="iciia"

azul()  { echo -e "\033[1;34m› $*\033[0m"; }
verde() { echo -e "\033[1;32m✔ $*\033[0m"; }
rojo()  { echo -e "\033[1;31m✖ $*\033[0m"; }

[ -z "$DOMINIO" ] && { rojo "Uso: sudo bash scripts/instalar-vps.sh tu-dominio.com tu@email.com"; exit 1; }
[ "$EUID" -ne 0 ] && { rojo "Ejecutá con sudo."; exit 1; }

azul "Actualizando el sistema"
apt-get update -qq && apt-get upgrade -y -qq

azul "Instalando Node.js 20 LTS, PostgreSQL y Nginx"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y postgresql postgresql-contrib nginx certbot python3-certbot-nginx git ufw build-essential
npm install -g pm2 >/dev/null 2>&1 || true
verde "Node $(node -v) · npm $(npm -v)"

azul "Configurando el firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
verde "Firewall activo (solo SSH, HTTP y HTTPS)"

azul "Creando la base de datos"
DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" >/dev/null
verde "Base ${DB_NAME} lista"

azul "Instalando dependencias de la aplicación"
cd "$APP_DIR"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev
mkdir -p auth logs media

CREADO=0
if [ ! -f .env ]; then
  azul "Generando .env"
  JWT="$(openssl rand -base64 48 | tr -d '\n')"
  VERIFY="$(openssl rand -hex 16)"
  ADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | head -c 18)"
  cat > .env <<EOF
PORT=3000
NODE_ENV=production
PUBLIC_URL=https://${DOMINIO}
DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
PG_POOL_MAX=10
JWT_SECRET=${JWT}
JWT_EXPIRA=12h
CORS_ORIGIN=https://${DOMINIO}
ADMIN_USER=admin
ADMIN_PASS=${ADMIN_PASS}
SEED_DEMO=false
MEDIA_DIR=./media
MAX_UPLOAD_MB=16
WA_AUTH_DIR=./auth
PREFIJO_PAIS=595
GRAPH_VERSION=v21.0
META_VERIFY_TOKEN=${VERIFY}
META_APP_SECRET=
EOF
  chmod 600 .env
  CREADO=1
fi

azul "Configurando Nginx"
cat > /etc/nginx/sites-available/iciia <<EOF
server {
  listen 80;
  server_name ${DOMINIO};
  client_max_body_size 32M;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection '';
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 300s;
    proxy_buffering off;          # imprescindible para el stream SSE
    chunked_transfer_encoding off;
  }
}
EOF
ln -sf /etc/nginx/sites-available/iciia /etc/nginx/sites-enabled/iciia
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null && systemctl reload nginx
verde "Nginx configurado"

azul "Arrancando la aplicación con PM2"
pm2 delete iciia-crm >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
verde "Aplicación corriendo"

azul "Emitiendo certificado SSL"
if certbot --nginx -d "${DOMINIO}" --non-interactive --agree-tos \
   ${EMAIL:+-m "$EMAIL"} ${EMAIL:---register-unsafely-without-email} --redirect; then
  verde "HTTPS activo"
else
  rojo "No se pudo emitir el certificado. Verificá que el dominio apunte a este servidor y reintentá:"
  echo "    certbot --nginx -d ${DOMINIO}"
fi

echo
verde "════════════════════════════════════════════"
verde " Instalación completada"
verde "════════════════════════════════════════════"
echo
echo "  URL:      https://${DOMINIO}"
echo "  Empresa:  admin"
echo "  Usuario:  admin"
if [ "$CREADO" = "1" ]; then
  echo "  Clave:    $(grep '^ADMIN_PASS=' .env | cut -d= -f2)"
  echo
  echo "  ⚠ Guardá esa contraseña ahora y cambiala al entrar."
  echo "  Token de webhook de Meta: $(grep '^META_VERIFY_TOKEN=' .env | cut -d= -f2)"
fi
echo
echo "  Webhook para Meta: https://${DOMINIO}/webhook/meta"
echo "  Logs:              pm2 logs iciia-crm"
echo "  Reiniciar:         pm2 restart iciia-crm"
echo
