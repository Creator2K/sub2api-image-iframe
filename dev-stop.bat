@echo off
setlocal

cd /d "%~dp0"
set QUIET=%~1

if /I not "%QUIET%"=="/quiet" echo [image-iframe-app] stopping dev servers...

rem Kill processes listening on dev ports.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports=@(8787,5179); $conns=Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue; $ids=$conns | Select-Object -ExpandProperty OwningProcess -Unique; foreach($id in $ids){ if($id -and $id -ne $PID){ try { Stop-Process -Id $id -Force -ErrorAction Stop; Write-Host ('[stop] killed pid ' + $id) } catch {} } }" 2>nul

rem Fallback: close windows opened by dev-start.bat.
taskkill /FI "WINDOWTITLE eq image-iframe-backend*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq image-iframe-frontend*" /T /F >nul 2>nul

if /I not "%QUIET%"=="/quiet" echo Done.

endlocal
