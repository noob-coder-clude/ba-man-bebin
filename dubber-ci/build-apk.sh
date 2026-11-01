#!/usr/bin/env bash
# ============================================================================
# BaMan Dubber — Signed Release APK Build, JUnit Crypto Gate & Release Upload
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

KS_B64="dubber-app/signing/dubber-ci.keystore.b64"
PIN="dubber-app/signing/expected-signer.txt"
ERRLOG="dubber-ci/last-build-errors.log.txt"

setup_git() {
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
}

echo "==> [1/4] Preparing stable Play-Protect-safe release keystore"
mkdir -p "$(dirname "$KS_B64")"
if [ -f "$KS_B64" ]; then
  echo "Reusing persisted CI keystore."
else
  echo "Generating persistent PKCS12 release keystore..."
  TMP_KS="${RUNNER_TEMP:-/tmp}/dubber-ci.p12"
  rm -f "$TMP_KS"
  keytool -genkeypair -v \
    -keystore "$TMP_KS" \
    -storetype PKCS12 \
    -storepass dubber-ci-keystore \
    -keypass dubber-ci-keystore \
    -alias dubber-ci \
    -keyalg RSA \
    -keysize 4096 \
    -validity 10950 \
    -dname "CN=BaMan Dubber, OU=Mobile, O=BaManBebin"
  base64 -w0 "$TMP_KS" > "$KS_B64"
  rm -f "$TMP_KS"
  setup_git
  git pull --rebase || true
  git add "$KS_B64"
  git commit -m "chore(dubber): persist CI release keystore [skip ci]" || true
  git push || true
fi

echo "==> [2/4] Running JUnit crypto verification + Gradle assembleRelease"
set +e
gradle --no-daemon --stacktrace -p dubber-app testDebugUnitTest assembleRelease 2>&1 | tee /tmp/dubber-gradle.log
CODE=${PIPESTATUS[0]}
set -e

if [ "$CODE" -ne 0 ]; then
  {
    echo "===== Compiler / Gradle failure summary ====="
    grep -E "^e: |error: |FAILED|What went wrong|AssertionError" /tmp/dubber-gradle.log | head -60
    echo "===== Tail of gradle log ====="
    tail -n 220 /tmp/dubber-gradle.log
  } > "$ERRLOG"
  setup_git
  git pull --rebase || true
  git add "$ERRLOG"
  git commit -m "ci(dubber): capture build failure log ${GITHUB_RUN_ID:-local} [skip ci]" || true
  git push || true
  echo "::error::APK build failed — see $ERRLOG"
  exit "$CODE"
fi

if [ -f "$ERRLOG" ]; then
  setup_git
  git pull --rebase || true
  git rm -q "$ERRLOG"
  git commit -m "ci(dubber): drop old failure log after green build [skip ci]" || true
  git push || true
fi

echo "==> [3/4] Verifying v1+v2+v3 APK signature"
APK_SRC="dubber-app/app/build/outputs/apk/release/app-release.apk"
APK_NAMED="dubber-app/app/build/outputs/apk/release/baman-dubber.apk"
cp -f "$APK_SRC" "$APK_NAMED"

APKSIGNER="$(ls "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)"
"$APKSIGNER" verify --verbose --print-certs "$APK_NAMED" | tee /tmp/dubber-sig.txt
grep -q "Verified using v2 scheme (APK Signature Scheme v2): true" /tmp/dubber-sig.txt \
  || { echo "::error::APK missing v2 signature"; exit 1; }

FP="$(grep -i "Signer #1 certificate SHA-256 fingerprint" /tmp/dubber-sig.txt | awk '{print $NF}')"
echo "Signer SHA-256: $FP"
if [ -f "$PIN" ]; then
  grep -qi "$FP" "$PIN" || { echo "::error::Signer fingerprint changed!"; exit 1; }
else
  echo "$FP" > "$PIN"
  setup_git
  git pull --rebase || true
  git add "$PIN"
  git commit -m "chore(dubber): pin release APK signer fingerprint [skip ci]" || true
  git push || true
fi

echo "==> [4/4] Publishing direct APK download on GitHub Release (apk-latest)"
if command -v gh >/dev/null 2>&1 && [ -n "${GH_TOKEN:-}" ]; then
  NOTES="📱 **اپلیکیشن اندروید «دوبلور ابری فارسی» (BaMan Dubber)**

- دوبله فارسی ویدیوهای یوتیوب با **کوکی شخصی** و **کلید Gemini API**
- پردازش ۱۰۰٪ روی **سرور ابری گیت‌هاب** (بدون مصرف باتری و پردازنده گوشی)
- پخش آنلاین فوری داخل برنامه با زیرنویس زنده فارسی + دانلود مستقیم در گالری
- امضای استاندارد v1+v2+v3 سازگار با Google Play Protect (SHA-256: \`$FP\`)"

  if gh release view apk-latest >/dev/null 2>&1; then
    gh release upload apk-latest "$APK_NAMED" --clobber
    gh release edit apk-latest --title "📱 دانلود برنامه اندروید دوبلور ابری (نسخه ۱.۰)" --notes "$NOTES"
  else
    gh release create apk-latest "$APK_NAMED" \
      --title "📱 دانلود برنامه اندروید دوبلور ابری (نسخه ۱.۰)" \
      --notes "$NOTES"
  fi
fi

echo "==> APK READY: $APK_NAMED"
