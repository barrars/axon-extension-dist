#!/usr/bin/env bash
# Install (or update) the Evidence.com Data Aggregator Chrome extension without
# the Chrome Web Store and without git.
#
#   curl -fsSL https://raw.githubusercontent.com/barrars/axon-extension-dist/main/install-extension.sh | bash
#
# Downloads the latest published build, unpacks it into a stable folder, and
# prints the exact clicks Chrome needs. Anything you have collected lives in the
# Chrome profile, never in this folder, so updating cannot touch your data.
set -euo pipefail

ARCHIVE="${AXON_INSTALL_URL:-https://github.com/barrars/axon-extension-dist/archive/refs/heads/main.zip}"
TARGET="${AXON_INSTALL_DIR:-$HOME/AxonExtension}"

usage () {
  cat <<'EOF'
Usage: install-extension.sh [--dir PATH] [--url URL]

  --dir PATH   where to install (default: ~/AxonExtension)
  --url URL    archive to install (default: latest published build)

Env: AXON_INSTALL_DIR, AXON_INSTALL_URL do the same without flags.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) TARGET="$2"; shift 2 ;;
    --url) ARCHIVE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument $1" >&2; usage >&2; exit 1 ;;
  esac
done

for cmd in curl unzip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: '$cmd' is required but not installed" >&2
    exit 1
  fi
done

read_version () {
  [ -f "$1/manifest.json" ] || return 0
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/manifest.json" 2>/dev/null | head -n 1 || true
}

# Never wipe a folder that is not ours: a typo in --dir must not eat a home dir.
if [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null || true)" ] && [ ! -f "$TARGET/manifest.json" ]; then
  echo "error: $TARGET exists and is not an extension folder (no manifest.json)" >&2
  echo "       pick another --dir, or empty it yourself first" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading latest build..."
HTTP_CODE="$(curl -sSL -o "$TMP_DIR/build.zip" -w '%{http_code}' "$ARCHIVE" || true)"
if [ "$HTTP_CODE" != "200" ]; then
  echo "error: download failed (HTTP $HTTP_CODE) from $ARCHIVE" >&2
  exit 1
fi

echo "Extracting..."
unzip -q "$TMP_DIR/build.zip" -d "$TMP_DIR/x"

SRC="$(find "$TMP_DIR/x" -maxdepth 1 -mindepth 1 -type d -print -quit)"
if [ -z "$SRC" ]; then
  echo "error: unexpected archive layout" >&2
  exit 1
fi
# Published builds sit at the archive root; tolerate an older dist/ layout too.
if [ -d "$SRC/dist" ]; then
  SRC="$SRC/dist"
fi

NEW_VERSION="$(read_version "$SRC")"
if [ -z "$NEW_VERSION" ]; then
  echo "error: archive has no manifest.json with a version" >&2
  exit 1
fi
OLD_VERSION="$(read_version "$TARGET")"

mkdir -p "$TARGET"
if [ -d "$TARGET" ]; then
  find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi
cp -R "$SRC"/. "$TARGET"/

# Repo documentation, not part of the extension package.
rm -f "$TARGET/README.md" "$TARGET/install-extension.sh" "$TARGET/install-extension.ps1" "$TARGET/install-extension.bat"

echo
echo "Installed v$NEW_VERSION to $TARGET"
if [ -n "$OLD_VERSION" ]; then
  echo "Updated from v$OLD_VERSION"
else
  echo "Fresh install"
fi
echo
echo "Now:"
echo "  1. Open chrome://extensions"
echo "  2. Turn on Developer mode (top right)"
echo "  3. Click 'Load unpacked' and choose:"
echo "       $TARGET"
echo "  4. Already installed? Click the Reload arrow on its card instead."
echo

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$TARGET" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "$TARGET" >/dev/null 2>&1 || true
fi
