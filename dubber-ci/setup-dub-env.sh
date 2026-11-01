#!/usr/bin/env bash
# ============================================================================
# Sets up FFmpeg, Persian Vazirmatn font, Node EJS & isolated Python venv
# for the Cloud Persian Dubbing Pipeline on Ubuntu 24.04+ GitHub runners.
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Installing FFmpeg & Persian fonts..."
sudo apt-get update -qq
sudo apt-get install -y -qq ffmpeg fonts-vazirmatn >/dev/null 2>&1 || \
  sudo apt-get install -y -qq ffmpeg fonts-dejavu-core >/dev/null 2>&1

echo "==> Creating Python virtual environment & installing latest yt-dlp + google-genai..."
VENV_DIR="${RUNNER_TEMP:-/tmp}/dubber-venv"
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade --quiet pip
"$VENV_DIR/bin/pip" install --upgrade --quiet -r "$REPO_ROOT/dubber-server/requirements.txt"

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$VENV_DIR/bin" >> "$GITHUB_PATH"
fi

echo "==> Verifying tool versions:"
"$VENV_DIR/bin/yt-dlp" --version
ffmpeg -version | head -n 1
node --version
