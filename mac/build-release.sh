#!/bin/bash
# Gera o pacote do Mac e o latest.json para uma release do GitHub.
# Uso: mac/build-release.sh <versao>  → arquivos em dist/ (suba como assets da release v<versao>)
set -euo pipefail
cd "$(dirname "$0")/.."
VER="${1:?versao}"; REL="https://github.com/therealjoaogabriel-oss/claude-board/releases"
OUT=dist; mkdir -p "$OUT"; STAGE=$(mktemp -d)
cp server.js claude-login.js "$STAGE/"; cp -r public vendor "$STAGE/"; echo "$VER" > "$STAGE/VERSION"
PKG="claude-board-$VER.tgz"; tar -czf "$OUT/$PKG" -C "$STAGE" .; rm -rf "$STAGE"
SHA=$( (sha256sum "$OUT/$PKG" 2>/dev/null || shasum -a 256 "$OUT/$PKG") | cut -d' ' -f1)
printf '{"version":"%s","url":"%s/download/v%s/%s","sha256":"%s","date":"%s"}\n' "$VER" "$REL" "$VER" "$PKG" "$SHA" "$(date -u +%FT%TZ)" > "$OUT/latest.json"
cp mac/install.sh mac/uninstall.sh win/install.ps1 win/uninstall.ps1 "$OUT/"
echo "pronto em $OUT/ (release v$VER)"
