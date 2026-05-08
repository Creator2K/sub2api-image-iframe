@echo off
setlocal

cd /d "%~dp0"

echo [image-iframe-app] starting dev servers...

if not exist "package.json" (
  echo [error] package.json not found. Please run this bat inside image-iframe-app.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [error] npm not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [init] created .env from .env.example. Please edit it if needed.
  )
)

if not exist "node_modules" (
  echo [init] node_modules not found, running npm install...
  call npm install
  if errorlevel 1 (
    echo [error] npm install failed.
    pause
    exit /b 1
  )
)

if not exist "logs" mkdir "logs"

rem Stop old listeners on dev ports first, to avoid EADDRINUSE.
call "%~dp0dev-stop.bat" /quiet

echo [start] backend  http://localhost:8787
start "image-iframe-backend" cmd /k "cd /d "%~dp0" && npm run dev:backend"

echo [start] frontend http://localhost:5179
start "image-iframe-frontend" cmd /k "cd /d "%~dp0" && npm run dev:frontend"

echo.
echo Done.
echo Frontend: http://localhost:5179/?user_id=1^&token=YOUR_SUB2API_JWT^&theme=light^&lang=zh^&ui_mode=embedded
echo Backend : http://localhost:8787/api/health
echo.
echo Use dev-stop.bat to close both dev servers.

endlocal
