#!/bin/bash
# Instalador do Claude Board pra Mac. Rodar no Terminal:
#   curl -fsSL https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/install.sh | bash
# Instala em ~/.claude-board-app (Node próprio, sem mexer no sistema), liga o Board em segundo plano
# (abre sozinho ao ligar o Mac) e cria o atalho "Claude Board" em ~/Aplicativos. Rodar de novo = reinstalar/atualizar.
set -euo pipefail
BASE="https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download"
APP="$HOME/.claude-board-app"; PORT=8830; LABEL="com.claudeboard.app"; NODE_VER="v20.20.2"
say(){ printf "\033[1;33m▸\033[0m %s\n" "$*"; }
[ "$(uname)" = "Darwin" ] || { echo "Este instalador é para Mac."; exit 1; }
case "$(uname -m)" in arm64) NA=darwin-arm64;; x86_64) NA=darwin-x64;; *) echo "Processador não suportado"; exit 1;; esac
mkdir -p "$APP/data" "$HOME/Applications" "$HOME/Library/LaunchAgents"

if [ ! -x "$APP/runtime/bin/node" ]; then
  say "Baixando o Node (só pro Board, não mexe no seu sistema)…"
  T=$(mktemp -d); curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-$NA.tar.gz" | tar -xz -C "$T"
  rm -rf "$APP/runtime"; mv "$T"/node-* "$APP/runtime"; rm -rf "$T"
fi
NODE="$APP/runtime/bin/node"

say "Baixando o Claude Board…"
J=$(curl -fsSL "$BASE/latest.json?t=$(date +%s)")
get(){ "$NODE" -e 'console.log(JSON.parse(process.argv[1])[process.argv[2]])' "$J" "$1"; }
VER=$(get version); URL=$(get url); SHA=$(get sha256)
T=$(mktemp -d); curl -fsSL "$URL" -o "$T/app.tgz"
[ "$(shasum -a 256 "$T/app.tgz" | cut -d' ' -f1)" = "$SHA" ] || { echo "Download corrompido, tente de novo."; exit 1; }
rm -rf "$APP/app.new"; mkdir -p "$APP/app.new"; tar -xzf "$T/app.tgz" -C "$APP/app.new"; rm -rf "$T"
rm -rf "$APP/app.old"; [ -d "$APP/app" ] && mv "$APP/app" "$APP/app.old"; mv "$APP/app.new" "$APP/app"

CL=""; for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do [ -x "$c" ] && CL="$c" && break; done
if [ -z "$CL" ]; then
  say "Instalando o Claude Code (o motor do Board)…"
  curl -fsSL https://claude.ai/install.sh | bash || say "Não consegui instalar o Claude Code agora; dá pra instalar depois pelo botão no Board."
fi

PL="$HOME/Library/LaunchAgents/$LABEL.plist"
cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$APP/app/server.js</string></array>
  <key>WorkingDirectory</key><string>$APP/app</string>
  <key>EnvironmentVariables</key><dict>
    <key>CB_MODE</key><string>local</string>
    <key>CB_DATA</key><string>$APP/data</string>
    <key>CB_UPDATE_URL</key><string>$BASE/latest.json</string>
    <key>PORT</key><string>$PORT</string>
    <key>HOME</key><string>$HOME</string>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>AbandonProcessGroup</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$APP/data/server.log</string>
  <key>StandardErrorPath</key><string>$APP/data/server.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PL"

rm -rf "$HOME/Applications/Claude Board.app"
osacompile -o "$HOME/Applications/Claude Board.app" -e "open location \"http://localhost:$PORT\"" >/dev/null 2>&1 || true

for i in $(seq 1 40); do curl -fs "http://127.0.0.1:$PORT/api/state" >/dev/null 2>&1 && break; sleep 1; done
if curl -fs "http://127.0.0.1:$PORT/api/state" >/dev/null 2>&1; then
  say "Pronto! Claude Board $VER instalado. Abra pelo atalho \"Claude Board\" em Aplicativos ou em http://localhost:$PORT"
  [ -n "${CB_NO_OPEN:-}" ] || open "http://localhost:$PORT"
else
  echo "O Board não respondeu. Veja o log: $APP/data/server.log"; exit 1
fi
