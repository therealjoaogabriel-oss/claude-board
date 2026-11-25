# Claude Board

**English** · [Português](README.pt-BR.md) · [Español](README.es.md)

**Built by [Invee Hub](https://inveehub.com.br).**

A free-form canvas, n8n/Miro style, for your **Claude Code** conversations. It reads the same sessions as the IDE extension and the terminal (`~/.claude/projects`). With it you can:

- **Drag conversations anywhere** on the canvas, add areas, notes and links, and organize everything into multiple boards and folders.
- **Follow live** the reasoning, tool calls, diffs and tasks of every conversation.
- **Continue or start conversations** choosing model, effort and permission mode. Models come from your account's official list and update on their own.
- **Queue messages** while Claude is working, with a "send now" button.
- **Attach images and files.**
- **Talk instead of typing:** 🎤 records and transcribes with Claude Code's own voice service. Dropping an audio file into a conversation also turns it into text.
- **See your official usage and limits** (5-hour and weekly), each conversation's context and token consumption.
- **Auto-compact long conversations** before sending, keeping decisions, pending items and file paths, to spend fewer tokens.
- **Use the `/` menu** with commands and skills, and configure Claude Code (model, effort, permissions, MCP, skills) from the UI.
- **Pick a theme:** light or dark.

No npm dependencies: just Node 20 and a single `server.js`. Nothing leaves your machine besides the calls Claude Code already makes.

> Community project, **not official**. Not affiliated with Anthropic. "Claude" is a trademark of Anthropic.
>
> The interface is currently in Brazilian Portuguese. Translations are welcome, see [Contributing](#contributing).

## Install on macOS (1 command)

```bash
curl -fsSL https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/install.sh | bash
```

The installer:

1. Downloads a private Node just for the Board, without touching your system.
2. Installs Claude Code if it isn't installed yet.
3. Runs the Board in the background, starting automatically when you log in.
4. Creates a **Claude Board** shortcut in Applications.

It runs at `http://localhost:8830`. To sign in, click **Entrar com Claude** (Sign in with Claude): it is Claude Code's official login, and the Board never sees your password.

**Auto-update:** the app checks this repository's latest release and updates itself, verifying the package sha256.

To uninstall:

```bash
curl -fsSL https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/uninstall.sh | bash
```

This does not delete your Claude Code conversations.

## Install on Windows (1 command)

In **PowerShell** (no admin needed):

```powershell
irm https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/install.ps1 | iex
```

The installer:

1. Installs the Board in `%LOCALAPPDATA%\ClaudeBoard`, with its own Node.
2. Installs Claude Code if it isn't installed yet.
3. Runs the Board in the background, with no window, starting automatically at login.
4. Creates a **Claude Board** shortcut in the Start Menu and on the Desktop.

Windows also auto-updates from the releases. To uninstall:

```powershell
irm https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/uninstall.ps1 | iex
```

## Run on a Linux server (VPS)

In this mode every reply runs in its own systemd unit, so Claude keeps working even with the tab closed or your computer off.

Requirements:

- Linux with systemd.
- Node 20 or newer.
- Claude Code installed and logged in for the user running the Board.
- Passwordless `sudo` for `systemd-run`.

Steps:

```bash
git clone https://github.com/therealjoaogabriel-oss/claude-board.git && cd claude-board
cp .env.example .env    # set BOARD_PASSWORD
node server.js          # listens on 127.0.0.1:8830
```

Put an HTTPS proxy in front of it, for example Caddy:

```
board.yourdomain.com {
  reverse_proxy 127.0.0.1:8830
}
```

Example systemd service at `/etc/systemd/system/claude-board.service`:

```ini
[Unit]
Description=Claude Board
After=network.target

[Service]
User=YOUR_USER
WorkingDirectory=/path/to/claude-board
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

### Security

The Board controls Claude Code on the machine, including the "bypass permissions" mode. So:

- Always use a strong password and HTTPS.
- Never expose port 8830 directly to the internet.
- One Claude account per person: everyone installs the app on their own computer.

## Configuration (.env)

See `.env.example`. Main options:

| Variable | What it does |
|---|---|
| `BOARD_PASSWORD` | Access password. Required in server mode. |
| `PORT` / `BIND` | Port and IPs the Board listens on. |
| `CB_SERVICES` | systemd services shown on the Dashboard. |
| `CB_STT_TERMS` | Proper names that help voice transcription. |
| `CLAUDE_BIN` | Path to Claude Code, if it isn't on the PATH. |

## Publish your own build

```bash
mac/build-release.sh 1.2.3   # builds dist/ with the package, latest.json and the macOS and Windows scripts
```

Then create release `v1.2.3` and upload the files from `dist/`. Installed apps update themselves.

## Contributing

Issues and pull requests are welcome, especially:

- UI translations (English, Spanish and others).
- Testing on different Windows and macOS versions.
- Bug reports with the log at `~/.claude-board-app/data/server.log` (macOS) or `%LOCALAPPDATA%\ClaudeBoard\data\server.log` (Windows).

## License

MIT © Invee Hub. Use, modify and distribute freely; keep the copyright notice.
