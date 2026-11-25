# Instalador do Claude Board para Windows. No PowerShell:
#   irm https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download/install.ps1 | iex
# Instala em %LOCALAPPDATA%\ClaudeBoard (Node próprio, sem mexer no sistema), liga o Board em segundo plano
# (abre sozinho ao entrar no Windows) e cria o atalho "Claude Board" no Menu Iniciar e na Área de Trabalho.
# Rodar de novo = reinstalar/atualizar.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$BASE = 'https://github.com/therealjoaogabriel-oss/claude-board/releases/latest/download'
$APP = Join-Path $env:LOCALAPPDATA 'ClaudeBoard'; $PORT = 8830; $NODE_VER = 'v20.20.2'
function Say($t) { Write-Host "> $t" -ForegroundColor Yellow }

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
New-Item -ItemType Directory -Force -Path "$APP\data" | Out-Null

# para o Board que estiver rodando (reinstalação)
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe' OR Name='wscript.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$APP*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (-not (Test-Path "$APP\runtime\node.exe")) {
  Say 'Baixando o Node (só pro Board, não mexe no seu sistema)...'
  $t = Join-Path $env:TEMP ("cbnode" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $t | Out-Null
  Invoke-WebRequest "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-win-$arch.zip" -OutFile "$t\node.zip" -UseBasicParsing
  Expand-Archive "$t\node.zip" -DestinationPath $t -Force
  Remove-Item "$APP\runtime" -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item (Get-ChildItem $t -Directory | Where-Object Name -like 'node-*' | Select-Object -First 1).FullName "$APP\runtime"
  Remove-Item $t -Recurse -Force
}

Say 'Baixando o Claude Board...'
$info = Invoke-RestMethod "$BASE/latest.json?t=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -UseBasicParsing
$t = Join-Path $env:TEMP ("cbapp" + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Force -Path $t | Out-Null
Invoke-WebRequest $info.url -OutFile "$t\app.tgz" -UseBasicParsing
if ((Get-FileHash "$t\app.tgz" -Algorithm SHA256).Hash.ToLower() -ne $info.sha256) { throw 'Download corrompido, tente de novo.' }
Remove-Item "$APP\app.new" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$APP\app.new" | Out-Null
tar -xzf "$t\app.tgz" -C "$APP\app.new"
Remove-Item $t -Recurse -Force
Remove-Item "$APP\app.old" -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path "$APP\app") { Rename-Item "$APP\app" 'app.old' }
Rename-Item "$APP\app.new" 'app'

$cl = @("$env:USERPROFILE\.local\bin\claude.exe", "$env:APPDATA\npm\claude.cmd") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cl) {
  Say 'Instalando o Claude Code (o motor do Board)...'
  try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression } catch { Say 'Não consegui instalar o Claude Code agora; dá pra instalar depois pelo botão no Board.' }
}

# run.cmd reinicia o Board se ele sair (é assim que a atualização automática troca de versão)
@"
@echo off
set CB_MODE=local
set CB_DATA=$APP\data
set CB_UPDATE_URL=$BASE/latest.json
set PORT=$PORT
:loop
"$APP\runtime\node.exe" "$APP\app\server.js" >> "$APP\data\server.log" 2>&1
timeout /t 2 /nobreak >nul
goto loop
"@ | Set-Content -Path "$APP\run.cmd" -Encoding ASCII
# start.vbs roda o run.cmd sem janela
"CreateObject(""WScript.Shell"").Run """"""$APP\run.cmd"""""", 0, False" | Set-Content -Path "$APP\start.vbs" -Encoding ASCII

$sh = New-Object -ComObject WScript.Shell
$startup = [Environment]::GetFolderPath('Startup')
$lnk = $sh.CreateShortcut("$startup\Claude Board.lnk"); $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"; $lnk.Arguments = "`"$APP\start.vbs`""; $lnk.WindowStyle = 7; $lnk.Save()
$url = "[InternetShortcut]`r`nURL=http://localhost:$PORT`r`n"
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Claude Board.url'
$desk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude Board.url'
Set-Content -Path $menu -Value $url -Encoding ASCII; Set-Content -Path $desk -Value $url -Encoding ASCII

Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList "`"$APP\start.vbs`""
$ok = $false
for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest "http://127.0.0.1:$PORT/api/state" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true; break } catch { Start-Sleep 1 } }
if ($ok) {
  Say "Pronto! Claude Board $($info.version) instalado. Abra pelo atalho 'Claude Board' ou em http://localhost:$PORT"
  if (-not $env:CB_NO_OPEN) { Start-Process "http://localhost:$PORT" }
} else { Write-Host "O Board não respondeu. Veja o log: $APP\data\server.log" -ForegroundColor Red }
