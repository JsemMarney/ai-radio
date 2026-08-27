# AI Radio

Next.js appka: Spotify track/playlist → UUID knihovna (info + mp3) → rádio náhodně ze stažených písní.

## Požadavky

- Node.js 20+
- `yt-dlp` — `pip install yt-dlp`
- ffmpeg (volitelné, pro MP3) — systémově, nebo `pip install imageio-ffmpeg`
- Spotify API klíče: [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)

## Setup

```bash
npm install
cp .env.example .env.local
```

Do `.env.local`:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

## Spuštění

- macOS: dvojklik na `start.command`
- Windows: `start.bat`
- nebo `npm run dev`

Otevři [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Jak to funguje

1. Vložíš Spotify **track** nebo **playlist** (max 50 skladeb).
2. Metadata ze Spotify API, audio přes yt-dlp (YouTube search).
3. Každá píseň = `downloads/{uuid}/info.json` + `track.mp3`.
4. Stejné Spotify ID se znovu nestahuje.
5. **Radio** streamuje náhodně ze všech ready skladeb (shuffle bag bez opakování, dokud neprojde celá fronta). Po dohrání skladby server sám pustí další.

## Stream

Živý radio stream (jako Zeno.fm) — otevři v prohlížeči, VLC nebo jiném přehrávači:

```
http://127.0.0.1:3000/api/radio/stream
```

## API

- `POST /api/import` — `{ url }` → track nebo playlist job
- `GET /api/jobs/:id` — progress playlistu
- `GET /api/library` — seznam stažených
- `GET /api/audio/:uuid` — jednotlivý mp3 soubor
- `GET /api/radio/stream` — živý radio stream (audio/mpeg)
- `GET /api/radio/status` — právě hraje
- `POST /api/radio/skip` — přeskočit na další skladbu
- `POST /api/radio/play` — `{ uuid }` přehrát konkrétní skladbu v rádiu
