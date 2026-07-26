#!/usr/bin/env bash
# ---------------------------------------------------------------
# One-shot deploy script for Ba Man Bebin on a fresh Ubuntu/Debian VPS.
#
#   sudo bash deploy/deploy.sh example.com you@example.com
#
# It will:
#   1. install Node.js 22 + nginx + certbot (if missing)
#   2. copy the app to /var/www/ba-man-bebin
#   3. install a systemd service and start it
#   4. configure nginx as a reverse proxy (with WebSocket support)
#   5. request a Let's Encrypt certificate
# ---------------------------------------------------------------
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
APP_DIR="/var/www/ba-man-bebin"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash deploy/deploy.sh <domain> [email]"
  exit 1
fi

log() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }

log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates nginx >/dev/null

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 18 ]]; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

log "Copying application to $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'deploy/certbot' \
  "$SRC_DIR"/ "$APP_DIR"/

log "Installing production dependencies"
cd "$APP_DIR"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s|PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=https://$DOMAIN|" "$APP_DIR/.env"
fi

chown -R www-data:www-data "$APP_DIR"

log "Installing systemd service"
install -m 644 "$APP_DIR/deploy/ba-man-bebin.service" /etc/systemd/system/ba-man-bebin.service
systemctl daemon-reload
systemctl enable --now ba-man-bebin
systemctl restart ba-man-bebin

log "Configuring nginx for $DOMAIN"
NGINX_CONF="/etc/nginx/sites-available/ba-man-bebin"
sed -e "s/example.com/$DOMAIN/g" \
    -e "s|server app:3000;|server 127.0.0.1:3000;|" \
    "$APP_DIR/deploy/nginx.conf" > "$NGINX_CONF"

# Before the certificate exists, serve plain HTTP only.
if [[ ! -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  cat > "$NGINX_CONF" <<EOF
upstream bmb_app { server 127.0.0.1:3000; keepalive 32; }
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location /socket.io/ {
        proxy_pass http://bmb_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
    }
    location / {
        proxy_pass http://bmb_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
fi

mkdir -p /var/www/certbot
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ba-man-bebin
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if [[ -n "$EMAIL" ]]; then
  log "Requesting Let's Encrypt certificate"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos -m "$EMAIL" --redirect || \
    echo "⚠ certbot failed — check that DNS points to this server, then run: certbot --nginx -d $DOMAIN"
fi

log "Done!"
echo "  Service : systemctl status ba-man-bebin"
echo "  Logs    : journalctl -u ba-man-bebin -f"
echo "  Site    : http${EMAIL:+s}://$DOMAIN"
