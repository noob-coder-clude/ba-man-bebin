#!/usr/bin/env bash
# ---------------------------------------------------------------
# Ba Man Bebin — one-line Docker installer
#
#   curl -fsSL https://raw.githubusercontent.com/noob-coder-clude/ba-man-bebin/main/install.sh | sudo bash
#   curl -fsSL https://raw.githubusercontent.com/noob-coder-clude/ba-man-bebin/main/install.sh | sudo bash -s -- example.com you@example.com
#
#   Arg 1: domain (optional) — if given, a free Let's Encrypt
#          certificate is issued automatically (HTTPS, so video
#          calls keep working).
#   Arg 2: email  (optional) — used to register the certificate.
#
# What it does, in order:
#   1. installs Docker (+ compose plugin) if it's missing
#   2. clones the repo into /opt/ba-man-bebin (git pull if it's already there)
#   3. writes .env with a random ADMIN_TOKEN
#   4. docker compose build && docker compose up -d
#   5. (domain only) fetches a Let's Encrypt cert and switches nginx to HTTPS
#   6. waits for /healthz and prints the address + ADMIN_TOKEN
# ---------------------------------------------------------------
set -euo pipefail

REPO_URL="https://github.com/noob-coder-clude/ba-man-bebin.git"
APP_DIR="/opt/ba-man-bebin"

C_RESET=$'\033[0m'; C_B=$'\033[1m'
C_OK=$'\033[1;32m'; C_BAD=$'\033[1;31m'; C_WARN=$'\033[1;33m'; C_INFO=$'\033[1;36m'

info() { printf '%s==>%s %s\n' "$C_INFO" "$C_RESET" "$*"; }
ok()   { printf '%s ✓ %s%s\n' "$C_OK" "$*" "$C_RESET"; }
warn() { printf '%s ! %s%s\n' "$C_WARN" "$*" "$C_RESET" >&2; }
err()  { printf '%s ✗ %s%s\n' "$C_BAD" "$*" "$C_RESET" >&2; }

# -----------------------------------------------------------------
# 0. Must be root (we install packages and write to /opt)
# -----------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  err "این اسکریپت باید با root اجرا شود / this installer must run as root:"
  printf >&2 '     curl -fsSL https://raw.githubusercontent.com/noob-coder-clude/ba-man-bebin/main/install.sh | sudo bash -s -- example.com you@example.com\n'
  exit 1
fi

DOMAIN="${1:-}"
EMAIL="${2:-}"
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"; DOMAIN="${DOMAIN,,}"

if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$ ]]; then
  err "دامنه نامعتبر است / invalid domain: '$DOMAIN' (something like watch.example.com — no http://, no path)"
  exit 1
fi

# -----------------------------------------------------------------
# Small helpers
# -----------------------------------------------------------------
APT_UPDATED=0
install_pkgs() {
  if command -v apt-get >/dev/null 2>&1; then
    [ "$APT_UPDATED" -eq 1 ] || { apt-get update -qq; APT_UPDATED=1; }
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y "$@"
  elif command -v yum >/dev/null 2>&1; then
    yum install -y "$@"
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache "$@"
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm "$@"
  else
    return 1
  fi
}

need_cmd() { # need_cmd <cmd> — install it via the distro package manager if missing
  command -v "$1" >/dev/null 2>&1 && return 0
  info "'$1' not found — installing..."
  install_pkgs "$1" || {
    err "نتوانستم '$1' را نصب کنم / could not install '$1' automatically."
    err "لطفاً دستی نصبش کن و اسکریپت را دوباره اجرا کن / install it manually and re-run."
    exit 1
  }
}

# -----------------------------------------------------------------
# 1. Docker
# -----------------------------------------------------------------
need_cmd curl
need_cmd git

if ! command -v docker >/dev/null 2>&1; then
  info "Docker not found — installing via get.docker.com..."
  if curl -fsSL https://get.docker.com | sh; then
    ok "Docker installed."
  else
    err "نصب خودکار داکر شکست خورد / automatic Docker installation failed."
    err "لطفاً دستی نصبش کن / please install it manually: https://docs.docker.com/engine/install/"
    err "بعد اسکریپت را دوباره اجرا کن / then re-run this script."
    exit 1
  fi
else
  ok "Docker already installed ($(docker --version 2>/dev/null || echo docker))."
fi

# Make sure the daemon is actually up
if ! docker info >/dev/null 2>&1; then
  info "Starting the Docker daemon..."
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  else
    service docker start >/dev/null 2>&1 || true
  fi
  sleep 2
fi
if ! docker info >/dev/null 2>&1; then
  err "داکر نصب است ولی دایمونش بالا نیامد / Docker is installed but its daemon is not running."
  err "سرویس را دستی بالا بیاور (systemctl start docker) و دوباره اجرا کن."
  exit 1
fi

# Compose: plugin or standalone
COMPOSE=()
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  info "Docker Compose not found — trying to install it..."
  install_pkgs docker-compose-plugin >/dev/null 2>&1 || install_pkgs docker-compose >/dev/null 2>&1 || true
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    err "Docker Compose نصب نشد / could not install Docker Compose."
    err "راهنما / guide: https://docs.docker.com/compose/install/"
    exit 1
  fi
fi
ok "Compose: ${COMPOSE[*]}"

# -----------------------------------------------------------------
# 2. Clone (or update) the repo
# -----------------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  info "$APP_DIR already exists — pulling latest changes..."
  git -C "$APP_DIR" pull --ff-only || warn "git pull failed — continuing with what's already there."
elif [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  err "$APP_DIR exists but is not a ba-man-bebin clone. Move it away and re-run."
  exit 1
else
  info "Cloning $REPO_URL into $APP_DIR ..."
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# -----------------------------------------------------------------
# 3. .env with a random ADMIN_TOKEN (reused on re-runs)
# -----------------------------------------------------------------
[ -f .env ] || cp .env.example .env

set_env() { # set_env KEY VALUE — replace or append in .env
  if grep -q "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

EXISTING_TOKEN="$(grep -E '^ADMIN_TOKEN=' .env | tail -n 1 | cut -d= -f2- || true)"
if [ -n "$EXISTING_TOKEN" ]; then
  ADMIN_TOKEN="$EXISTING_TOKEN"
else
  ADMIN_TOKEN="$(openssl rand -hex 32 2>/dev/null || tr -dc 'a-f0-9' </dev/urandom | head -c 64 || true)"
  if [ -z "$ADMIN_TOKEN" ]; then
    err "نتوانستم ADMIN_TOKEN تصادفی بسازم / failed to generate a random ADMIN_TOKEN."
    exit 1
  fi
fi

# Rendered nginx config is written to an UNtracked file so future
# git pulls stay clean; docker-compose mounts ${NGINX_CONF:-nginx.conf}.
NGINX_RENDERED="deploy/nginx.rendered.conf"

set_env NODE_ENV production
set_env ADMIN_TOKEN "$ADMIN_TOKEN"
set_env NGINX_CONF nginx.rendered.conf
if [ -n "$DOMAIN" ]; then
  set_env PUBLIC_ORIGIN "https://$DOMAIN"
  set_env CORS_ORIGIN "https://$DOMAIN"
fi
ok ".env ready (ADMIN_TOKEN $([ -n "$EXISTING_TOKEN" ] && echo "kept" || echo "generated"))."

# -----------------------------------------------------------------
# 4. nginx config
#    - no domain  -> plain HTTP proxy on :80
#    - domain     -> first a bootstrap config on :80 (for the ACME
#                    challenge), then full HTTPS after the cert exists
# -----------------------------------------------------------------
write_locations() {
  cat <<'NGX'

    location /socket.io/ {
        proxy_pass http://bmb_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    # Video proxy: long-lived streaming responses, no buffering to disk.
    location /api/media/proxy {
        proxy_pass http://bmb_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
    }

    location / {
        proxy_pass http://bmb_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
    }
NGX
}

render_plain_http() {
  {
    cat <<'NGX'
# GENERATED by install.sh — HTTP only (no domain was given).
# Re-run install.sh with a domain to switch to HTTPS.
upstream bmb_app {
    server app:3000;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name _;

    client_max_body_size 4m;
NGX
    write_locations
    printf '}\n'
  } > "$NGINX_RENDERED"
}

render_bootstrap() {
  {
    cat <<'NGX'
# GENERATED by install.sh — temporary :80 config while the TLS
# certificate is being issued. Replaced by the HTTPS config right after.
upstream bmb_app {
    server app:3000;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;

    client_max_body_size 4m;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
NGX
    write_locations
    printf '}\n'
  } > "$NGINX_RENDERED"
  sed -i "s/__DOMAIN__/$DOMAIN/g" "$NGINX_RENDERED"
}

render_https() {
  {
    cat <<'NGX'
# GENERATED by install.sh — HTTPS with a Let's Encrypt certificate.
upstream bmb_app {
    server app:3000;
    keepalive 32;
}

# HTTP: ACME challenge + redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name __DOMAIN__;

    ssl_certificate     /etc/letsencrypt/live/__DOMAIN__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__DOMAIN__/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 4m;
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
NGX
    write_locations
    printf '}\n'
  } > "$NGINX_RENDERED"
  sed -i "s/__DOMAIN__/$DOMAIN/g" "$NGINX_RENDERED"
}

mkdir -p deploy/certbot/conf deploy/certbot/www

if [ -n "$DOMAIN" ]; then
  render_bootstrap
  info "Domain: $DOMAIN — starting on :80 first to fetch a Let's Encrypt cert."
else
  render_plain_http
  info "No domain given — HTTP-only setup."
fi

# -----------------------------------------------------------------
# 5. Build & start
# -----------------------------------------------------------------
info "Building the image (first build takes a few minutes)..."
"${COMPOSE[@]}" build
info "Starting the stack..."
"${COMPOSE[@]}" up -d

# -----------------------------------------------------------------
# 6. Health check
# -----------------------------------------------------------------
info "Waiting for /healthz ..."
HEALTHY=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 5 http://127.0.0.1/healthz >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 3
done

if [ "$HEALTHY" -ne 1 ]; then
  err "سرور سالم بالا نیامد / the app did not become healthy in time."
  err "آخرین لاگ‌ها / recent logs:"
  "${COMPOSE[@]}" logs --tail=40 app nginx >&2 || true
  err "بعد از رفع مشکل: cd $APP_DIR && ${COMPOSE[*]} up -d"
  exit 1
fi
ok "App is healthy."

# -----------------------------------------------------------------
# 7. TLS (only with a domain)
# -----------------------------------------------------------------
SITE_URL=""
HTTPS_OK=0
detect_ip() {
  curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null \
    || curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null \
    || true
}

if [ -n "$DOMAIN" ]; then
  info "Issuing Let's Encrypt certificate for $DOMAIN ..."
  CB_EMAIL_ARGS=(--register-unsafely-without-email)
  [ -n "$EMAIL" ] && CB_EMAIL_ARGS=(-m "$EMAIL" --no-eff-email)

  if docker run --rm \
      -v "$APP_DIR/deploy/certbot/conf:/etc/letsencrypt" \
      -v "$APP_DIR/deploy/certbot/www:/var/www/certbot" \
      certbot/certbot certonly --webroot -w /var/www/certbot \
      -d "$DOMAIN" "${CB_EMAIL_ARGS[@]}" --agree-tos -n --keep-until-expiring; then

    render_https
    "${COMPOSE[@]}" restart nginx >/dev/null

    # Verify HTTPS end-to-end (works even if public DNS hasn't propagated yet)
    for _ in $(seq 1 10); do
      if curl -fsS --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/healthz" >/dev/null 2>&1; then
        HTTPS_OK=1
        break
      fi
      sleep 3
    done

    if [ "$HTTPS_OK" -eq 1 ]; then
      ok "HTTPS is live: https://$DOMAIN"
    else
      warn "گواهی گرفته شد ولی چک HTTPS جواب نداد — لاگ nginx را ببین: ${COMPOSE[*]} logs nginx"
    fi
    SITE_URL="https://$DOMAIN"
  else
    warn "صدور گواهی ناموفق بود / certificate issuance failed."
    warn "مطمئن شو رکورد A دامنه به IP همین سرور اشاره می‌کند و پورت‌های ۸۰/۴۴۳ بازند،"
    warn "بعد اسکریپت را دوباره با دامنه اجرا کن: ... | sudo bash -s -- $DOMAIN ${EMAIL:-you@example.com}"
    warn "سایت فعلاً روی HTTP در دسترس است."
    SITE_URL="http://$DOMAIN"
  fi
else
  IP="$(detect_ip)"
  SITE_URL="http://${IP:-<SERVER-IP>}"
fi

# -----------------------------------------------------------------
# 8. Done — print the summary + ADMIN_TOKEN
# -----------------------------------------------------------------
printf '\n'
printf '%s========================================================%s\n' "$C_OK" "$C_RESET"
printf '%s ✅ بالا آمد! / Ba Man Bebin is up.%s\n' "$C_B" "$C_RESET"
printf '\n'
printf '   🌐 Address:        %s\n' "$SITE_URL"
printf '   🔑 ADMIN_TOKEN:    %s\n' "$ADMIN_TOKEN"
printf '      (secret — also saved in %s/.env)\n' "$APP_DIR"
printf '\n'
printf '   Manage:  cd %s\n' "$APP_DIR"
printf '            %s logs -f      # live logs\n' "${COMPOSE[*]}"
printf '            %s restart      # restart\n' "${COMPOSE[*]}"
printf '%s========================================================%s\n' "$C_OK" "$C_RESET"

if [ -z "$DOMAIN" ]; then
  printf '\n'
  warn "⚠️  بدون دامنه (= بدون HTTPS) مرورگر اجازه دوربین/میکروفون نمی‌دهد،"
  warn "   پس دکمه «تماس تصویری» خطا می‌دهد. برای فعال شدن تماس، دامنه بده:"
  warn "   curl -fsSL https://raw.githubusercontent.com/noob-coder-clude/ba-man-bebin/main/install.sh | sudo bash -s -- example.com you@example.com"
fi
warn "اگر فایروال داری، پورت‌های ۸۰ و ۴۴۳ باید باز باشند (مثل: ufw allow 80,443/tcp)."
printf '\n'
