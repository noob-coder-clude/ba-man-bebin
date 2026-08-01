#!/usr/bin/env bash
# ============================================================================
# Behine APK build — ALL CI logic lives in THIS plain repo file (so the
# workflow yaml never needs to change; bots may not edit workflow files).
# The workflow only installs tools and runs:  bash android-app/ci/build.sh
#
# Steps:
#   1) ensure the stable CI signing keystore exists (persist it if missing)
#   2) gradle assembleRelease (log tail is committed back on failure for
#      diagnosis: android-app/ci/last-build-errors.log.txt)
#   3) apksigner verify gate: full v2 scheme present, no debug cert, signer
#      fingerprint matches signing/expected-signer.txt (pinned on first run)
# ============================================================================
set -u
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

KS_B64=android-app/signing/behine-ci.keystore.b64
PIN=android-app/signing/expected-signer.txt
ERRLOG=android-app/ci/last-build-errors.log.txt

setup_git() {
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
}

echo "==> [1/3] Signing keystore"
if [ -f "$KS_B64" ]; then
  echo "Reusing the persisted CI keystore (signature stays identical to previous builds)."
else
  echo "::warning::Persisted CI keystore missing — generating a new one now."
  if [ -f "$PIN" ]; then
    echo "::error::A signer fingerprint is pinned but the keystore file is gone."
    echo "::error::Restore $KS_B64, otherwise updates cannot install over the old app."
    exit 1
  fi
  TMP_KS="${RUNNER_TEMP:-/tmp}/behine-ci.p12"
  keytool -genkeypair -v -keystore "$TMP_KS" -storetype PKCS12 \
    -storepass behine-ci-keystore -keypass behine-ci-keystore \
    -alias behine-ci -keyalg RSA -keysize 4096 -validity 10950 \
    -dname "CN=Behine CI, OU=Behine, O=Behine"
  base64 -w0 "$TMP_KS" > "$KS_B64"
  setup_git
  git add "$KS_B64"
  git commit -m "chore: persist Behine CI signing keystore [skip ci]"
  git push
fi

echo "==> [2/3] Assemble signed release APK"
set +e
gradle --no-daemon --stacktrace -p android-app assembleRelease 2>&1 | tee /tmp/behine-build.log
CODE=${PIPESTATUS[0]}
set -e
if [ "$CODE" -ne 0 ]; then
  tail -n 150 /tmp/behine-build.log > "$ERRLOG"
  setup_git
  git add "$ERRLOG"
  git commit -m "ci: build failure log ${GITHUB_RUN_ID:-local} [skip ci]" || true
  git push || true
  echo "::error::Release build FAILED — log tail committed to $ERRLOG"
  exit "$CODE"
fi
if [ -f "$ERRLOG" ]; then
  setup_git
  git rm -q "$ERRLOG"
  git commit -m "ci: build green again, drop failure log [skip ci]" || true
  git push || true
fi

echo "==> [3/3] Verify signature (Play Protect gate)"
APK=android-app/app/build/outputs/apk/release/app-release.apk
APKSIGNER=$(ls "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
"$APKSIGNER" verify --verbose --print-certs "$APK" | tee /tmp/behine-sig.txt
grep -q "Verified using v2 scheme (APK Signature Scheme v2): true" /tmp/behine-sig.txt \
  || { echo "::error::APK is missing the v2 signature scheme"; exit 1; }
if grep -qi "android debug" /tmp/behine-sig.txt; then
  echo "::error::APK is signed with a DEBUG certificate — refusing to publish"
  exit 1
fi
FP=$(grep -i "Signer #1 certificate SHA-256 fingerprint" /tmp/behine-sig.txt | awk '{print $NF}')
echo "Signer SHA-256 fingerprint: $FP"
if [ -f "$PIN" ]; then
  grep -qi "$FP" "$PIN" \
    || { echo "::error::Signer fingerprint CHANGED! expected $(cat "$PIN"), got $FP — updates would break"; exit 1; }
  echo "Signer fingerprint matches the pinned value ✅"
else
  echo "$FP" > "$PIN"
  setup_git
  git add "$PIN"
  git commit -m "chore: pin Behine signer fingerprint [skip ci]"
  git push
fi

echo "==> DONE: $APK"
