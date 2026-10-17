import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getDownloadsDir, isTrackId } from "@/lib/library";
import { ensureBroadcastFile } from "@/lib/remaster";

const execFileAsync = promisify(execFile);

/**
 * Podkres pod mluvené slovo. Zdroje:
 *  - "builtin"        — vestavěný klidný pad (vygeneruje se jednou přes ffmpeg),
 *  - "file:<název>"   — vlastní soubor v public/beds/,
 *  - "track:<uuid>"   — skladba z knihovny (hraje potichu).
 */
export type BedOption = { id: string; label: string };

const BED_EXT = /\.(mp3|wav|m4a|ogg|flac)$/i;

function bedsDir(): string {
  return path.join(process.cwd(), "public", "beds");
}

export function listBedOptions(): BedOption[] {
  const options: BedOption[] = [{ id: "builtin", label: "Klidný podkres (vestavěný)" }];
  const dir = bedsDir();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (BED_EXT.test(name)) {
        options.push({ id: `file:${name}`, label: name.replace(BED_EXT, "") });
      }
    }
  }
  return options;
}

/** Vestavěný pad: akord A dur s pomalým vlněním, filtr + ozvěna, 64 s ve smyčce. */
async function ensureBuiltinBed(ffmpegPath: string): Promise<string | null> {
  const dir = path.join(getDownloadsDir(), "_bed");
  const out = path.join(dir, "pad-v1.mp3");
  if (existsSync(out)) return out;
  await mkdir(dir, { recursive: true });

  const voices = [
    [110, 0.07, 0.05, 0],
    [220, 0.06, 0.1, 1],
    [277.18, 0.05, 0.13, 2],
    [329.63, 0.05, 0.07, 3],
    [440, 0.025, 0.05, 4],
  ]
    .map(
      ([freq, amp, lfo, phase]) =>
        `${amp}*sin(2*PI*${freq}*t)*(0.6+0.4*sin(2*PI*${lfo}*t+${phase}))`,
    )
    .join("+");

  const tmp = `${out}.tmp.mp3`;
  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi",
        "-i", `aevalsrc='${voices}|${voices}':s=44100:d=64`,
        "-af", "lowpass=f=1600,aecho=0.8:0.6:180|370:0.25|0.15,afade=t=in:d=3,afade=t=out:st=61:d=3,loudnorm=I=-20",
        "-ac", "2",
        "-b:a", "192k",
        tmp,
      ],
      { timeout: 120_000 },
    );
    await rename(tmp, out);
    return out;
  } catch (err) {
    console.warn("[bed] Vestavěný podkres se nepodařilo vygenerovat:", err);
    return null;
  }
}

/** Najde soubor podkresu. Neznámé / neplatné volby spadnou na vestavěný pad. */
export async function resolveBedPath(choice: string, ffmpegPath: string): Promise<string | null> {
  if (choice.startsWith("file:")) {
    const name = path.basename(choice.slice(5));
    const file = path.join(bedsDir(), name);
    if (BED_EXT.test(name) && existsSync(file)) return file;
  } else if (choice.startsWith("track:")) {
    const uuid = choice.slice(6);
    if (isTrackId(uuid)) {
      const file = await ensureBroadcastFile(uuid).catch(() => null);
      if (file) return file;
    }
  }
  const envPath = process.env.RADIO_BED_PATH?.trim();
  if (choice === "builtin" && envPath) {
    const file = path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
    if (existsSync(file)) return file;
  }
  return ensureBuiltinBed(ffmpegPath);
}
