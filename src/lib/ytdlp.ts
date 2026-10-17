import { execFile } from "node:child_process";
import { access, constants, copyFile, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { probeDuration, resolveFfmpeg } from "@/lib/ffmpeg";
import {
  renderBroadcastFile,
  type AudioTrim,
} from "@/lib/audio-process";
import { ensureBroadcastFile } from "@/lib/remaster";
import {
  createTrackRecord,
  findDuplicateTrack,
  getDownloadsDir,
  getTrackDir,
  readTrackInfo,
  resolveAudioPath,
  toStudioTrack,
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

/**
 * Cookies přihlášeného YouTube účtu (Netscape cookies.txt). Na serverech
 * v datacentru YouTube jinak chce „Sign in to confirm you're not a bot“.
 * YTDLP_COOKIES = cesta, jinak cookies.txt v kořeni aplikace, když existuje.
 */
function cookieArgs(): string[] {
  const explicit = process.env.YTDLP_COOKIES?.trim();
  const file = explicit
    ? path.isAbsolute(explicit)
      ? explicit
      : path.join(process.cwd(), explicit)
    : path.join(process.cwd(), "cookies.txt");
  return existsSync(file) ? ["--cookies", file] : [];
}

type SearchSource = { prefix: string; label: string; youtube: boolean };

/** YouTube první; když odmítne (bot check) nebo nic nenajde, zkusí se SoundCloud. */
const SEARCH_SOURCES: SearchSource[] = [
  { prefix: "ytsearch5", label: "YouTube", youtube: true },
  { prefix: "scsearch5", label: "SoundCloud", youtube: false },
];

function isBotCheck(message: string): boolean {
  return /sign in to confirm|not a bot|cookies-from-browser/i.test(message);
}

async function resolveYtDlp(): Promise<string> {
  for (const candidate of YTDLP_CANDIDATES) {
    if (candidate === "yt-dlp") {
      try {
        await execFileAsync(candidate, ["--version"], { timeout: 8000 });
        return candidate;
      } catch {
        continue;
      }
    }
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

function pathSeparator(): string {
  return process.platform === "win32" ? ";" : ":";
}

function ytdlpEnv(ytdlp: string, ffmpeg: string | null) {
  const extra = [
    path.dirname(ytdlp),
    ffmpeg ? path.dirname(ffmpeg) : null,
  ].filter(Boolean) as string[];

  return {
    ...process.env,
    PATH: [...extra, process.env.PATH ?? ""].filter(Boolean).join(pathSeparator()),
  };
}

function shortError(error: unknown): string {
  if (error && typeof error === "object") {
    const withStderr = error as { stderr?: string | Buffer; message?: string };
    const stderr = withStderr.stderr
      ? String(withStderr.stderr)
      : "";
    if (stderr) {
      const line =
        stderr
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.startsWith("ERROR:")) ??
        stderr
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .at(-1);
      if (line) return line.replace(/^ERROR:\s*/i, "").slice(0, 400);
    }
  }
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

function buildSearchQueries(meta: SpotifyTrackMeta): string[] {
  const base = searchQueryForTrack(meta);
  return [
    `${base} official audio`,
    `${meta.artist} ${meta.title} topic`,
    `${base} audio`,
    base,
  ];
}

type SearchHit = { url: string; title: string; score: number };

/** Malá písmena, bez diakritiky, bez závorek (feat., remaster…) a interpunkce. */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[([{].*?[)\]}]/g, " ")
    .replace(/\s-\s.*(remaster|version|edit|mix|mono|stereo).*$/i, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function primaryArtist(artist: string): string {
  return normalizeForMatch(artist.split(/,|&| feat\.? | ft\.? | x /i)[0] ?? artist);
}

/**
 * Je výsledek opravdu ta skladba? Všechna slova názvu musí být v titulku,
 * interpret v titulku nebo jménu nahrávajícího, a délka zhruba sedět.
 * (SoundCloud jinak vrací „podobně znějící“ cizí skladby.)
 */
function matchesTrack(
  hit: { title: string; uploader: string; duration: number | null },
  meta: SpotifyTrackMeta,
  strict: boolean,
): boolean {
  const hay = ` ${normalizeForMatch(hit.title)} `;
  const words = normalizeForMatch(meta.title).split(" ").filter((w) => w.length >= 2);
  if (words.length && !words.every((w) => hay.includes(` ${w} `))) return false;
  if (!strict) return true;

  const artist = primaryArtist(meta.artist);
  const uploader = ` ${normalizeForMatch(hit.uploader)} `;
  if (artist && !hay.includes(` ${artist} `) && !uploader.includes(` ${artist} `)) {
    return false;
  }
  if (meta.duration && hit.duration && hit.duration > 0) {
    const tolerance = Math.max(8, meta.duration * 0.06);
    if (Math.abs(hit.duration - meta.duration) > tolerance) return false;
  }
  return true;
}

function scoreSearchHit(
  title: string,
  meta: SpotifyTrackMeta,
): number {
  const t = title.toLowerCase();
  const artist = meta.artist.toLowerCase();
  const track = meta.title.toLowerCase();
  let score = 0;
  if (t.includes("official audio") || t.includes("provided to youtube")) score += 40;
  if (t.includes("topic")) score += 30;
  if (t.includes(artist)) score += 15;
  if (t.includes(track)) score += 15;
  if (t.includes("lyrics")) score -= 35;
  if (t.includes("8d") || t.includes("slowed") || t.includes("reverb")) score -= 20;
  if (t.includes("speed up") || t.includes("sped up") || t.includes("nightcore")) score -= 20;
  if (t.includes("live") || t.includes("cover") || t.includes("karaoke")) score -= 25;
  if (t.includes("remix") && !track.includes("remix")) score -= 10;
  return score;
}

async function searchSource(
  ytdlp: string,
  ffmpeg: string | null,
  query: string,
  meta: SpotifyTrackMeta,
  source: SearchSource,
): Promise<SearchHit[]> {
  const stdout = await runYtDlp(
    ytdlp,
    [
      "--flat-playlist",
      "--no-warnings",
      "--no-update",
      ...(source.youtube ? ["--extractor-args", YOUTUBE_CLIENT_ARGS, ...cookieArgs()] : []),
      "--print",
      "%(title)s\t%(webpage_url)s\t%(uploader,channel|)s\t%(duration|)s",
      `${source.prefix}:${query}`,
    ],
    ffmpeg,
  );

  const hits: SearchHit[] = [];
  for (const line of stdout.split("\n")) {
    const [title = "", url = "", uploader = "", durationRaw = ""] = line.trim().split("\t");
    if (!title || !url.startsWith("http")) continue;
    const duration = Number(durationRaw);
    const candidate = {
      title: title.trim(),
      uploader: uploader.trim(),
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    };
    // YouTube: stačí, že sedí název. SoundCloud: i interpret a délka.
    if (!matchesTrack(candidate, meta, !source.youtube)) continue;
    hits.push({ url: url.trim(), title: candidate.title, score: scoreSearchHit(candidate.title, meta) });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits;
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
    "--no-update",
    "--print-json",
    "--no-simulate",
    "-f",
    "bestaudio/best",
    "-o",
    outputTemplate,
    "--no-mtime",
  ];
  if (/youtube\.com|youtu\.be/i.test(source)) {
    args.push("--extractor-args", YOUTUBE_CLIENT_ARGS, ...cookieArgs());
  }

  if (ffmpeg) {
    args.push("--ffmpeg-location", ffmpeg);
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
  ffmpeg: string | null,
  catalogDuration?: number | null,
): Promise<{ path: string; trim: AudioTrim | null }> {
  const mp3Path = path.join(trackDir, "track.mp3");

  if (!ffmpeg) {
    const finalExt = path.extname(filepath).toLowerCase() || ".mp3";
    const dest = path.join(trackDir, `track${finalExt}`);
    if (path.resolve(filepath) !== path.resolve(dest)) {
      if (existsSync(dest)) await unlink(dest).catch(() => {});
      await rename(filepath, dest);
    }
    return { path: dest, trim: null };
  }

  let source = filepath;
  const ext = path.extname(source).toLowerCase();

  if (ext !== ".mp3") {
    const tempMp3 = path.join(trackDir, "track.raw.mp3");
    await execFileAsync(
      ffmpeg,
      ["-y", "-i", source, "-vn", "-acodec", "libmp3lame", "-q:a", "2", tempMp3],
      { timeout: 300_000 },
    );
    if (path.resolve(source) !== path.resolve(tempMp3)) {
      await unlink(source).catch(() => {});
    }
    source = tempMp3;
  }

  const sourceArchive = path.join(trackDir, "source.mp3");
  if (path.resolve(source) !== path.resolve(sourceArchive)) {
    await copyFile(source, sourceArchive).catch(() => {});
  }

  const rendered = await renderBroadcastFile(
    sourceArchive,
    trackDir,
    ffmpeg,
    undefined,
    catalogDuration,
  );

  if (
    path.resolve(source) !== path.resolve(rendered.masterPath) &&
    source.includes(".raw.")
  ) {
    await unlink(source).catch(() => {});
  }

  return { path: rendered.masterPath, trim: rendered.trim };
}

/** Zmasteruje + pre-render broadcast, pokud ještě nebylo. */
export async function ensureTrackProcessed(uuid: string): Promise<string | null> {
  return ensureBroadcastFile(uuid);
}

/** Průběh importu — volá se při hledání, stahování a zpracování. */
export type ImportProgressCallback = (progress: {
  detail: string;
}) => void | Promise<void>;

/** Download audio for a Spotify track meta into a UUID library folder. */
export async function importSpotifyTrack(
  meta: SpotifyTrackMeta,
  onProgress?: ImportProgressCallback,
): Promise<LibraryTrack> {
  const existing = (await findDuplicateTrack(meta))?.track;
  if (existing) return existing;

  const record = createTrackRecord(meta);
  await writeTrackInfo(record);

  const trackDir = getTrackDir(record.uuid);
  await mkdir(trackDir, { recursive: true });

  try {
    await onProgress?.({ detail: "Připravuji stažení…" });
    const ytdlp = await resolveYtDlp();
    const ffmpeg = await resolveFfmpeg();
    if (!ffmpeg) {
      throw new Error(
        "ffmpeg nenalezen — bez něj se stahuje video (mp4). Nainstaluj ffmpeg (scoop install ffmpeg) nebo nastav FFMPEG_PATH.",
      );
    }
    const outputTemplate = path.join(trackDir, "track.%(ext)s");
    const queries = buildSearchQueries(meta);
    const triedUrls = new Set<string>();
    const errors: string[] = [];

    let info: Record<string, unknown> | null = null;

    sourceLoop: for (const source of SEARCH_SOURCES) {
      // „official audio“ / „topic“ dávají smysl jen na YouTube.
      const sourceQueries = source.youtube
        ? queries
        : [searchQueryForTrack(meta), `${meta.title} ${primaryArtist(meta.artist)}`];
      for (const query of sourceQueries) {
        let hits: SearchHit[] = [];
        try {
          await onProgress?.({ detail: `Hledám (${source.label}): ${query}` });
          hits = await searchSource(ytdlp, ffmpeg, query, meta, source);
        } catch (error) {
          const msg = shortError(error);
          errors.push(`${source.label} „${query}“: ${msg}`);
          // YouTube blokuje server — další dotazy na YouTube nemají smysl.
          if (isBotCheck(msg)) continue sourceLoop;
          continue;
        }

        if (!hits.length) {
          errors.push(`${source.label} „${query}“: žádný výsledek`);
          continue;
        }

        for (const hit of hits) {
          if (triedUrls.has(hit.url)) continue;
          triedUrls.add(hit.url);
          try {
            await onProgress?.({ detail: `Stahuji (${source.label}): ${hit.title}` });
            info = await downloadFromSource(
              ytdlp,
              ffmpeg,
              outputTemplate,
              hit.url,
            );
            const dlDuration =
              typeof info.duration === "number" ? info.duration : 0;
            if (meta.duration && dlDuration > meta.duration * 1.12) {
              errors.push(
                `„${hit.title}“: moc dlouhé (${Math.round(dlDuration)}s vs katalog ${Math.round(meta.duration)}s)`,
              );
              info = null;
              continue;
            }
            // SoundCloud u placených skladeb dává jen 30s ukázku.
            if (meta.duration && dlDuration > 0 && dlDuration < meta.duration * 0.75) {
              errors.push(
                `„${hit.title}“: moc krátké (${Math.round(dlDuration)}s vs katalog ${Math.round(meta.duration)}s)`,
              );
              info = null;
              continue;
            }
            break sourceLoop;
          } catch (error) {
            const msg = shortError(error);
            errors.push(`„${hit.title}“: ${msg}`);
            if (isBotCheck(msg)) continue sourceLoop;
          }
        }
      }
    }

    if (!info) {
      throw new Error(
        errors.length
          ? [...new Set([errors[0]!, ...errors.slice(-2)])].join(" | ")
          : "Stažení selhalo (YouTube ani SoundCloud).",
      );
    }

    const filepath = await resolveFinalFilepath(info, trackDir);
    if (!filepath) {
      throw new Error("Stažení proběhlo, ale výsledný audio soubor se nenašel.");
    }

    await onProgress?.({
      detail: "Zpracovávám audio (konverze, normalizace)…",
    });
    const { path: finalPath, trim } = await normalizeToTrackFile(
      filepath,
      trackDir,
      ffmpeg,
      record.catalogDuration ?? record.duration,
    );
    const probedDuration = await probeDuration(finalPath);
    const catalog = record.catalogDuration ?? record.duration;
    const now = new Date().toISOString();

    const ready: LibraryTrack = {
      ...record,
      sourceTitle: typeof info.title === "string" ? info.title : null,
      sourceUrl: typeof info.webpage_url === "string" ? info.webpage_url : null,
      extractor: typeof info.extractor === "string" ? info.extractor : "youtube",
      audioFile: path.basename(finalPath),
      broadcastFile: "track.broadcast.mp3",
      catalogDuration: catalog,
      duration: catalog ?? probedDuration,
      trimStart: trim?.trimStart ?? 0,
      trimEnd: trim?.trimEnd ?? 0,
      playDuration: trim?.playDuration ?? probedDuration ?? catalog,
      processedAt: now,
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
  return toStudioTrack(track);
}

/** Convert track to mp3 if needed + zmasterovat (ticho, normalizace). */
export async function ensureTrackMp3(uuid: string): Promise<string | null> {
  return ensureTrackProcessed(uuid);
}

// re-export for audio route compatibility
export { getDownloadsDir };
