#!/bin/bash
# Construit Cursus.app (application de bureau macOS) et la dépose sur le Bureau.
#   npm run app                      → ~/Desktop/Cursus.app
#   npm run app -- /chemin/dossier   → autre emplacement
# L'application lance le serveur du projet (ce dossier) avec Node ; reconstruisez-la si le dossier est déplacé.
# Le serveur tourne en mode démonstration (CURSUS_DEMO=1), sur 127.0.0.1 uniquement : seul ce Mac y accède.
# Sa clé de session est créée au premier lancement dans ~/Library/Application Support/Cursus (CursusApp.swift).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="${1:-$HOME/Desktop}"
APP="$DEST_DIR/Cursus.app"
PORT="${CURSUS_APP_PORT:-3217}"
NODE_BIN="$(command -v node || true)"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

[[ "$(uname)" == "Darwin" ]] || { echo "Application de bureau : macOS uniquement." >&2; exit 1; }
[[ -n "$NODE_BIN" ]] || { echo "Node.js introuvable dans le PATH." >&2; exit 1; }
NODE_BIN="$(cd "$(dirname "$NODE_BIN")" && pwd)/$(basename "$NODE_BIN")"
command -v swiftc >/dev/null || { echo "Compilateur Swift introuvable : installez les outils de ligne de commande (xcode-select --install)." >&2; exit 1; }

echo "→ Interface web (vite build)"
(cd "$PROJECT_DIR" && npx vite build --logLevel warn)

echo "→ Application native (Swift)"
mkdir -p "$BUILD/Cursus.app/Contents/MacOS" "$BUILD/Cursus.app/Contents/Resources"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit \
  "$PROJECT_DIR/desktop/CursusApp.swift" -o "$BUILD/Cursus.app/Contents/MacOS/Cursus"

echo "→ Icône"
swift "$PROJECT_DIR/desktop/icon.swift" "$BUILD/icon.png"
ICONSET="$BUILD/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$BUILD/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$BUILD/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$BUILD/Cursus.app/Contents/Resources/AppIcon.icns"

VERSION="$(node -p "require('$PROJECT_DIR/package.json').version")"
cat > "$BUILD/Cursus.app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Cursus</string>
  <key>CFBundleDisplayName</key><string>Cursus</string>
  <key>CFBundleIdentifier</key><string>local.cursus.desktop</string>
  <key>CFBundleExecutable</key><string>Cursus</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleDevelopmentRegion</key><string>fr</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.business</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Cursus — suivi des formations, habilitations, temps et congés</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>CursusProjectDir</key><string>$PROJECT_DIR</string>
  <key>CursusNodePath</key><string>$NODE_BIN</string>
  <key>CursusPort</key><string>$PORT</string>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$BUILD/Cursus.app" >/dev/null 2>&1 || true

mkdir -p "$DEST_DIR"
if [[ -d "$APP" ]]; then
  osascript -e 'tell application id "local.cursus.desktop" to quit' >/dev/null 2>&1 || true
  rm -rf "$APP"
fi
ditto "$BUILD/Cursus.app" "$APP"
touch "$APP"
echo "✓ $APP"
echo "  Projet : $PROJECT_DIR · Node : $NODE_BIN · port local $PORT · mode démonstration"
