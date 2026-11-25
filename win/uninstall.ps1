# Remove o Claude Board do Windows. Suas conversas do Claude Code (%USERPROFILE%\.claude) NÃO são apagadas.
# Pra apagar também os quadros/pastas do Board: $env:CB_PURGE=1 antes de rodar.
$APP = Join-Path $env:LOCALAPPDATA 'ClaudeBoard'
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe' OR Name='wscript.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$APP*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'Claude Board.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Claude Board.url') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude Board.url') -Force -ErrorAction SilentlyContinue
foreach ($d in 'app', 'app.old', 'app.new', 'runtime') { Remove-Item (Join-Path $APP $d) -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item "$APP\run.cmd", "$APP\start.vbs" -Force -ErrorAction SilentlyContinue
if ($env:CB_PURGE) { Remove-Item $APP -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host 'Claude Board removido.'
