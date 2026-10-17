import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { readTrackInfo, writeTrackInfo } from "@/lib/library";

/**
 * Analýza skladby pro mix — jeden průchod ffmpeg:
 *  - integrovaná hlasitost (EBU R128) → gain na cílovou hlasitost stanice,
 *  - energetický profil po 100 ms → kde skladba opravdu začíná a jak končí.
 */
export type MixAnalysis = {
  v: number;
  file: string;
  size: number;
  /** Integrovaná hlasitost v LUFS. */
  lufs: number | null;
  /** Délka slyšitelného audia (bez koncového ticha). */
  playEnd: number;
  /** Kdy skladba poprvé dosáhne plné síly (tiché intro před tím). */
  introAt: number;
  /** Kdy skladba naposledy hraje plnou silou (začátek outra / fade-outu). */
  outroAt: number;
  /** Kdy fade-out klesne zhruba na polovinu — ideální start další skladby. */
  mixAt: number;
};

const VERSION = 1;
const WINDOW_SEC = 0.1;
const ANALYSIS_RATE = 4000;

export function getTargetLufs(): number {
  const raw = Number(process.env.RADIO_TARGET_LUFS ?? -16);
  return Number.isFinite(raw) ? Math.min(Math.max(raw, -30), -8) : -16;
}

/** Lineární gain pro dorovnání na cílovou hlasitost (omezeno ±). */
export function loudnessGain(lufs: number | null | undefined): number {
  if (lufs == null || !Number.isFinite(lufs)) return 1;
  const db = Math.min(Math.max(getTargetLufs() - lufs, -12), 9);
  return Math.pow(10, db / 20);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return -60;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

/** Klouzavý průměr energie (v lineární doméně) → dB. */
function smooth(db: number[], radius: number): number[] {
  const lin = db.map((d) => Math.pow(10, d / 10));
  const out: number[] = [];
  for (let i = 0; i < lin.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(lin.length - 1, i + radius); j++) {
      sum += lin[j]!;
      n++;
    }
    out.push(10 * Math.log10(sum / n + 1e-12));
  }
  return out;
}

export function computeCues(windowsDb: number[]): Omit<MixAnalysis, "v" | "file" | "size" | "lufs"> {
  const n = windowsDb.length;
  const total = n * WINDOW_SEC;
  if (n < 20) {
    return { playEnd: total, introAt: 0, outroAt: total, mixAt: total };
  }

  let lastAudible = n - 1;
  while (lastAudible > 0 && windowsDb[lastAudible]! < -45) lastAudible--;
  const playEnd = Math.min(total, (lastAudible + 1) * WINDOW_SEC);

  const s = smooth(windowsDb, 4);
  const ref = percentile(
    s.filter((d) => d > -50),
    0.8,
  );

  let intro = 0;
  while (intro < lastAudible && s[intro]! < ref - 9) intro++;

  let outro = lastAudible;
  while (outro > intro && s[outro]! < ref - 3) outro--;

  let mix = outro;
  while (mix < lastAudible && s[mix]! >= ref - 10) mix++;

  return {
    playEnd,
    introAt: intro * WINDOW_SEC,
    outroAt: Math.min(playEnd, (outro + 1) * WINDOW_SEC),
    mixAt: Math.min(playEnd, mix * WINDOW_SEC),
  };
}

function runAnalysis(
  ffmpegPath: string,
  filepath: string,
): Promise<{ windowsDb: number[]; lufs: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpegPath,
      [
        "-hide_banner", "-nostats", "-loglevel", "info",
        "-i", filepath,
        "-vn",
        "-af", `ebur128=peak=none,aresample=${ANALYSIS_RATE},pan=mono|c0=0.5*c0+0.5*c1`,
        "-f", "s16le", "-acodec", "pcm_s16le",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );

    const samplesPerWindow = Math.round(ANALYSIS_RATE * WINDOW_SEC);
    const windowsDb: number[] = [];
    let acc = 0;
    let count = 0;
    let carry: Buffer | null = null;
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      const buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const v = buf.readInt16LE(i) / 32768;
        acc += v * v;
        count++;
        if (count === samplesPerWindow) {
          windowsDb.push(10 * Math.log10(acc / count + 1e-12));
          acc = 0;
          count = 0;
        }
      }
      carry = usable < buf.length ? buf.subarray(usable) : null;
    });
    proc.stderr.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-6000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg analýza skončila s kódem ${code}`));
        return;
      }
      const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
      const m = summary.match(/I:\s*(-?[\d.]+)\s*LUFS/);
      const lufs = m ? Number(m[1]) : null;
      resolve({
        windowsDb,
        lufs: lufs !== null && Number.isFinite(lufs) && lufs > -70 ? lufs : null,
      });
    });
  });
}

const memoryCache = new Map<string, MixAnalysis>();

/**
 * Vrátí analýzu z cache (info.json skladby / paměť), nebo ji spočítá.
 * Analýza běží během hraní předchozí skladby, takže nezdržuje vysílání.
 */
export async function getMixAnalysis(
  ffmpegPath: string,
  filepath: string,
  uuid?: string,
): Promise<MixAnalysis | null> {
  const st = await stat(filepath).catch(() => null);
  if (!st) return null;
  const file = path.basename(filepath);
  const key = `${filepath}:${st.size}`;

  const mem = memoryCache.get(key);
  if (mem) return mem;

  const info = uuid ? await readTrackInfo(uuid) : null;
  const stored = info?.mixAnalysis;
  if (stored && stored.v === VERSION && stored.file === file && stored.size === st.size) {
    memoryCache.set(key, stored);
    return stored;
  }

  try {
    const { windowsDb, lufs } = await runAnalysis(ffmpegPath, filepath);
    const analysis: MixAnalysis = {
      v: VERSION,
      file,
      size: st.size,
      lufs,
      ...computeCues(windowsDb),
    };
    memoryCache.set(key, analysis);
    if (uuid) {
      const fresh = await readTrackInfo(uuid);
      if (fresh) await writeTrackInfo({ ...fresh, mixAnalysis: analysis });
    }
    return analysis;
  } catch (err) {
    console.warn(
      `[mix] Analýza ${file} selhala:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export type TransitionPlan = {
  /** Kolik sekund před koncem A začne B. */
  overlapSec: number;
  /** Délka fade-outu A (končí s koncem A). */
  fadeOutSec: number;
  /** Fade-in B. */
  fadeInSec: number;
  kind: "natural-fade" | "hard-end" | "blend" | "fixed";
};

/**
 * Naplánuje přechod A → B podle toho, jak A končí a B začíná
 * (jako zkušený DJ, ne pevných N sekund).
 */
export function planTransition(
  a: Pick<MixAnalysis, "playEnd" | "outroAt" | "mixAt"> | null,
  b: Pick<MixAnalysis, "introAt"> | null,
  durA: number,
  maxCrossfadeSec: number,
): TransitionPlan {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const limit = Math.max(0.5, Math.min(12, durA * 0.3));

  if (!a) {
    const x = clamp(maxCrossfadeSec, 0.5, limit);
    return { overlapSec: x, fadeOutSec: x, fadeInSec: x * 0.5, kind: "fixed" };
  }

  const end = Math.min(durA, a.playEnd);
  const fadeLen = Math.max(0, end - a.outroAt);
  const quietIntro = b ? clamp(b.introAt, 0, 8) : 0;
  const hasQuietIntro = quietIntro >= 1.5;

  if (fadeLen >= 3) {
    // A si sama doznívá → B nastoupí, když fade klesne zhruba na půl.
    const overlap = clamp(end - a.mixAt, 1.5, limit);
    return {
      overlapSec: overlap,
      fadeOutSec: overlap,
      fadeInSec: hasQuietIntro ? 0.05 : Math.min(1.5, overlap * 0.5),
      kind: "natural-fade",
    };
  }

  if (fadeLen < 1.2) {
    // Tvrdý konec (poslední úder) — nechat dohrát, nestahovat.
    const overlap = hasQuietIntro ? Math.min(quietIntro, 4, limit) : 0.35;
    return {
      overlapSec: overlap,
      fadeOutSec: 0.35,
      fadeInSec: hasQuietIntro ? 0.05 : 0.05,
      kind: "hard-end",
    };
  }

  const blend = clamp(Math.max(fadeLen, hasQuietIntro ? quietIntro : 0), 1.5, Math.min(limit, maxCrossfadeSec));
  return {
    overlapSec: blend,
    fadeOutSec: clamp(fadeLen, 1.2, blend),
    fadeInSec: hasQuietIntro ? 0.05 : blend * 0.5,
    kind: "blend",
  };
}
