import { execFile } from "node:child_process";
import { access, constants, mkdir, readdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  createTrackRecord,
  findBySpotifyId,
  getDownloadsDir,
  getTrackDir,
  toPublicTrack,
  writeTrackInfo,
  type LibraryTrack,
} from "@/lib/library";
import {
  searchQueryForTrack,
  type SpotifyTrackMeta,
} from "@/lib/spotify";

const execFileAsync = promisify(execFile);

const YTDLP_CANDIDATES = [
  process.env.YTDLP_PATH,
  path.join(process.cwd(), "bin", "yt-dlp"),
  path.join(process.cwd(), "bin", "yt-dlp.exe"),
  path.join(process.env.HOME ?? "", "Library/Python/3.9/bin/yt-dlp"),
  path.join(process.env.HOME ?? "", "Library/Python/3.10/bin/yt-dlp"),
  path.join(process.env.HOME ?? "", "Library/Python/3.11/bin/yt-dlp"),
  path.join(process.env.HOME ?? "", "Library/Python/3.12/bin/yt-dlp"),
  path.join(process.env.HOME ?? "", "Library/Python/3.13/bin/yt-dlp"),
  "/opt/homebrew/bin/yt-dlp",
  "/usr/local/bin/yt-dlp",
  "yt-dlp",
].filter(Boolean) as string[];

const YOUTUBE_CLIENT_ARGS =
  "youtube:player_client=android,ios,tv;player_skip=webpage,configs";

async function resolveYtDlp(): Promise<string> {
  for (const candidate of YTDLP_CANDIDATES) {
    if (candidate === "yt-dlp") return candidate;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    "yt-dlp nenalezen. Nainstaluj ho (`pip install yt-dlp`) nebo nastav YTDLP_PATH.",
  );
}

async function resolveFfmpeg(): Promise<string | null> {
  const candidates = [
    process.env.FFMPEG_PATH,
    path.join(
      process.env.HOME ?? "",
      "Library/Python/3.9/lib/python/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1",
    ),
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function ytdlpEnv(ytdlp: string, ffmpeg: string | null) {
  return {
    ...process.env,
    PATH: [
      path.dirname(ytdlp),
      ffmpeg ? path.dirname(ffmpeg) : null,
      process.env.PATH ?? "",
    ]
      .filter(Boolean)
      .join(":"),
  };
}

function shortError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const useful =
    lines.find((l) => l.startsWith("ERROR:")) ||
    lines.filter((l) => !l.startsWith("Command failed:")).at(-1) ||
    raw;
  return useful.replace(/^ERROR:\s*/i, "").slice(0, 400);
}

function pickDownloadedPath(info: Record<string, unknown>): string | null {
  const candidates: string[] = [];

  if (Array.isArray(info.requested_downloads)) {
    for (const item of info.requested_downloads) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { filepath?: string }).filepath === "string"
      ) {
        candidates.push((item as { filepath: string }).filepath);
      }
    }
  }

  if (typeof info.filepath === "string") candidates.push(info.filepath);
  if (typeof info._filename === "string") candidates.push(info._filename);
  if (typeof info.filename === "string") candidates.push(info.filename);

  return candidates[0] ?? null;
}

async function resolveFinalFilepath(
  info: Record<string, unknown>,
  trackDir: string,
): Promise<string | null> {
  const reported = pickDownloadedPath(info);
  const guesses: string[] = [];

  if (reported) {
    guesses.push(reported);
    const parsed = path.parse(reported);
    for (const ext of [".mp3", ".m4a", ".opus", ".webm", ".ogg", ".wav"]) {
      if (parsed.ext.toLowerCase() !== ext) {
        guesses.push(path.join(parsed.dir, `${parsed.name}${ext}`));
      }
    }
  }

  for (const ext of [".mp3", ".m4a", ".opus", ".webm", ".ogg", ".wav", ".mp4"]) {
    guesses.push(path.join(trackDir, `track${ext}`));
  }

  for (const guess of guesses) {
    if (guess && existsSync(guess)) return guess;
  }

  try {
    const files = await readdir(trackDir);
    const match = files.find((f) => f.startsWith("track."));
    if (match) return path.join(trackDir, match);
  } catch {
    // ignore
  }

  return null;
}

async function runYtDlp(
  ytdlp: string,
  args: string[],
  ffmpeg: string | null,
): Promise<string> {
  const { stdout } = await execFileAsync(ytdlp, args, {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180_000,
    env: ytdlpEnv(ytdlp, ffmpeg),
  });
  return stdout;
}

function buildDownloadArgs(
  outputTemplate: string,
  ffmpeg: string | null,
  source: string,
): string[] {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--print-json",
    "--no-simulate",
    "-f",
    "bestaudio/best",
    "-o",
    outputTemplate,
    "--no-mtime",
    "--extractor-args",
    YOUTUBE_CLIENT_ARGS,
  ];

  if (ffmpeg) {
    args.push("--ffmpeg-location", ffmpeg, "-x", "--audio-format", "mp3");
  }

  args.push(source);
  return args;
}

async function downloadFromSource(
  ytdlp: string,
  ffmpeg: string | null,
  outputTemplate: string,
  source: string,
): Promise<Record<string, unknown>> {
  const stdout = await runYtDlp(
    ytdlp,
    buildDownloadArgs(outputTemplate, ffmpeg, source),
    ffmpeg,
  );

  const lines = stdout
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error("yt-dlp nevrátil žádná data o staženém souboru.");
  }

  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

async function normalizeToTrackFile(
  filepath: string,
  trackDir: string,
): Promise<string> {
  const ext = path.extname(filepath).toLowerCase() || ".mp3";
  const dest = path.join(trackDir, `track${ext}`);
  if (path.resolve(filepath) === path.resolve(dest)) return dest;
  if (existsSync(dest) && path.resolve(filepath) !== path.resolve(dest)) {
    await rename(dest, `${dest}.old`);
  }
  await rename(filepath, dest);
  return dest;
}

/** Download audio for a Spotify track meta into a UUID library folder. */
export async function importSpotifyTrack(
  meta: SpotifyTrackMeta,
): Promise<LibraryTrack> {
  const existing = await findBySpotifyId(meta.id);
  if (existing) return existing;

  const record = createTrackRecord(meta);
  await writeTrackInfo(record);

  const trackDir = getTrackDir(record.uuid);
  await mkdir(trackDir, { recursive: true });

  try {
    const ytdlp = await resolveYtDlp();
    const ffmpeg = await resolveFfmpeg();
    const query = searchQueryForTrack(meta);
    const outputTemplate = path.join(trackDir, "track.%(ext)s");

    const sources = [
      `ytsearch1:${query} official audio`,
      `ytsearch1:${query}`,
      `scsearch1:${query}`,
    ];

    let lastError = "neznámá chyba";
    let info: Record<string, unknown> | null = null;

    for (const source of sources) {
      try {
        info = await downloadFromSource(ytdlp, ffmpeg, outputTemplate, source);
        break;
      } catch (error) {
        lastError = shortError(error);
      }
    }

    if (!info) {
      throw new Error(lastError);
    }

    const filepath = await resolveFinalFilepath(info, trackDir);
    if (!filepath) {
      throw new Error("Stažení proběhlo, ale výsledný audio soubor se nenašel.");
    }

    const finalPath = await normalizeToTrackFile(filepath, trackDir);
    const now = new Date().toISOString();

    const ready: LibraryTrack = {
      ...record,
      sourceTitle: typeof info.title === "string" ? info.title : null,
      sourceUrl: typeof info.webpage_url === "string" ? info.webpage_url : null,
      extractor: typeof info.extractor === "string" ? info.extractor : "youtube",
      audioFile: path.basename(finalPath),
      status: "ready",
      error: null,
      updatedAt: now,
    };
    await writeTrackInfo(ready);
    return ready;
  } catch (error) {
    const message = shortError(error);
    const failed: LibraryTrack = {
      ...record,
      status: "failed",
      error: message,
      updatedAt: new Date().toISOString(),
    };
    await writeTrackInfo(failed);
    throw new Error(
      `Metadata ze Spotify OK („${meta.title}“ — ${meta.artist}), ale stažení selhalo: ${message}`,
    );
  }
}

export function publicTrackPayload(track: LibraryTrack) {
  return toPublicTrack(track);
}

// re-export for audio route compatibility
export { getDownloadsDir };
