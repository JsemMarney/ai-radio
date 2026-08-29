import { execFile } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { promisify } from "node:util";
import { BROADCAST_FILENAME } from "@/lib/library";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { probeDuration } from "@/lib/ffmpeg";

const execFileAsync = promisify(execFile);

export type AudioTrim = {
  trimStart: number;
  trimEnd: number;
  playDuration: number;
};

/** Presety křivky crossfade (ffmpeg acrossfade c1/c2). */
export type CrossfadeCurvePreset =
  | "equalpower"
  | "linear"
  | "tri"
  | "exp"
  | "log"
  | "qsin";

export type AudioProcessSettings = {
  silenceThresholdDb: number;
  silenceMinSec: number;
  crossfadeCurve: CrossfadeCurvePreset;
  normalize: boolean;
  trimSilence: boolean;
  /** Usek na přesnou délku skladby dle Spotify (bez YT intro/outro). */
  catalogAlign: boolean;
};

function normalizeCrossfadePreset(raw: string): CrossfadeCurvePreset {
  const key = raw.trim().toLowerCase();
  if (key === "ep" || key === "constantpower" || key === "equal-power") {
    return "equalpower";
  }
  if (key === "linear") return "linear";
  const valid = new Set<CrossfadeCurvePreset>([
    "equalpower",
    "linear",
    "tri",
    "exp",
    "log",
    "qsin",
  ]);
  if (valid.has(key as CrossfadeCurvePreset)) {
    return key as CrossfadeCurvePreset;
  }
  return "equalpower";
}

/** Equal Power = hsin/hsin — konstantní hlasitost uprostřed přechodu. */
export function resolveCrossfadeCurves(
  settings = getAudioProcessSettings(),
): { c1: string; c2: string } {
  switch (settings.crossfadeCurve) {
    case "linear":
    case "tri":
      return { c1: "tri", c2: "tri" };
    case "exp":
      return { c1: "exp", c2: "log" };
    case "log":
      return { c1: "log", c2: "log" };
    case "qsin":
      return { c1: "qsin", c2: "qsin" };
    case "equalpower":
    default:
      return { c1: "hsin", c2: "hsin" };
  }
}

export function getAudioProcessSettings(): AudioProcessSettings {
  const threshold = Number(process.env.RADIO_SILENCE_THRESHOLD ?? -42);
  const minSec = Number(process.env.RADIO_SILENCE_MIN_SEC ?? 0.25);
  const curve = normalizeCrossfadePreset(
    process.env.RADIO_CROSSFADE_CURVE ?? "equalpower",
  );

  return {
    silenceThresholdDb: Number.isFinite(threshold) ? threshold : -42,
    silenceMinSec: Number.isFinite(minSec) && minSec > 0 ? minSec : 0.25,
    crossfadeCurve: curve,
    normalize: process.env.RADIO_AUDIO_NORMALIZE !== "0",
    trimSilence: process.env.RADIO_SILENCE_TRIM !== "0",
    catalogAlign: process.env.RADIO_CATALOG_ALIGN !== "0",
  };
}

export async function probeSilenceBoundaries(
  filepath: string,
  ffmpeg: string,
  settings = getAudioProcessSettings(),
): Promise<AudioTrim> {
  const duration = (await probeDuration(filepath)) ?? 0;
  if (duration <= 0) {
    return { trimStart: 0, trimEnd: 0, playDuration: 0 };
  }

  const noise = `${settings.silenceThresholdDb}dB`;
  const minD = settings.silenceMinSec;

  let stderr = "";
  try {
    const result = await execFileAsync(
      ffmpeg,
      [
        "-hide_banner",
        "-i",
        filepath,
        "-af",
        `silencedetect=noise=${noise}:d=${minD}`,
        "-f",
        "null",
        "-",
      ],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    stderr = String(result.stderr ?? "");
  } catch (error: unknown) {
    stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: Buffer }).stderr)
        : "";
  }

  return parseSilenceDetect(stderr, duration, minD);
}

function parseSilenceDetect(
  stderr: string,
  duration: number,
  minGap: number,
): AudioTrim {
  const starts: number[] = [];
  const ends: number[] = [];

  for (const line of stderr.split("\n")) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);
    if (startMatch) starts.push(parseFloat(startMatch[1]));
    if (endMatch) ends.push(parseFloat(endMatch[1]));
  }

  let trimStart = 0;
  if (starts.length && starts[0] <= 0.05 && ends.length) {
    trimStart = ends[0];
  }

  let trimEnd = 0;
  const lastStart = starts.at(-1);
  const lastEnd = ends.at(-1);
  if (lastStart !== undefined && lastStart > trimStart + minGap) {
    const tailAfterLastSilence =
      lastEnd !== undefined ? duration - lastEnd : duration - lastStart;
    // Finální ticho / padding — skladba končí na silence_start, ne na kontejneru.
    if (duration - lastStart > 0.5 || tailAfterLastSilence > 0.25) {
      trimEnd = duration - lastStart;
    }
  }

  const playDuration = Math.max(0, duration - trimStart - trimEnd);
  return { trimStart, trimEnd, playDuration };
}

async function measureMeanVolume(
  filepath: string,
  ffmpeg: string,
  startSec: number,
): Promise<number | null> {
  try {
    const result = await execFileAsync(
      ffmpeg,
      [
        "-y",
        "-ss",
        String(Math.max(0, startSec)),
        "-i",
        filepath,
        "-t",
        "1",
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const stderr = String(result.stderr ?? "");
    const match = stderr.match(/mean_volume:\s*([-\d.]+)/);
    return match ? parseFloat(match[1]!) : null;
  } catch (error: unknown) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: Buffer }).stderr)
        : "";
    const match = stderr.match(/mean_volume:\s*([-\d.]+)/);
    return match ? parseFloat(match[1]!) : null;
  }
}

/** Najde okno délky Spotify — jen samotná skladba, bez YT balastu na začátku/konci. */
export async function probeBestSongWindow(
  filepath: string,
  ffmpeg: string,
  probedDuration: number,
  catalogDuration: number,
): Promise<{ trimStart: number; trimEnd: number }> {
  if (probedDuration <= catalogDuration + 1) {
    return {
      trimStart: 0,
      trimEnd: Math.max(0, probedDuration - catalogDuration),
    };
  }

  const maxStart = probedDuration - catalogDuration;
  const refT = Math.min(
    maxStart * 0.35 + catalogDuration * 0.4,
    probedDuration - 6,
  );
  const refSamples = await Promise.all([
    measureMeanVolume(filepath, ffmpeg, refT),
    measureMeanVolume(filepath, ffmpeg, refT + 3),
    measureMeanVolume(filepath, ffmpeg, refT + 6),
  ]);
  const refVals = refSamples.filter((v): v is number => v !== null);
  const refMean =
    refVals.length > 0
      ? refVals.reduce((a, b) => a + b, 0) / refVals.length
      : -17;

  let bestStart = 0;
  let bestScore = -Infinity;

  for (let start = 0; start <= maxStart; start += 2) {
    const head = await measureMeanVolume(filepath, ffmpeg, start);
    const mid = await measureMeanVolume(
      filepath,
      ffmpeg,
      start + catalogDuration * 0.45,
    );
    const tail = await measureMeanVolume(
      filepath,
      ffmpeg,
      start + catalogDuration - 3,
    );
    if (head === null || mid === null || tail === null) continue;

    const match =
      -Math.abs(head - refMean) -
      Math.abs(mid - refMean) -
      Math.abs(tail - refMean);
    const body = -(Math.abs(head - mid) + Math.abs(mid - tail));
    const score = match + body * 0.35;

    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  const trimEnd = Math.max(0, probedDuration - bestStart - catalogDuration);
  return { trimStart: bestStart, trimEnd };
}

/** @deprecated — použij probeBestSongWindow */
export async function probeCatalogAlignTrim(
  filepath: string,
  ffmpeg: string,
  probedDuration: number,
  catalogDuration: number,
  silenceTrim: AudioTrim,
): Promise<{ trimStart: number; trimEnd: number }> {
  const window = await probeBestSongWindow(
    filepath,
    ffmpeg,
    probedDuration,
    catalogDuration,
  );
  return {
    trimStart: Math.max(silenceTrim.trimStart, window.trimStart),
    trimEnd: Math.max(silenceTrim.trimEnd, window.trimEnd),
  };
}

/** Délka slyšitelného audia (bez koncového ticha / MP3 paddingu). */
export async function probePlayableDuration(
  filepath: string,
  ffmpeg: string,
  settings = getAudioProcessSettings(),
): Promise<number> {
  const container = (await probeDuration(filepath)) ?? 0;
  if (container <= 0) return 0;

  const { trimStart, trimEnd, playDuration } = await probeSilenceBoundaries(
    filepath,
    ffmpeg,
    settings,
  );
  const end = container - trimEnd;
  if (end > trimStart + 0.5) return end;
  if (playDuration > 0.5) return trimStart + playDuration;
  return container;
}

export function buildEnhanceFilter(settings = getAudioProcessSettings()): string {
  const parts: string[] = [
    "highpass=f=35",
    "lowpass=f=18000",
    "deesser=i=0.25",
  ];

  if (settings.trimSilence) {
    const th = `${settings.silenceThresholdDb}dB`;
    const d = settings.silenceMinSec;
    // Pouze úvodní ticho — stop_periods=1 občas zničí celou skladbu (~1 s výstup).
    parts.push(
      `silenceremove=start_periods=1:start_duration=${d}:start_threshold=${th}:stop_periods=0:detection=peak`,
    );
  }

  if (settings.normalize) {
    parts.push(
      "acompressor=threshold=-22dB:ratio=2.5:attack=8:release=120:makeup=1.5",
      "loudnorm=I=-16:TP=-1.5:LRA=8",
      "alimiter=limit=-0.5dB:attack=3:release=80",
    );
  }

  return parts.join(",");
}

export function getCutFadeSec(): number {
  const raw = Number(process.env.RADIO_CUT_FADE_SEC ?? 0.12);
  return Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 1) : 0.12;
}

/** Hlasitost odcházející skladby při crossfade (0–1). Nižší = víc ducking. */
export function getDuckVolume(): number {
  const db = Number(process.env.RADIO_DUCKING_DB ?? 2.5);
  const clamped = Number.isFinite(db) ? Math.min(Math.max(db, 0), 12) : 2.5;
  return Math.pow(10, -clamped / 20);
}

export type JingleConfig = {
  path: string | null;
  everyNTracks: number;
};

export function getJingleConfig(): JingleConfig {
  const raw = process.env.RADIO_JINGLE_PATH?.trim();
  const every = Number(process.env.RADIO_JINGLE_EVERY ?? 4);
  let resolved: string | null = null;
  if (raw) {
    if (existsSync(raw)) resolved = path.resolve(raw);
    else {
      const fromCwd = path.join(process.cwd(), raw);
      if (existsSync(fromCwd)) resolved = fromCwd;
    }
  }
  return {
    path: resolved,
    everyNTracks: Number.isFinite(every) && every > 0 ? Math.floor(every) : 4,
  };
}

export type MidsongConfig = {
  paths: string[];
  everyNTracks: number;
  chance: number;
  fadeSec: number;
};

function resolveMediaPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (existsSync(trimmed)) return path.resolve(trimmed);
  const fromCwd = path.join(process.cwd(), trimmed);
  if (existsSync(fromCwd)) return fromCwd;
  return null;
}

/** Krátké mezihry (MIDSONGS) mezi skladbami — lineární fade out/in. */
export function getMidsongConfig(): MidsongConfig {
  const fadeRaw = Number(
    process.env.RADIO_MIDSONG_FADE_SEC ?? process.env.RADIO_CROSSFADE_SEC ?? 4,
  );
  const every = Number(process.env.RADIO_MIDSONG_EVERY ?? 1);
  const chance = Number(process.env.RADIO_MIDSONG_CHANCE ?? 1);

  const paths: string[] = [];
  const raw = process.env.RADIO_MIDSONG_PATH?.trim();
  if (raw) {
    for (const part of raw.split(",")) {
      const resolved = resolveMediaPath(part);
      if (resolved) paths.push(resolved);
    }
  }

  if (!paths.length) {
    const dir = path.join(process.cwd(), "public");
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (/^MIDSONGS-.+\.(wav|mp3|m4a|flac)$/i.test(name)) {
          paths.push(path.join(dir, name));
        }
      }
    }
  }

  return {
    paths,
    everyNTracks: Number.isFinite(every) && every > 0 ? Math.floor(every) : 1,
    chance:
      Number.isFinite(chance) && chance >= 0
        ? Math.min(chance, 1)
        : 1,
    fadeSec:
      Number.isFinite(fadeRaw) && fadeRaw > 0 ? Math.min(fadeRaw, 12) : 4,
  };
}

export function pickMidsongPath(config: MidsongConfig): string | null {
  if (!config.paths.length) return null;
  const idx = Math.floor(Math.random() * config.paths.length);
  return config.paths[idx] ?? null;
}

/** Lineární fade na konci skladby (curve=tri). */
export function computeTailFade(dur: number, fadeSec: number): number {
  return Math.max(0, Math.min(fadeSec, dur * 0.35, dur - 0.25));
}

export function buildTailLinearFadeFilter(dur: number, fadeSec: number): string {
  const fade = computeTailFade(dur, fadeSec);
  if (fade <= 0.05) {
    return `[0:a]${DECODE_STEREO}[aout]`;
  }
  const st = Math.max(0, dur - fade).toFixed(3);
  const d = fade.toFixed(3);
  return `[0:a]${DECODE_STEREO},afade=t=out:st=${st}:d=${d}:curve=tri[aout]`;
}

export function buildHeadLinearFadeFilter(fadeSec: number): string {
  const fade = Math.max(0.05, Math.min(fadeSec, 8));
  const d = fade.toFixed(3);
  return `[0:a]${DECODE_STEREO},afade=t=in:st=0:d=${d}:curve=tri[aout]`;
}

export type MidsongPreviewTiming = {
  fade: number;
  leadSec: number;
  tailAStart: number;
  headBSec: number;
  duration: number;
  resumeOffsetSec: number;
};

/** Načasování live testu: konec A → midsong → začátek B. */
export function getMidsongPreviewTiming(
  durA: number,
  durB: number,
  midsongDur: number,
  fadeSec: number,
): MidsongPreviewTiming {
  const fade = computeTailFade(Math.min(durA, 120), fadeSec);
  const leadSec = Math.min(14, Math.max(5, fade + 4));
  const tailAStart = Math.max(0, durA - leadSec);
  const headBSec = Math.min(18, Math.max(8, fade + 6));
  const duration = leadSec + midsongDur + headBSec;
  return {
    fade,
    leadSec,
    tailAStart,
    headBSec,
    duration,
    resumeOffsetSec: Math.min(headBSec, durB),
  };
}

export function buildMidsongPreviewFilterGraph(
  timing: MidsongPreviewTiming,
  durA: number,
  midsongDur: number,
): string {
  const segmentA = Math.max(0.1, durA - timing.tailAStart);
  const fade = computeTailFade(segmentA, timing.fade);
  const fadeOutSt = Math.max(0, segmentA - fade).toFixed(3);
  const fd = fade.toFixed(3);
  const fdIn = Math.max(0.05, fade).toFixed(3);
  const start = timing.tailAStart.toFixed(3);
  const head = timing.headBSec.toFixed(3);
  const mid = midsongDur.toFixed(3);

  return [
    `[0:a]${DECODE_STEREO},atrim=start=${start},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeOutSt}:d=${fd}:curve=tri[a0]`,
    `[1:a]${DECODE_STEREO},atrim=0:${mid},asetpts=PTS-STARTPTS[m0]`,
    `[2:a]${DECODE_STEREO},atrim=0:${head},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fdIn}:curve=tri[b0]`,
    `[a0][m0][b0]concat=n=3:v=0:a=1[aout]`,
  ].join(";");
}

const DECODE_STEREO =
  "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";

/** Společný výpočet délky crossfade pro pár skladeb. */
export function computePairFade(
  durA: number,
  durB: number,
  fadeSec: number,
): number {
  return Math.max(
    0,
    Math.min(fadeSec, durA * 0.35, durB * 0.35, durA - 0.25, durB - 0.25),
  );
}

export type TransitionPreviewTiming = {
  fade: number;
  leadSec: number;
  startA: number;
  effectiveDurA: number;
  tailBSec: number;
  duration: number;
  resumeOffsetSec: number;
};

/** Načasování ukázky přechodu (live test / náhled). */
export function getTransitionPreviewTiming(
  durA: number,
  durB: number,
  fadeSec: number,
): TransitionPreviewTiming {
  const fade = computePairFade(durA, durB, fadeSec);
  const leadSec = Math.min(12, Math.max(4, fade + 3));
  const startA = Math.max(0, durA - fade - leadSec);
  const effectiveDurA = durA - startA;
  const tailBSec = Math.min(20, Math.max(8, fade + 5));
  const duration = Math.min(effectiveDurA + tailBSec, leadSec + fade + tailBSec);
  return {
    fade,
    leadSec,
    startA,
    effectiveDurA,
    tailBSec,
    duration,
    resumeOffsetSec: fade + tailBSec,
  };
}

/** @deprecated — použij buildPairCrossfadeFilterGraph + resolveCrossfadeCurves. */
export function buildCrossfadeFilterGraph(
  fadeSec: number,
  settings = getAudioProcessSettings(),
): string {
  const d = fadeSec.toFixed(3);
  const { c1, c2 } = resolveCrossfadeCurves(settings);

  return `[0:a][1:a]acrossfade=d=${d}:c1=${c1}:c2=${c2}[aout]`;
}

/**
 * Celý průběh A → B: acrossfade na konci A a začátku B (bez concat/atrim hacků).
 * Výstup ≈ durA + durB − fade.
 */
export function buildPairCrossfadeFilterGraph(
  durA: number,
  durB: number,
  fadeSec: number,
  settings = getAudioProcessSettings(),
): string {
  const fade = computePairFade(durA, durB, fadeSec);
  const d = fade.toFixed(3);
  const { c1, c2 } = resolveCrossfadeCurves(settings);

  if (fade <= 0.05) {
    return `[0:a]${DECODE_STEREO}[aout]`;
  }

  return [
    `[0:a]${DECODE_STEREO}[aa]`,
    `[1:a]${DECODE_STEREO}[bb]`,
    `[aa][bb]acrossfade=d=${d}:c1=${c1}:c2=${c2}[aout]`,
  ].join(";");
}

/**
 * Náhled / test přechodu — konec skladby A (od startA) plynule do B.
 */
export function buildTransitionPreviewFilterGraph(
  startA: number,
  durA: number,
  durB: number,
  fadeSec: number,
  settings = getAudioProcessSettings(),
): string {
  const effectiveLen = Math.max(0, durA - startA);
  const fade = computePairFade(effectiveLen, durB, fadeSec);
  const d = fade.toFixed(3);
  const { c1, c2 } = resolveCrossfadeCurves(settings);
  const start = Math.max(0, startA).toFixed(3);

  return [
    `[0:a]${DECODE_STEREO},atrim=${start},asetpts=PTS-STARTPTS[aa]`,
    `[1:a]${DECODE_STEREO}[bb]`,
    `[aa][bb]acrossfade=d=${d}:c1=${c1}:c2=${c2}[aout]`,
  ].join(";");
}

/** Sekunda od začátku páru, kdy začne crossfade (pro UI metadata). */
export function pairCrossfadeStartSec(
  durA: number,
  durB: number,
  fadeSec: number,
): number {
  const fade = computePairFade(durA, durB, fadeSec);
  return Math.max(0, durA - fade);
}

/** @deprecated — plný enhance chain; pro crossfade už stačí pre-render. */
export function buildCrossfadeFilterGraphLegacy(
  fadeSec: number,
  settings = getAudioProcessSettings(),
): string {
  const d = fadeSec.toFixed(3);
  const c1 = settings.crossfadeCurve;
  const c2 = settings.crossfadeCurve;
  const enhance = buildEnhanceFilter({ ...settings, trimSilence: false });
  const duck = getDuckVolume().toFixed(4);

  return (
    `[0:a]${enhance},volume=${duck}[a0];` +
    `[1:a]${enhance}[a1];` +
    `[a0][a1]acrossfade=d=${d}:c1=exp:c2=${c2}[aout]`
  );
}

export function buildStreamFilter(): string | null {
  return null;
}

export function buildCutTransitionFilter(
  fadeOutSec: number,
  durationSec: number,
): string | null {
  if (fadeOutSec <= 0) return null;
  const outStart = Math.max(0, durationSec - fadeOutSec);
  return `afade=t=out:st=${outStart.toFixed(3)}:d=${fadeOutSec.toFixed(3)}`;
}

export function buildFadeInFilter(fadeInSec: number): string | null {
  if (fadeInSec <= 0) return null;
  return `afade=t=in:st=0:d=${fadeInSec.toFixed(3)}`;
}

export async function masterTrackFile(
  inputPath: string,
  outputPath: string,
  ffmpeg: string,
  settings = getAudioProcessSettings(),
  catalogDuration?: number | null,
): Promise<AudioTrim> {
  const before = (await probeDuration(inputPath)) ?? 0;
  const boundaries = settings.trimSilence
    ? await probeSilenceBoundaries(inputPath, ffmpeg, settings)
    : { trimStart: 0, trimEnd: 0, playDuration: before };

  let trimStart = Math.max(0, boundaries.trimStart);
  let trimEnd = Math.max(0, boundaries.trimEnd);

  if (
    settings.catalogAlign &&
    catalogDuration &&
    catalogDuration > 20 &&
    before > catalogDuration + 1
  ) {
    const window = await probeBestSongWindow(
      inputPath,
      ffmpeg,
      before,
      catalogDuration,
    );
    trimStart = Math.max(trimStart, window.trimStart);
    trimEnd = Math.max(trimEnd, window.trimEnd);
  }

  const tempPath = `${outputPath}.tmp.mp3`;
  const playDuration = Math.max(0, before - trimStart - trimEnd);

  const args = ["-y"];
  if (trimStart > 0.01) args.push("-ss", String(trimStart));
  args.push(
    "-i",
    inputPath,
    ...(playDuration > 0.5 ? ["-t", String(playDuration)] : []),
    "-vn",
    "-af",
    buildEnhanceFilter(settings),
    "-acodec",
    "libmp3lame",
    "-q:a",
    "2",
    tempPath,
  );

  await execFileAsync(ffmpeg, args, { timeout: 600_000 });

  const after = (await probeDuration(tempPath)) ?? 0;
  const expected = playDuration > 0 ? playDuration : before;
  if (expected > 15 && after < expected * 0.5) {
    const { unlink } = await import("node:fs/promises");
    await unlink(tempPath).catch(() => {});
    throw new Error(
      `Remaster výstup příliš krátký (${after.toFixed(1)} s, očekáváno ~${expected.toFixed(0)} s)`,
    );
  }

  const { rename } = await import("node:fs/promises");
  await rename(tempPath, outputPath);

  return {
    trimStart,
    trimEnd: boundaries.trimEnd,
    playDuration: after > 0 ? after : expected,
  };
}

/** Pre-render: mastered MP3 + kopie jako broadcast soubor. */
export async function renderBroadcastFile(
  inputPath: string,
  trackDir: string,
  ffmpeg: string,
  settings = getAudioProcessSettings(),
  catalogDuration?: number | null,
): Promise<{ masterPath: string; broadcastPath: string; trim: AudioTrim }> {
  const masterPath = `${trackDir}/track.mp3`;
  const broadcastPath = `${trackDir}/${BROADCAST_FILENAME}`;

  const trim = await masterTrackFile(
    inputPath,
    masterPath,
    ffmpeg,
    settings,
    catalogDuration,
  );
  await copyFile(masterPath, broadcastPath);

  return { masterPath, broadcastPath, trim };
}

