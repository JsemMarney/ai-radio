@echo off
cd /d "%~dp0"

echo === AI Radio ===
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

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo Zastavuji stary server na portu 3000 ^(PID: %%a^)...
  taskkill /PID %%a /F >nul 2>&1
)

echo Spoustim http://127.0.0.1:3000 ...
echo Ukonceni: Ctrl+C
echo.

start "" "http://127.0.0.1:3000"
call npm run dev -- -H 127.0.0.1 -p 3000

pause
