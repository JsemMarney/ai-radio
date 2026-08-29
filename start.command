#!/bin/bash
cd "$(dirname "$0")"

echo "=== Miss Radio ==="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Chybi Node.js. Nainstaluj z https://nodejs.org"
  read -r -p "Stiskni Enter pro ukonceni..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Instaluji zavislosti (npm install)..."
  npm install || exit 1
  echo
fi

if command -v lsof >/dev/null 2>&1; then
  for port in 8787 8788; do
    PIDS=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      echo "Zastavuji port $port (PID: $PIDS)..."
      kill $PIDS 2>/dev/null || true
    fi
  done
  sleep 1
fi

rm -f downloads/.radio-broadcast.lock 2>/dev/null || true

echo
echo "Web UI:     http://127.0.0.1:8787/player"
echo "Stream ICE: http://127.0.0.1:8788/stream"
echo "Ukonceni: Ctrl+C"
echo

(sleep 2 && open "http://127.0.0.1:8787/player" >/dev/null 2>&1) &

npm run dev
