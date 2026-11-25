# Claude Board

[English](README.md) · **Português** · [Español](README.es.md)

**Desenvolvido pela [Invee Hub](https://inveehub.com.br).**

Um quadro livre, no estilo n8n/Miro, para as suas conversas do **Claude Code**. Ele lê as mesmas conversas da extensão e do terminal (`~/.claude/projects`). Com ele você:

- **Arrasta as conversas para onde quiser** no quadro, cria áreas, notas e ligações, e organiza tudo em vários quadros e pastas.
- **Acompanha ao vivo** o raciocínio, as ferramentas, os diffs e as tarefas de cada conversa.
- **Continua ou cria conversas** escolhendo modelo, esforço e permissão. Os modelos vêm da lista oficial da sua conta e se atualizam sozinhos.
- **Enfileira mensagens** enquanto o Claude trabalha, com o botão "enviar agora".
- **Anexa imagens e arquivos.**
- **Fala em vez de digitar:** o 🎤 grava e transcreve com o serviço de voz do próprio Claude Code. Um áudio solto na conversa também vira texto.
- **Vê o uso e os limites oficiais** da conta (5 h e semana), o contexto de cada conversa e o consumo de tokens.
- **Compacta sozinho as conversas longas** antes de enviar, preservando decisões, pendências e arquivos, para gastar menos token.
- **Usa o menu `/`** com os comandos e skills, e configura o Claude Code (modelo, esforço, permissões, MCP, skills) pela tela.
- **Escolhe o tema:** modo dia ou noite.

Não tem dependências de npm: é só Node 20 e um único `server.js`. Nada sai da sua máquina além das chamadas que o próprio Claude Code já faz.

> Projeto da comunidade, **não oficial**. Não tem ligação com a Anthropic. "Claude" é marca da Anthropic.

## Instalar no Mac (1 comando)

```bash
curl -fsSL https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/install.sh | bash
```

O instalador:

1. Baixa um Node só para o Board, sem mexer no seu sistema.
2. Instala o Claude Code, se ainda não estiver instalado.
3. Liga o Board em segundo plano, abrindo sozinho ao ligar o Mac.
4. Cria o atalho **Claude Board** em Aplicativos.

O endereço fica em `http://localhost:8830`. Para entrar com a sua conta, clique em **Entrar com Claude**: o login é o oficial do Claude Code, e o Board nunca vê a sua senha.

**Atualização automática:** o app confere a última release deste repositório e se atualiza sozinho, conferindo o sha256 do pacote.

Para remover:

```bash
curl -fsSL https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/uninstall.sh | bash
```

Isso não apaga as suas conversas do Claude Code.

## Instalar no Windows (1 comando)

No **PowerShell** (não precisa ser administrador):

```powershell
irm https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/install.ps1 | iex
```

O instalador:

1. Instala o Board em `%LOCALAPPDATA%\ClaudeBoard`, com um Node próprio.
2. Instala o Claude Code, se ainda não estiver instalado.
3. Liga o Board em segundo plano, sem janela, abrindo sozinho ao entrar no Windows.
4. Cria o atalho **Claude Board** no Menu Iniciar e na Área de Trabalho.

O Windows também recebe a atualização automática pelas releases. Para remover:

```powershell
irm https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/uninstall.ps1 | iex
```

## Rodar num servidor Linux (VPS)

Neste modo, cada resposta roda num serviço próprio do systemd. Assim o Claude continua trabalhando mesmo com a aba fechada ou o computador desligado.

Requisitos:

- Linux com systemd.
- Node 20 ou mais novo.
- Claude Code instalado e logado no usuário que roda o Board.
- `sudo` sem senha para `systemd-run`.

Passos:

```bash
git clone https://github.com/therealjoaogabriel-oss/claude-board.git && cd claude-board
cp .env.example .env    # defina BOARD_PASSWORD
node server.js          # escuta em 127.0.0.1:8830
```

Coloque um proxy com HTTPS na frente, por exemplo o Caddy:

```
board.seudominio.com {
  reverse_proxy 127.0.0.1:8830
}
```

Exemplo de serviço do systemd em `/etc/systemd/system/claude-board.service`:

```ini
[Unit]
Description=Claude Board
After=network.target

[Service]
User=SEU_USUARIO
WorkingDirectory=/caminho/para/claude-board
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

### Segurança

O Board controla o Claude Code da máquina, inclusive no modo "sem pedir permissão". Por isso:

- Use sempre uma senha forte e HTTPS.
- Nunca abra a porta 8830 direto para a internet.
- Uma conta Claude por pessoa: cada um instala o app no próprio computador.

## Configuração (.env)

Veja o `.env.example`. As principais opções são:

| Variável | O que faz |
|---|---|
| `BOARD_PASSWORD` | Senha de acesso. Obrigatória no modo servidor. |
| `PORT` / `BIND` | Porta e IPs onde o Board escuta. |
| `CB_SERVICES` | Serviços do systemd mostrados no Dashboard. |
| `CB_STT_TERMS` | Nomes próprios que ajudam a transcrição de voz. |
| `CLAUDE_BIN` | Caminho do Claude Code, se não estiver no PATH. |

## Publicar a sua própria versão

```bash
mac/build-release.sh 1.2.3   # gera dist/ com o pacote, o latest.json e os scripts do Mac e do Windows
```

Depois, crie a release `v1.2.3` e envie os arquivos de `dist/`. Os Macs instalados se atualizam sozinhos.

## Contribuir

Issues e pull requests são bem-vindos, principalmente:

- Traduções da interface (inglês, espanhol e outras).
- Testes em versões diferentes do Windows e do macOS.
- Relatos de erro com o log em `~/.claude-board-app/data/server.log` (macOS) ou `%LOCALAPPDATA%\ClaudeBoard\data\server.log` (Windows).

## Licença

MIT © Invee Hub. Pode usar, modificar e distribuir; mantenha o aviso de copyright.
