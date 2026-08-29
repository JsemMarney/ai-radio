import { execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const tmp = path.join(root, "downloads", "_jingle-build");
const out = path.join(root, "public", "jingle.mp3");

/** Mixkit CDN — free commercial use (Mixkit License). */
const ASSETS = {
  music: "https://assets.mixkit.co/music/745/745.mp3",
  riser: "https://assets.mixkit.co/active_storage/sfx/2608/2608-preview.mp3",
  impact: "https://assets.mixkit.co/active_storage/sfx/2908/2908-preview.mp3",
  chimes: "https://assets.mixkit.co/active_storage/sfx/2015/2015-preview.mp3",
};

/** Ženský český hlas bývá v mixu srozumitelnější než mužský neural TTS. */
const VOICE = "cs-CZ-VlastaNeural";
const VOICE_LINE = "Posloucháte AI Rádio!";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function download(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Stažení selhalo (${res.status}): ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

async function generateVoice(dest) {
  const custom = process.env.RADIO_JINGLE_VOICE_WAV?.trim();
  if (custom) {
    const resolved = path.isAbsolute(custom) ? custom : path.join(root, custom);
    if (existsSync(resolved)) {
      console.log("[jingle] Používám vlastní hlas:", resolved);
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i",
          resolved,
          "-af",
          "highpass=f=90,equalizer=f=3200:width_type=h:width=1800:g=2,alimiter=limit=0.98",
          dest,
        ],
        { timeout: 60_000 },
      );
      return;
    }
    console.warn("[jingle] RADIO_JINGLE_VOICE_WAV nenalezen, generuji TTS…");
  }

  await execFileAsync(
    "edge-tts",
    [
      "--voice",
      VOICE,
      "--rate=+2%",
      "--volume=+30%",
      "--text",
      VOICE_LINE,
      "--write-media",
      dest,
    ],
    { timeout: 60_000 },
  );
}

/**
 * Layout: riser → hit → HLAS V ČISTĚ (bez hudby) → hudební outro.
 * TTS jinak zní jako „nic tam nemluví“, když je pod mixem.
 */
async function mixJingle({ riser, impact, voice, music, chimes, dest }) {
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      riser,
      "-i",
      impact,
      "-i",
      voice,
      "-i",
      music,
      "-i",
      chimes,
      "-filter_complex",
      [
        "[0:a]atrim=0:0.48,asetpts=PTS-STARTPTS,volume=0.7[riserFx]",
        "[1:a]atrim=0:0.35,asetpts=PTS-STARTPTS,adelay=380|380,volume=1.1[hitFx]",
        "[2:a]adelay=620|620,highpass=f=100,equalizer=f=3200:width_type=h:width=1800:g=3,compand=0.05|0.05:1|1:-90/-65/-40/-3/-3/-3/0:6:0:-90:0.05,alimiter=limit=0.98,volume=2.8[voiceFx]",
        "[3:a]atrim=0:4.8,asetpts=PTS-STARTPTS,highpass=f=100,lowpass=f=12000,volume=0.55,afade=t=in:st=3.15:d=0.12,afade=t=out:st=4.35:d=0.4[bedOutro]",
        "[4:a]atrim=0:0.7,adelay=3100|3100,asetpts=PTS-STARTPTS,volume=0.4[chimesFx]",
        "[riserFx][hitFx]amix=inputs=2:duration=longest:dropout_transition=0,afade=t=out:st=0.55:d=0.08,volume=0.9[introFx]",
        "[introFx][voiceFx]amix=inputs=2:duration=longest:dropout_transition=0:weights=0.25 1[vBlock]",
        "[vBlock][bedOutro]amix=inputs=2:duration=longest:dropout_transition=0[m1]",
        "[m1][chimesFx]amix=inputs=2:duration=longest:dropout_transition=0[m2]",
        "[m2]loudnorm=I=-13:TP=-0.5:LRA=7",
      ].join(";"),
      "-t",
      "4.8",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "2",
      dest,
    ],
    { timeout: 120_000 },
  );
}

async function run() {
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  await mkdir(path.dirname(out), { recursive: true });

  const files = {
    riser: path.join(tmp, "riser.mp3"),
    impact: path.join(tmp, "impact.mp3"),
    voice: path.join(tmp, "voice.mp3"),
    music: path.join(tmp, "music.mp3"),
    chimes: path.join(tmp, "chimes.mp3"),
  };

  console.log("[jingle] Stahuji SFX a hudbu…");
  await Promise.all([
    download(ASSETS.riser, files.riser),
    download(ASSETS.impact, files.impact),
    download(ASSETS.music, files.music),
    download(ASSETS.chimes, files.chimes),
  ]);

  console.log("[jingle] Generuji český hlas…");
  try {
    await generateVoice(files.voice);
  } catch (err) {
    throw new Error(
      "Edge TTS není k dispozici. Nainstaluj: pip install edge-tts\n" +
        "Nebo nahraj vlastní WAV/MP3 a nastav RADIO_JINGLE_VOICE_WAV=cesta/k/hlasu.wav\n" +
        (err.message ?? err),
    );
  }

  console.log("[jingle] Mixuji (hit → hlas v čistě → outro)…");
  await mixJingle({ ...files, dest: out });

  await rm(tmp, { recursive: true, force: true });
  console.log(`[jingle] Hotovo → ${out}`);
  console.log("[jingle] Restartuj broadcaster (start.bat), jinak hraje starý soubor z paměti.");
}

run().catch((err) => {
  console.error("[jingle] Selhalo:", err.message ?? err);
  process.exit(1);
});
