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

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
  echo Zastavuji stary Icecast na portu 8000 ^(PID: %%a^)...
  taskkill /PID %%a /F >nul 2>&1
)

if exist "downloads\.radio-broadcast.lock" (
  del /f /q "downloads\.radio-broadcast.lock" >nul 2>&1
)

set ICECAST_ON=0
if exist ".env.local" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /R /I "^ICECAST_ENABLED=" .env.local`) do (
    set "ICECAST_VAL=%%B"
  )
)
if /I "%ICECAST_VAL%"=="1" set ICECAST_ON=1
if /I "%ICECAST_VAL%"=="true" set ICECAST_ON=1
if /I "%ICECAST_VAL%"=="yes" set ICECAST_ON=1
if /I "%ICECAST_VAL%"=="on" set ICECAST_ON=1

echo.
if "%ICECAST_ON%"=="1" (
  echo Spoustim web ^(8787^) + broadcaster ^(8788^) + Icecast ^(8000^)...
  echo Web UI:       http://127.0.0.1:8787/player
  echo Icecast:      http://127.0.0.1:8000/radio.mp3  ^(VLC, posluchaci^)
  echo Studio API:   http://127.0.0.1:8788
  echo.
  echo Icecast musi byt nainstalovany ^(https://icecast.org/download/^).
) else (
  echo Spoustim web ^(8787^) + broadcaster ^(8788^)...
  echo Web UI:       http://127.0.0.1:8787/player
  echo Stream:       http://127.0.0.1:8788/stream  ^(VLC, telefon^)
  echo.
  echo Icecast je vypnuty ^(ICECAST_ENABLED=0 v .env.local^).
)
echo Ukonceni: Ctrl+C
echo.

start "" "http://127.0.0.1:8787/player"
if "%ICECAST_ON%"=="1" (
  call npm run dev:all
) else (
  call npm run dev
)

pause
