# Claude Board

[English](README.md) · [Português](README.pt-BR.md) · **Español**

**Desarrollado por [Invee Hub](https://inveehub.com.br).**

Un lienzo libre, estilo n8n/Miro, para tus conversaciones de **Claude Code**. Lee las mismas sesiones que la extensión y la terminal (`~/.claude/projects`). Con él puedes:

- **Arrastrar las conversaciones a donde quieras** en el lienzo, crear áreas, notas y conexiones, y organizar todo en varios tableros y carpetas.
- **Seguir en vivo** el razonamiento, las herramientas, los diffs y las tareas de cada conversación.
- **Continuar o crear conversaciones** eligiendo modelo, esfuerzo y modo de permisos. Los modelos vienen de la lista oficial de tu cuenta y se actualizan solos.
- **Poner mensajes en cola** mientras Claude trabaja, con el botón "enviar ahora".
- **Adjuntar imágenes y archivos.**
- **Hablar en lugar de escribir:** el 🎤 graba y transcribe con el servicio de voz del propio Claude Code. Un audio suelto en la conversación también se convierte en texto.
- **Ver el uso y los límites oficiales** de la cuenta (5 h y semana), el contexto de cada conversación y el consumo de tokens.
- **Compactar solo las conversaciones largas** antes de enviar, conservando decisiones, pendientes y archivos, para gastar menos tokens.
- **Usar el menú `/`** con comandos y skills, y configurar Claude Code (modelo, esfuerzo, permisos, MCP, skills) desde la interfaz.
- **Elegir el tema:** claro u oscuro.

Sin dependencias de npm: solo Node 20 y un único `server.js`. Nada sale de tu máquina además de las llamadas que Claude Code ya hace.

> Proyecto de la comunidad, **no oficial**. Sin relación con Anthropic. "Claude" es una marca de Anthropic.
>
> Por ahora la interfaz está en portugués de Brasil. Las traducciones son bienvenidas, ver [Contribuir](#contribuir).

## Instalar en macOS (1 comando)

```bash
curl -fsSL https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/install.sh | bash
```

El instalador:

1. Descarga un Node solo para el Board, sin tocar tu sistema.
2. Instala Claude Code si todavía no está instalado.
3. Ejecuta el Board en segundo plano y lo abre solo al iniciar sesión.
4. Crea el acceso directo **Claude Board** en Aplicaciones.

Funciona en `http://localhost:8830`. Para entrar, haz clic en **Entrar com Claude** (Entrar con Claude): es el login oficial de Claude Code y el Board nunca ve tu contraseña.

**Actualización automática:** la app revisa la última release de este repositorio y se actualiza sola, verificando el sha256 del paquete.

Para desinstalar:

```bash
curl -fsSL https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/uninstall.sh | bash
```

Esto no borra tus conversaciones de Claude Code.

## Instalar en Windows (1 comando)

En **PowerShell** (no hace falta ser administrador):

```powershell
irm https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/install.ps1 | iex
```

El instalador:

1. Instala el Board en `%LOCALAPPDATA%\ClaudeBoard`, con un Node propio.
2. Instala Claude Code si todavía no está instalado.
3. Ejecuta el Board en segundo plano, sin ventana, y lo abre solo al iniciar sesión.
4. Crea el acceso directo **Claude Board** en el Menú Inicio y en el Escritorio.

Windows también se actualiza solo desde las releases. Para desinstalar:

```powershell
irm https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/uninstall.ps1 | iex
```

## Ejecutar en un servidor Linux (VPS)

En este modo cada respuesta corre en su propia unidad de systemd, así Claude sigue trabajando aunque cierres la pestaña o apagues la computadora.

Requisitos:

- Linux con systemd.
- Node 20 o más reciente.
- Claude Code instalado y con sesión iniciada en el usuario que ejecuta el Board.
- `sudo` sin contraseña para `systemd-run`.

Pasos:

```bash
git clone https://github.com/therealjoaogabriel-oss/claude-board.git && cd claude-board
cp .env.example .env    # define BOARD_PASSWORD
node server.js          # escucha en 127.0.0.1:8830
```

Pon un proxy con HTTPS delante, por ejemplo Caddy:

```
board.tudominio.com {
  reverse_proxy 127.0.0.1:8830
}
```

Ejemplo de servicio de systemd en `/etc/systemd/system/claude-board.service`:

```ini
[Unit]
Description=Claude Board
After=network.target

[Service]
User=TU_USUARIO
WorkingDirectory=/ruta/a/claude-board
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

### Seguridad

El Board controla Claude Code en la máquina, incluso en el modo "sin pedir permiso". Por eso:

- Usa siempre una contraseña fuerte y HTTPS.
- Nunca expongas el puerto 8830 directamente a internet.
- Una cuenta de Claude por persona: cada uno instala la app en su propia computadora.

## Configuración (.env)

Mira el `.env.example`. Opciones principales:

| Variable | Qué hace |
|---|---|
| `BOARD_PASSWORD` | Contraseña de acceso. Obligatoria en modo servidor. |
| `PORT` / `BIND` | Puerto e IPs donde escucha el Board. |
| `CB_SERVICES` | Servicios de systemd mostrados en el Dashboard. |
| `CB_STT_TERMS` | Nombres propios que ayudan a la transcripción de voz. |
| `CLAUDE_BIN` | Ruta de Claude Code, si no está en el PATH. |

## Publicar tu propia versión

```bash
mac/build-release.sh 1.2.3   # genera dist/ con el paquete, el latest.json y los scripts de macOS y Windows
```

Después crea la release `v1.2.3` y sube los archivos de `dist/`. Las apps instaladas se actualizan solas.

## Contribuir

Issues y pull requests son bienvenidos, sobre todo:

- Traducciones de la interfaz (inglés, español y otros).
- Pruebas en distintas versiones de Windows y macOS.
- Reportes de errores con el log en `~/.claude-board-app/data/server.log` (macOS) o `%LOCALAPPDATA%\ClaudeBoard\data\server.log` (Windows).

## Licencia

MIT © Invee Hub. Úsalo, modifícalo y distribúyelo libremente; mantén el aviso de copyright.
