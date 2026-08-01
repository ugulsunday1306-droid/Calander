@echo off
title UGUL Calander Updater
echo ===================================================
echo     UGUL Calander Standalone Updater
echo ===================================================
powershell -ExecutionPolicy Bypass -Command ^
  "$configPath = Join-Path '%~dp0' 'update_config.json'; " ^
  "if (-not (Test-Path $configPath)) { Write-Host '[ERROR] Config not found'; Read-Host; exit 1 }; " ^
  "$cfg = Get-Content $configPath -Raw | ConvertFrom-Json; " ^
  "$url = $cfg.downloadUrl; " ^
  "$appDir = $cfg.appRootDir; " ^
  "$zipPath = Join-Path $env:TEMP 'ugul_update.zip'; " ^
  "$extractDir = Join-Path $env:TEMP 'ugul_extracted'; " ^
  "Write-Host ''; " ^
  "Write-Host '[1/5] Terminating app...' -ForegroundColor Green; " ^
  "Start-Sleep -Seconds 2; " ^
  "Get-Process -Name UGULCalander -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; " ^
  "Start-Sleep -Seconds 1; " ^
  "Write-Host '-> Done' -ForegroundColor Cyan; " ^
  "Write-Host ''; " ^
  "Write-Host '[2/5] Downloading patch...' -ForegroundColor Green; " ^
  "Write-Host \"URL: $url\"; " ^
  "[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12; " ^
  "$wc = New-Object System.Net.WebClient; " ^
  "$wc.Headers.Add('User-Agent', 'UGUL-App'); " ^
  "try { $wc.DownloadFile($url, $zipPath); Write-Host '-> Download OK' -ForegroundColor Cyan } catch { Write-Host \"-> FAIL: $_\" -ForegroundColor Red; Read-Host; exit 1 }; " ^
  "Write-Host ''; " ^
  "Write-Host '[3/5] Extracting zip...' -ForegroundColor Green; " ^
  "if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }; " ^
  "Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force; " ^
  "Write-Host '-> Extract OK' -ForegroundColor Cyan; " ^
  "Write-Host ''; " ^
  "Write-Host '[4/5] Overwriting files...' -ForegroundColor Green; " ^
  "$src = $extractDir; " ^
  "$inner = Join-Path $extractDir 'UGULCalander-win32-x64'; " ^
  "if (Test-Path $inner) { $src = $inner }; " ^
  "Copy-Item -Path \"$src\*\" -Destination $appDir -Recurse -Force; " ^
  "Write-Host \"-> Overwrite OK into $appDir\" -ForegroundColor Cyan; " ^
  "Write-Host ''; " ^
  "Write-Host '[5/5] Restarting app...' -ForegroundColor Green; " ^
  "Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue; " ^
  "Remove-Item $zipPath -Force -ErrorAction SilentlyContinue; " ^
  "Remove-Item $configPath -Force -ErrorAction SilentlyContinue; " ^
  "$exe = Join-Path $appDir 'UGULCalander.exe'; " ^
  "if (Test-Path $exe) { Start-Process -FilePath $exe -WorkingDirectory $appDir; Write-Host '-> Launch OK' -ForegroundColor Cyan } " ^
  "else { Write-Host '-> EXE not found' -ForegroundColor Red }; " ^
  "Write-Host ''; " ^
  "Write-Host '=== Update Complete ===' -ForegroundColor Yellow; " ^
  "Start-Sleep -Seconds 2"
