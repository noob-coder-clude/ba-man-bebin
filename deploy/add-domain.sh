#!/usr/bin/env bash
# ---------------------------------------------------------------
# Point an additional domain at an existing Ba Man Bebin server.
#
#   sudo bash deploy/add-domain.sh newdomain.com you@example.com
#
# Every domain added this way is served by the SAME Node process, so rooms,
# chat and playback state are shared — visitors just use whichever domain is
# reachable for them. Nothing is duplicated, nothing is redirected.
#
# Before running: point the domain's A record at this server's IP.
# ---------------------------------------------------------------
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
APP_DIR="/var/www/ba-man-bebin"
ENV_FILE="$APP_DIR/.env"
NGINX_CONF="/etc/nginx/sites-available/ba-man-bebin"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash deploy/add-domain.sh <domain> [email]"
  exit 1
fi

log() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }

if [[ ! -f "$NGINX_CONF" ]]; then
  echo "✗ $NGINX_CONF not found — run deploy/deploy.sh first."
  exit 1
fi

log "Adding $DOMAIN to nginx server_name"
# Append the domain to every server_name line that doesn't already have it.
if ! grep -q "$DOMAIN" "$NGINX_CONF"; then
  sed -i "s/^\(\s*server_name\s\+.*\);/\1 $DOMAIN www.$DOMAIN;/" "$NGINX_CONF"
fi
nginx -t && systemctl reload nginx

log "Registering $DOMAIN in PUBLIC_DOMAINS"
touch "$ENV_FILE"
CURRENT="$(grep -E '^PUBLIC_DOMAINS=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"

if [[ -z "$CURRENT" ]]; then
  UPDATED="$DOMAIN"
elif [[ ",$CURRENT," == *",$DOMAIN,"* ]]; then
  UPDATED="$CURRENT"
else
  UPDATED="$CURRENT,$DOMAIN"
fi

if grep -qE '^PUBLIC_DOMAINS=' "$ENV_FILE"; then
  sed -i "s|^PUBLIC_DOMAINS=.*|PUBLIC_DOMAINS=$UPDATED|" "$ENV_FILE"
else
  echo "PUBLIC_DOMAINS=$UPDATED" >> "$ENV_FILE"
fi
echo "  PUBLIC_DOMAINS=$UPDATED"

if [[ -n "$EMAIL" ]]; then
  log "Requesting certificate for $DOMAIN"
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos -m "$EMAIL" --redirect \
    || echo "⚠ certbot failed — check DNS, then rerun: certbot --nginx -d $DOMAIN"
fi

log "Restarting app"
systemctl restart ba-man-bebin
echo "✓ $DOMAIN now serves the same rooms as your other domains."
