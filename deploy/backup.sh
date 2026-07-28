#!/usr/bin/env bash
# ---------------------------------------------------------------
# Ba Man Bebin — backup / restore, for moving to a new server
#
#   sudo bash deploy/backup.sh create [out.tar.gz]
#   sudo bash deploy/backup.sh restore <backup.tar.gz>
#   sudo bash deploy/backup.sh                # legacy: create a temp backup
#                                             # + optional R2/GitHub upload
#
# Migration in three steps:
#   1. old server:  sudo bash deploy/backup.sh create
#   2. new server:  ... | sudo bash -s -- example.com you@example.com   (install.sh)
#   3. new server:  cd /opt/ba-man-bebin && sudo bash deploy/backup.sh restore /root/bmb-backup-*.tar.gz
#
# Auto-detects the installation layout:
#   Docker  : /opt/ba-man-bebin   -> .env, deploy/nginx.rendered.conf, deploy/certbot/
#   systemd : /var/www/ba-man-bebin/.env, /var/www/yt-cookies.txt,
#             /etc/nginx/sites-available/ba-man-bebin, /etc/letsencrypt
#
# The archive just mirrors the original absolute paths, so restore =
# unpack + copy everything back where it came from.
# ---------------------------------------------------------------
set -euo pipefail

C_RESET=$'\033[0m'
C_OK=$'\033[1;32m'; C_BAD=$'\033[1;31m'; C_WARN=$'\033[1;33m'; C_INFO=$'\033[1;36m'
info() { printf '%s==>%s %s\n' "$C_INFO" "$C_RESET" "$*"; }
ok()   { printf '%s ✓ %s%s\n' "$C_OK"    "$*" "$C_RESET"; }
warn() { printf '%s ! %s%s\n' "$C_WARN"  "$*" "$C_RESET" >&2; }
err()  { printf '%s ✗ %s%s\n' "$C_BAD"   "$*" "$C_RESET" >&2; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    err "این دستور باید با root اجرا شود / run as root: sudo bash deploy/backup.sh $*"
    exit 1
  fi
}

# Absolute paths worth saving, per layout
docker_paths() {
  [ -f /opt/ba-man-bebin/.env ] && echo /opt/ba-man-bebin/.env
  [ -f /opt/ba-man-bebin/deploy/nginx.rendered.conf ] && echo /opt/ba-man-bebin/deploy/nginx.rendered.conf
  [ -d /opt/ba-man-bebin/deploy/certbot/conf ] && echo /opt/ba-man-bebin/deploy/certbot/conf
}
systemd_paths() {
  [ -f /var/www/ba-man-bebin/.env ] && echo /var/www/ba-man-bebin/.env
  [ -f /var/www/yt-cookies.txt ] && echo /var/www/yt-cookies.txt
  [ -f /etc/nginx/sites-available/ba-man-bebin ] && echo /etc/nginx/sites-available/ba-man-bebin
  [ -d /etc/letsencrypt ] && echo /etc/letsencrypt
}

detect_layout() {
  if [ -d /opt/ba-man-bebin ]; then
    echo docker
  elif [ -d /var/www/ba-man-bebin ]; then
    echo systemd
  else
    echo unknown
  fi
}

do_create() {
  require_root create
  local OUT="${1:-$PWD/bmb-backup-$(date +%Y%m%d_%H%M%S).tar.gz}"
  local LAYOUT STAGE LIST
  LAYOUT="$(detect_layout)"

  STAGE="$(mktemp -d)"
  mkdir -p "$STAGE/bmb-backup"

  case "$LAYOUT" in
    docker)  LIST="$(docker_paths)" ;;
    systemd) LIST="$(systemd_paths)" ;;
    *)       LIST="$(docker_paths; systemd_paths)" ;;
  esac
  # keep only unique non-empty lines
  LIST="$(printf '%s\n' "$LIST" | sed '/^$/d' | sort -u)"

  if [ -z "$LIST" ]; then
    err "چیزی برای بکاپ پیدا نشد / nothing to back up (no .env, certs or configs found)."
    rm -rf "$STAGE"
    exit 1
  fi

  info "Layout: $LAYOUT — backing up:"
  printf '    %s\n' $LIST

  # --- MANIFEST --------------------------------------------------
  {
    echo "app=ba-man-bebin"
    echo "layout=$LAYOUT"
    echo "date=$(date -Is)"
    echo "host=$(hostname 2>/dev/null || echo unknown)"
    printf 'files=%s\n' "$LIST" | tr '\n' ' '
    echo
  } > "$STAGE/bmb-backup/MANIFEST"

  # --- copy preserving absolute paths ----------------------------
  # shellcheck disable=SC2086
  cp -a --parents $LIST "$STAGE/bmb-backup"

  mkdir -p "$(dirname "$OUT")"
  tar -czf "$OUT" -C "$STAGE" bmb-backup
  rm -rf "$STAGE"

  ok "Backup ready: $OUT"
  printf '    منتقلش کن / copy it over:  scp %s root@NEW-SERVER-IP:/root/\n' "$OUT"
}

do_restore() {
  require_root restore
  local FILE="${1:-}"
  if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    err "فایل بکاپ پیدا نشد / backup file not found: '${FILE:-<missing>}'"
    err "usage: sudo bash deploy/backup.sh restore <backup.tar.gz>"
    exit 1
  fi

  local STAGE
  STAGE="$(mktemp -d)"
  tar -xzf "$FILE" -C "$STAGE"

  if [ ! -d "$STAGE/bmb-backup" ]; then
    err "این فایل بکاپ ba-man-bebin نیست (پوشه bmb-backup ندارد): $FILE"
    rm -rf "$STAGE"
    exit 1
  fi

  [ -f "$STAGE/bmb-backup/MANIFEST" ] && { info "MANIFEST:"; sed 's/^/    /' "$STAGE/bmb-backup/MANIFEST"; }

  # Copy everything back to the same absolute paths it was saved from
  # (MANIFEST is metadata, not a file to restore).
  (cd "$STAGE/bmb-backup" && find . -mindepth 1 -maxdepth 1 ! -name MANIFEST -exec cp -a {} / \;)
  rm -rf "$STAGE"
  ok "Files restored."

  # Bring the stack back up where possible
  if [ -d /opt/ba-man-bebin ]; then
    if docker compose version >/dev/null 2>&1; then
      info "Restarting the Docker stack..."
      (cd /opt/ba-man-bebin && docker compose up -d && docker compose restart nginx) \
        && ok "Stack is up." || warn "compose up failed — check: cd /opt/ba-man-bebin && docker compose logs"
    else
      warn "Docker compose not found — start it yourself: cd /opt/ba-man-bebin && docker compose up -d"
    fi
  elif [ -d /var/www/ba-man-bebin ]; then
    command -v systemctl >/dev/null 2>&1 && systemctl restart ba-man-bebin nginx 2>/dev/null \
      && ok "systemd services restarted." || warn "ری‌استарт خودکار نشد — systemctl restart ba-man-bebin nginx"
  fi

  printf '\n'
  ok "انتقال تمام شد / migration done."
  printf '    اگر دامنه عوض شده، DNS را به این سرور بچسبان و برای گواهی جدید install.sh را دوباره با دامنه اجرا کن.\n'
}

usage() {
  cat >&2 <<'USAGE'
usage:
  sudo bash deploy/backup.sh create [out.tar.gz]      ساخت بکاپ از این سرور
  sudo bash deploy/backup.sh restore <backup.tar.gz>  بازیابی روی این سرور
USAGE
  exit 1
}

case "${1:-}" in
  create)  do_create "${2:-}" ;;
  restore) do_restore "${2:-}" ;;
  "" ) ;; # legacy mode below
  -h|--help) usage ;;
  *) usage ;;
esac

# -----------------------------------------------------------------
# Legacy behaviour (no arguments): quick backup to /tmp + optional
# upload to R2 / GitHub, exactly like the old script did.
# -----------------------------------------------------------------
if [ "${1:-}" = "" ]; then
  require_root
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  TAR_FILE="/tmp/backup_bmb_$TIMESTAMP.tar.gz"

  do_create "$TAR_FILE"

  # Upload to R2 (AWS CLI needs to be configured)
  if command -v aws >/dev/null; then
    echo "Uploading to R2..."
    aws s3 cp "$TAR_FILE" "s3://${R2_BUCKET:-bmb-backups}/$(basename "$TAR_FILE")" --endpoint-url "$R2_ENDPOINT" || echo "R2 upload failed"
  fi

  # Upload to GitHub via gh CLI if logged in
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    echo "Uploading to GitHub Release..."
    gh release upload "backup-$TIMESTAMP" "$TAR_FILE" || echo "GitHub upload failed (did you create the release?)"
  fi

  rm -f "$TAR_FILE"
  echo "Done."
fi
