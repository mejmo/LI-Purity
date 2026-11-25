#!/usr/bin/env bash
# Builds the Chrome Web Store / release ZIP: dist/li-purity-<version>.zip
# Contains only what the extension needs, with manifest.json at the top level.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./manifest.json').version")
out="dist/li-purity-${version}.zip"

rm -rf dist && mkdir -p dist
zip -qr -X "$out" manifest.json src icons -x "icons/*.svg"
echo "$out"
