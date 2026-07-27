#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/tmp/bmb-backup"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TAR_FILE="backup_bmb_$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "Backing up application state..."

# Copy app config
cp -a /var/www/ba-man-bebin/.env "$BACKUP_DIR/.env" 2>/dev/null || true
cp -a /var/www/yt-cookies.txt "$BACKUP_DIR/yt-cookies.txt" 2>/dev/null || true

# Copy nginx config
cp -a /etc/nginx/sites-available/ba-man-bebin "$BACKUP_DIR/nginx_ba-man-bebin" 2>/dev/null || true

# Copy Let's Encrypt certificates
cp -a /etc/letsencrypt "$BACKUP_DIR/letsencrypt" 2>/dev/null || true

tar -czf "/tmp/$TAR_FILE" -C "/tmp" bmb-backup

echo "Backup created at /tmp/$TAR_FILE"

# Upload to R2 (AWS CLI needs to be configured)
if command -v aws >/dev/null; then
  echo "Uploading to R2..."
  aws s3 cp "/tmp/$TAR_FILE" "s3://${R2_BUCKET:-bmb-backups}/$TAR_FILE" --endpoint-url "$R2_ENDPOINT" || echo "R2 upload failed"
fi

# Upload to GitHub via gh CLI if logged in
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  echo "Uploading to GitHub Release..."
  gh release upload "backup-$TIMESTAMP" "/tmp/$TAR_FILE" || echo "GitHub upload failed (did you create the release?)"
fi

# Cleanup
rm -rf "$BACKUP_DIR"
rm -f "/tmp/$TAR_FILE"

echo "Done."
