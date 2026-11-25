#!/bin/bash
# Remove o Claude Board do Mac. Suas conversas do Claude Code (~/.claude) NÃO são apagadas.
# Pra apagar também os quadros/pastas do Board: rodar com CB_PURGE=1
LABEL="com.claudeboard.app"; APP="$HOME/.claude-board-app"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"; rm -rf "$HOME/Applications/Claude Board.app"
rm -rf "$APP/app" "$APP/app.old" "$APP/app.new" "$APP/runtime"
[ -n "${CB_PURGE:-}" ] && rm -rf "$APP"
echo "Claude Board removido."
