#!/usr/bin/env bash
#
# Optional: create YOUR OWN private release keystore for Behine (instead of the
# committed CI keystore, which is public and only guarantees a STABLE signature,
# not authenticity).
#
#   bash scripts/generate-keystore.sh
#
# Outputs (both git-ignored — back them up, losing them means no more updates):
#   android-app/behine-release.p12   (PKCS12 keystore, RSA-4096, 30-year cert)
#   android-app/keystore.properties  (picked up automatically by the build)
#
# Then build:  gradle -p android-app assembleRelease
#
# NOTE: switching from the CI key to your own key CHANGES the signature — an
# already-installed app must be uninstalled once before the new APK installs.
set -euo pipefail
cd "$(dirname "$0")/.."

KS=behine-release.p12
ALIAS=behine-release
PROPS=keystore.properties

command -v keytool >/dev/null 2>&1 || { echo "ERROR: keytool not found (install a JDK 17+)." >&2; exit 1; }
[ ! -f "$KS" ] || { echo "ERROR: $KS already exists — refusing to overwrite a signing key." >&2; exit 1; }

read -r -s -p "Choose a keystore password (min 6 chars): " P1; echo
read -r -s -p "Repeat the password: " P2; echo
[ "$P1" = "$P2" ] || { echo "ERROR: passwords do not match." >&2; exit 1; }

keytool -genkeypair -v -keystore "$KS" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10950 \
  -storepass "$P1" -keypass "$P1" \
  -dname "CN=Behine, OU=Release, O=Behine"

cat > "$PROPS" <<EOF
storeFile=$KS
storePassword=$P1
keyAlias=$ALIAS
keyPassword=$P1
EOF
chmod 600 "$PROPS" "$KS"

echo
echo "Done:"
echo "  - $KS      (your PRIVATE signing key — back it up, never commit)"
echo "  - $PROPS   (read automatically by the build — never commit)"
echo
echo "Build a signed release with:  gradle -p android-app assembleRelease"
