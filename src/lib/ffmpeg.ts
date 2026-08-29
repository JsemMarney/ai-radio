import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  "ffmpeg",
  path.join(process.env.USERPROFILE ?? "", "scoop", "shims", "ffmpeg.exe"),
  path.join(
    process.env.LOCALAPPDATA ?? "",
    "Microsoft",
    "WinGet",
    "Links",
    "ffmpeg.exe",
  ),
  "C:\\ffmpeg\\bin\\ffmpeg.exe",
  path.join(
    process.env.LOCALAPPDATA ?? "",
    "Programs",
    "ffmpeg",
    "bin",
    "ffmpeg.exe",
  ),
  path.join(
    process.env.HOME ?? "",
    "Library/Python/3.9/lib/python/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1",
  ),
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
].filter(Boolean) as string[];

let cachedFfmpeg: string | null | undefined;

export async function resolveFfmpeg(): Promise<string | null> {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;

  for (const candidate of FFMPEG_CANDIDATES) {
    try {
      await execFileAsync(candidate, ["-version"], { timeout: 8000 });
      cachedFfmpeg = candidate;
      return candidate;
    } catch {
      // try next
    }
  }

  cachedFfmpeg = null;
  return null;
}

export async function probeDuration(filepath: string): Promise<number | null> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) return null;

  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");

  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filepath,
      ],
      { timeout: 30_000 },
    );
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    try {
      await execFileAsync(
        ffmpeg,
        ["-i", filepath, "-f", "null", "-"],
        { timeout: 60_000 },
      );
    } catch (error: unknown) {
      const stderr =
        error && typeof error === "object" && "stderr" in error
          ? String((error as { stderr: Buffer }).stderr)
          : "";
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return null;
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      const total = hours * 3600 + minutes * 60 + seconds;
      return total > 0 ? total : null;
    }
    return null;
  }
}

export function getCrossfadeSec(): number {
  const raw = Number(process.env.RADIO_CROSSFADE_SEC ?? 4);
  return Number.isFinite(raw) && raw > 0 ? raw : 4;
}

export function getRadioTransition(): "crossfade" | "cut" {
  return process.env.RADIO_TRANSITION === "cut" ? "cut" : "crossfade";
}

export function mp3EncodeArgs(
  mapLabel?: string,
  outputPath = "pipe:1",
): string[] {
  const args: string[] = [];
  if (mapLabel) args.push("-map", mapLabel);
  args.push(
    "-f", "mp3",
    "-c:a", "libmp3lame",
    "-b:a", "192k",
    "-minrate", "192k",
    "-maxrate", "192k",
    "-bufsize", "384k",
    "-write_xing", "0",
    outputPath,
  );
  return args;
}

/** @deprecated use buildCrossfadeFilterGraph from audio-process.ts */
export function buildCrossfadeFilter(fadeSec: number): string {
  const d = fadeSec.toFixed(3);
  return (
    `[0:a]dynaudnorm=f=150:g=10[a0];` +
    `[1:a]dynaudnorm=f=150:g=10[a1];` +
    `[a0][a1]acrossfade=d=${d}:c1=exp:c2=exp[aout]`
  );
}
