@echo off
cd /d "%~dp0"

echo === Miss Radio ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Chybi Node.js. Nainstaluj z https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Instaluji zavislosti ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo npm install selhalo.
    pause
    exit /b 1
  )
  echo.
)

if not exist ".env.local" if exist ".env.example" (
  echo Poznamka: chybi .env.local ^(SPOTIFY_CLIENT_ID / SECRET^).
  echo Zkopiruj .env.example -^> .env.local a dopln klice.
  echo.
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do (
  echo Zastavuji stary web server na portu 8787 ^(PID: %%a^)...
  taskkill /PID %%a /F >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8788" ^| findstr "LISTENING"') do (
  echo Zastavuji stary broadcaster na portu 8788 ^(PID: %%a^)...
  taskkill /PID %%a /F >nul 2>&1
)

if exist "downloads\.radio-broadcast.lock" (
  del /f /q "downloads\.radio-broadcast.lock" >nul 2>&1
)

echo.
echo Spoustim web (8787) + broadcaster (8788)...
echo Web UI:       http://127.0.0.1:8787/player
echo Stream ICE:   http://127.0.0.1:8788/stream  ^(VLC, telefon^)
echo.
echo DULEZITE: musi bezet OBA procesy ^(web + radio^). V logu hledej [radio] i [web].
echo Ukonceni: Ctrl+C
echo.

start "" "http://127.0.0.1:8787/player"
call npm run dev

pause
