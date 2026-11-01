#!/usr/bin/env bash
# ============================================================================
# Cloud Persian Dubber — Runner Entrypoint (called by farsi-dubber.yml)
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

bash "$REPO_ROOT/dubber-ci/setup-dub-env.sh"
"${RUNNER_TEMP:-/tmp}/dubber-venv/bin/python" "$REPO_ROOT/dubber-server/dub_pipeline.py"
