# AI Radio

Vlastní internetové rádio: Spotify → stažené MP3 → živý HTTP stream s crossfade přechody.

## Požadavky

- Node.js 20+
- `yt-dlp` — `pip install yt-dlp`
- **ffmpeg** (povinné pro MP3 a crossfade) — `scoop install ffmpeg` / `brew install ffmpeg`
- Spotify API klíče: [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)

## Setup

```bash
npm install
cp .env.example .env.local
```

Vyplň `.env.local` — minimálně Spotify klíče, `STUDIO_PASSWORD` a branding.

## Spuštění

```bash
npm run dev
```

- **Posluchači:** [http://127.0.0.1:8787/player](http://127.0.0.1:8787/player)
- **Studio (import):** [http://127.0.0.1:8787/studio](http://127.0.0.1:8787/studio)
- **Stream URL:** `http://127.0.0.1:8787/api/radio/stream` (VLC, telefon…)

## Jak to funguje

1. Ve **studiu** importuješ Spotify track nebo playlist (max 50 skladeb).
2. yt-dlp stáhne audio, ffmpeg uloží jako `track.mp3` do `downloads/{uuid}/`.
3. Broadcaster **pořád běží** jako rádio: každá skladba má vlastní dekodér, mixer
   je skládá v PCM (crossfade, jingle, skip s fadem) a jeden trvalý MP3 enkodér
   posílá souvislý stream všem posluchačům — žádné mezery mezi skladbami.
4. **Rotace:** skladba se nezopakuje, dokud nezazní ~60 % knihovny, stejný
   interpret ne dřív než po 3 jiných, zbytek je vážený los (déle nehraná = větší šance).
5. **Chytrý mix:** každá skladba se jednou změří (hlasitost LUFS + kde začíná a
   jak končí). Hlasitost se dorovná na cíl stanice, přechod se přizpůsobí: skladba,
   která sama doznívá, se prolne dřív, tvrdý konec se nechá dohrát, tiché intro
   nastoupí pod konec předchozí.
6. Nový posluchač dostane pár sekund z bufferu (burst), takže hraje okamžitě.
   Vedle MP3 běží i úsporný AAC stream (`?format=aac`) — přehrávač ho volí na
   mobilu nebo podle přepínače kvality.
7. Když není co hrát, místo ticha jde záložní jingle (`public/jingle.mp3`).
8. Posluchači se připojí na `/player` nebo přímo na stream URL.

## Stránky

| URL | Přístup | Účel |
|-----|---------|------|
| `/player` | Veřejný | Poslech, QR kód, nedávno hrálo |
| `/studio` | Heslo (`STUDIO_PASSWORD`) | Vysílání, fronta (drag & drop), knihovna, statistiky, import, re-master |
| `/api/radio/stream` | Veřejný | Živý audio stream |

## Env proměnné

| Proměnná | Popis |
|----------|-------|
| `SPOTIFY_CLIENT_ID` / `SECRET` | Spotify API |
| `STUDIO_PASSWORD` | Heslo pro studio a admin API |
| `STATION_NAME` | Název stanice |
| `STATION_TAGLINE` | Podtitul |
| `STATION_LOGO_URL` | Cesta k logu (např. `/brand/logo.svg`) |
| `STATION_COLOR_*` | Barvy UI |
| `RADIO_CROSSFADE_SEC` | Délka crossfade v sekundách (default 4) |
| `RADIO_CROSSFADE_CURVE` | `equalpower` (doporučeno), `linear`, `exp`, `log`, `qsin` |
| `RADIO_TRANSITION` | `crossfade` nebo `cut` |
| `RADIO_STREAM_BITRATE` | Bitrate streamu v kbps (default 192) |
| `RADIO_BURST_SEC` | Kolik sekund dostane nový posluchač hned (default 2.5) |
| `RADIO_SONG_SEPARATION` | Podíl knihovny, který musí zaznít před opakováním (default 0.6) |
| `RADIO_ARTIST_SPACING` | Min. počet jiných interpretů mezi stejným (default 3) |
| `RADIO_TARGET_LUFS` | Cílová hlasitost stanice (default -16) |
| `RADIO_AAC` | `0` vypne druhý (AAC) stream |
| `RADIO_AAC_BITRATE` | Bitrate AAC streamu v kbps (default 96) |
| `RADIO_FALLBACK_PATH` | Co hrát místo ticha (default `public/jingle.mp3`) |
| `SESSION_SECRET` | Klíč pro podpis přihlášení do studia (dlouhý náhodný řetězec) |
| `TRUST_PROXY` | `1` jen za vlastní reverse proxy (nginx/Caddy) — pak se věří `X-Forwarded-For` |
| `RADIO_MIC_WS_URL` | Adresa WebSocketu pro mikrofon ve studiu (default `ws://<host>:8788/mic`, za proxy např. `wss://radio.cz/mic`) |
| `RADIO_REQUESTS_MODERATION` | `0` = přání jdou rovnou do fronty bez schválení (default: schvaluje moderátor) |
| `RADIO_REQUESTS_PER_IP` | Kolik přání může jedna IP poslat za 10 min (default 2) |
| `ICECAST_SOURCE_PASSWORD` / `ICECAST_ADMIN_PASSWORD` | Hesla Icecastu (min. 12 znaků, ne `hackme`) |

## Přání posluchačů

Posluchač vybere skladbu, může připsat **od koho** a **vzkaz** (max 200 znaků,
bez odkazů, sprostá slova se vyhvězdičkují). Přání se objeví ve studiu v panelu
**Přání posluchačů** — moderátor ho schválí (jde do fronty) nebo zamítne.
Neschválená přání propadnou po 30 minutách. Posluchač vidí stav svého přání
přímo v přehrávači. Když přání zazní, vzkaz se ukáže velký ve studiu
(„Přečti do éteru“) i posluchačům pod názvem skladby.

## Mikrofon (živý vstup)

Ve studiu je panel **Mikrofon** → „Do éteru". Hlas jde přes WebSocket do
broadcasteru a mixuje se do streamu. Když mluvíš, hudba se sama ztlumí
(nastavitelné −8 / −14 / −20 dB / úplně) a po ~1 s ticha se vrátí.
Používej sluchátka; posluchači tě slyší se zpožděním pár sekund.

Za reverse proxy přesměruj `/mic` (WebSocket upgrade) na port broadcasteru
a nastav `RADIO_MIC_WS_URL`.

## Zabezpečení

- **Heslo do studia** (`STUDIO_PASSWORD`) musí mít aspoň 12 znaků. V produkci je
  studio se slabým nebo výchozím heslem zamčené.
- Přihlášení platí 7 dní, odhlášení token okamžitě zneplatní. Změna hesla odhlásí všechny.
- Přihlašování je omezené (5 pokusů / 15 min na IP za proxy, 20 pokusů / 15 min celkem).
- Měnící požadavky z cizích webů se odmítají (kontrola `Origin`), stránky mají CSP
  a další bezpečnostní hlavičky.
- `config/icecast.xml` se generuje ze šablony `config/icecast.example.xml` a hesel
  v `.env.local` — **necommituj ho**. Icecast se slabými hesly nenastartuje.

## Veřejné nasazení

1. **VPS / Railway / Fly.io** s Node 20+, ffmpeg a yt-dlp v PATH.
2. **Persistent disk** pro složku `downloads/`.
3. **HTTPS** (Let's Encrypt) — nutné pro autoplay v prohlížečích.
4. Nastav env proměnné na serveru (necommituj `.env.local`). Za reverse proxy přidej `TRUST_PROXY=1`.
5. Sdílej `https://tvoje-domena.cz/player` a stream `https://tvoje-domena.cz/api/radio/stream`.

### Produkcí

```bash
npm run build
npm run start
```

## API

**Veřejné:**
- `GET /api/radio/stream` — živý stream
- `GET /api/radio/status` — právě hraje, recently played
- `GET /api/station/config` — branding

**Chráněné (studio heslo):**
- `POST /api/import` — import Spotify
- `GET /api/library` — knihovna
- `DELETE /api/library/:uuid` — smazat skladbu
- `POST /api/radio/skip` — další skladba
- `POST /api/radio/play` — `{ uuid }` přehrát teď
- `POST /api/studio/login` / `logout`
