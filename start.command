#!/bin/bash
cd "$(dirname "$0")"

echo "=== AI Radio ==="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Chybi Node.js. Nainstaluj z https://nodejs.org"
  read -r -p "Stiskni Enter pro ukonceni..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Instaluji zavislosti (npm install)..."
  npm install || {
    echo "npm install selhalo."
    read -r -p "Stiskni Enter pro ukonceni..."
    exit 1
  }
  echo
fi

if [ ! -f ".env.local" ] && [ -f ".env.example" ]; then
  echo "Poznamka: chybi .env.local (SPOTIFY_CLIENT_ID / SECRET)."
  echo "Zkopiruj .env.example -> .env.local a dopln klice."
  echo
fi

# Uvolni port 3000, pokud na nem jeste bezi stary Next server z tohoto projektu
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "Zastavuji stary server na portu 3000 (PID: $PIDS)..."
    # shellcheck disable=SC2086
    kill $PIDS 2>/dev/null || true
    sleep 1
  fi
fi

echo "Spoustim http://127.0.0.1:3000 ..."
echo "Ukonceni: Ctrl+C"
echo

(sleep 2 && open "http://127.0.0.1:3000" >/dev/null 2>&1) &

npm run dev -- -H 127.0.0.1 -p 3000
