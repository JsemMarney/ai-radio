# Miss Radio — nasazení na Pterodactyl

Tenhle balík je připravený pro **Pterodactyl s Node.js eggem** (generic Node.js,
Node 20 nebo novější). Web, rádio i mikrofon ze studia běží na **jednom portu**.

## 1. Nahrání

1. Ve správci souborů serveru nahraj ZIP a dej **Unarchive** (rozbalit do kořene,
   aby `index.js` a `package.json` byly přímo v `/home/container`).
2. Přejmenuj `.env.example` na `.env.local` a vyplň aspoň:
   `STUDIO_PASSWORD` (min. 12 znaků), `SESSION_SECRET`, `BROKER_SECRET`
   a Spotify klíče.

## 2. Startup v panelu

- **Main file / MAIN_FILE:** `index.js`
- **Node.js verze:** 20 nebo 22
- Egg při startu spustí `npm install` sám (stáhne Next.js a ffmpeg).
  Pokud tvůj egg `npm install` nespouští, spusť ho jednou ručně v konzoli
  nebo nastav startup příkaz na `npm install && node index.js`.
- Při prvním startu se do `bin/` stáhne `yt-dlp` (pro import skladeb).

## 3. Hotovo

- Přehrávač: `http://<IP>:<port>/player`
- Studio: `http://<IP>:<port>/studio`
- Stream (VLC): `http://<IP>:<port>/api/radio/stream`

Knihovna skladeb a stav rádia se ukládají do složky `downloads/` —
při aktualizaci ji **nemaž** a ZIP rozbaluj přes stávající soubory.

## Mikrofon a HTTPS

Prohlížeč pustí mikrofon jen na **HTTPS** (nebo na localhostu). Na holé
`http://IP:port` adrese mikrofon ve studiu nepůjde — dej před server doménu
s HTTPS (Cloudflare, reverse proxy) a v `.env.local` nastav `TRUST_PROXY=1`.

## Aktualizace

Nahraj nový ZIP, rozbal přes stávající soubory (přepsat) a restartuj server.
`downloads/` a `.env.local` zůstanou.
