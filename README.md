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
3. Server **pořád běží** jako rádio — shuffle bag, bez opakování dokud neprojde celá knihovna.
4. Mezi skladbami je **crossfade ~4 s** (ffmpeg `acrossfade`).
5. Posluchači se připojí na `/player` nebo přímo na stream URL.

## Stránky

| URL | Přístup | Účel |
|-----|---------|------|
| `/player` | Veřejný | Poslech, QR kód, nedávno hrálo |
| `/studio` | Heslo (`STUDIO_PASSWORD`) | Import, knihovna, skip, do rádií |
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
| `RADIO_CROSSFADE_SEC` | Délka crossfade (default 4) |
| `RADIO_TRANSITION` | `crossfade` nebo `cut` |

## Veřejné nasazení

1. **VPS / Railway / Fly.io** s Node 20+, ffmpeg a yt-dlp v PATH.
2. **Persistent disk** pro složku `downloads/`.
3. **HTTPS** (Let's Encrypt) — nutné pro autoplay v prohlížečích.
4. Nastav env proměnné na serveru (necommituj `.env.local`).
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
