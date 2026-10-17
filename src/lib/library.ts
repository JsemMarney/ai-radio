import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { MixAnalysis } from "@/lib/mix-analysis";
import type { SpotifyTrackMeta } from "@/lib/spotify";

export type LibraryTrackStatus = "ready" | "failed" | "downloading";

export type LibraryTrack = {
  uuid: string;
  spotifyId: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  releaseDate: string | null;
  /** Délka dle Spotify / katalogu — neprepisovat probem z YouTube. */
  catalogDuration?: number | null;
  duration: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  extractor: string | null;
  audioFile: string | null;
  broadcastFile?: string | null;
  /** Sekundy odříznuté z intro ticha (po masteringu). */
  trimStart?: number | null;
  /** Sekundy odříznuté z outro ticha. */
  trimEnd?: number | null;
  /** Délka po masteringu — používá DJ loop. */
  playDuration?: number | null;
  processedAt?: string | null;
  /** Hlasitost a body pro mix (počítá engine, cache). */
  mixAnalysis?: MixAnalysis | null;
  status: LibraryTrackStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const AUDIO_EXTS = [".mp3", ".m4a", ".opus", ".webm", ".ogg", ".wav", ".mp4"];

/** Pre-renderovaný soubor pro broadcast — bez runtime filtrů. */
export const BROADCAST_FILENAME = "track.broadcast.mp3";

export function getDownloadsDir(): string {
  return path.join(process.cwd(), "downloads");
}

const TRACK_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ID skladby je vždy UUID — nic jiného nesmí skončit v cestě na disku. */
export function isTrackId(value: unknown): value is string {
  return typeof value === "string" && TRACK_ID_RE.test(value);
}

export function getTrackDir(uuid: string): string {
  if (!isTrackId(uuid)) throw new Error("Neplatné ID skladby.");
  return path.join(getDownloadsDir(), uuid);
}

export function getInfoPath(uuid: string): string {
  return path.join(getTrackDir(uuid), "info.json");
}

export async function ensureDownloadsDir(): Promise<string> {
  const dir = getDownloadsDir();
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(dir, "jobs"), { recursive: true });
  return dir;
}

export async function findBroadcastInDir(dir: string): Promise<string | null> {
  const broadcast = path.join(dir, BROADCAST_FILENAME);
  if (existsSync(broadcast)) return broadcast;
  return null;
}

export async function resolveBroadcastPath(uuid: string): Promise<string | null> {
  const dir = getTrackDir(uuid);
  const broadcast = await findBroadcastInDir(dir);
  if (broadcast) return broadcast;
  return resolveAudioPath(uuid);
}

export async function findAudioInDir(dir: string): Promise<string | null> {
  for (const name of [
    "track.mp3",
    "track.m4a",
    "track.opus",
    "track.webm",
    "track.ogg",
    "track.wav",
  ]) {
    const full = path.join(dir, name);
    if (existsSync(full)) return full;
  }

  if (!existsSync(dir)) return null;

  try {
    const files = await readdir(dir);
    const match = files.find(
      (f) =>
        f.startsWith("track.") &&
        AUDIO_EXTS.includes(path.extname(f).toLowerCase()),
    );
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

export async function readTrackInfo(uuid: string): Promise<LibraryTrack | null> {
  try {
    const raw = await readFile(getInfoPath(uuid), "utf8");
    return JSON.parse(raw) as LibraryTrack;
  } catch {
    return null;
  }
}

export async function writeTrackInfo(track: LibraryTrack): Promise<void> {
  const dir = getTrackDir(track.uuid);
  await mkdir(dir, { recursive: true });
  await writeFile(getInfoPath(track.uuid), JSON.stringify(track, null, 2), "utf8");
}

export async function listTracks(options?: {
  readyOnly?: boolean;
}): Promise<LibraryTrack[]> {
  await ensureDownloadsDir();
  const root = getDownloadsDir();
  const entries = await readdir(root, { withFileTypes: true });
  const tracks: LibraryTrack[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "jobs") continue;

    const info = await readTrackInfo(entry.name);
    if (!info) continue;
    if (options?.readyOnly && info.status !== "ready") continue;

    const audio = await findAudioInDir(getTrackDir(entry.name));
    if (audio && info.audioFile !== path.basename(audio)) {
      info.audioFile = path.basename(audio);
    }
    if (options?.readyOnly && !audio) continue;

    tracks.push(info);
  }

  tracks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return dedupeBySpotifyId(tracks);
}

/** Jedna skladba na Spotify ID — nejlepší kopie (ready, delší audio). */
export function dedupeBySpotifyId(tracks: LibraryTrack[]): LibraryTrack[] {
  const byKey = new Map<string, LibraryTrack>();

  const score = (t: LibraryTrack): number => {
    let s = 0;
    if (t.status === "ready") s += 1000;
    s += t.playDuration ?? t.duration ?? 0;
    return s;
  };

  for (const track of tracks) {
    const key = track.spotifyId || track.uuid;
    const existing = byKey.get(key);
    if (!existing || score(track) > score(existing)) {
      byKey.set(key, track);
    }
  }

  return [...byKey.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listTracksWithAudio(options?: {
  readyOnly?: boolean;
}): Promise<LibraryTrack[]> {
  const tracks = await listTracks(options);
  if (!options?.readyOnly) return tracks;

  const withAudio: LibraryTrack[] = [];
  for (const track of tracks) {
    const audio = await findAudioInDir(getTrackDir(track.uuid));
    if (audio) withAudio.push(track);
  }
  return withAudio;
}

/**
 * Přívěsky, které nemění skladbu (remaster, radio edit, feat. …).
 * Remixy, živáky a covery jsou jiné nahrávky — ty se nesjednocují.
 */
const SAME_SONG_SUFFIX =
  /\b(remaster(ed)?|radio edit|single version|album version|original mix|explicit|clean|mono|stereo|bonus track|deluxe|soundtrack|from ".*")\b/i;

function stripVersionInfo(title: string): string {
  return title
    .replace(/[([]([^)\]]*)[)\]]/g, (whole, inner: string) =>
      SAME_SONG_SUFFIX.test(inner) || /^\s*(feat|ft|with)\b/i.test(inner) ? " " : whole,
    )
    .replace(/\s[-–]\s(.*)$/, (whole, tail: string) => (SAME_SONG_SUFFIX.test(tail) ? " " : whole));
}

function normalizeKeyPart(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Klíč „stejné skladby“: hlavní interpret + název bez verzí. */
export function trackMatchKey(title: string, artist: string): string {
  const primary = artist.split(/,|&|\sfeat\.?\s|\sft\.?\s|\sx\s/i)[0] ?? artist;
  return `${normalizeKeyPart(primary)}|${normalizeKeyPart(stripVersionInfo(title))}`;
}

/** Je skladba už v knihovně? Stejné Spotify ID, nebo stejná skladba v jiné verzi. */
export async function findDuplicateTrack(meta: {
  id: string;
  title: string;
  artist: string;
}): Promise<{ track: LibraryTrack; sameVersion: boolean } | null> {
  const tracks = (await listTracks()).filter((t) => t.status === "ready");
  const exact = tracks.find((t) => t.spotifyId === meta.id);
  if (exact) return { track: exact, sameVersion: true };
  const key = trackMatchKey(meta.title, meta.artist);
  const similar = tracks.find((t) => trackMatchKey(t.title, t.artist) === key);
  return similar ? { track: similar, sameVersion: false } : null;
}

export async function findBySpotifyId(
  spotifyId: string,
): Promise<LibraryTrack | null> {
  const tracks = await listTracks();
  return (
    tracks.find((t) => t.spotifyId === spotifyId && t.status === "ready") ??
    null
  );
}

export async function getTrack(uuid: string): Promise<LibraryTrack | null> {
  const info = await readTrackInfo(uuid);
  if (!info) return null;
  const audio = await findAudioInDir(getTrackDir(uuid));
  if (audio) info.audioFile = path.basename(audio);
  return info;
}

export function toPublicTrack(track: LibraryTrack) {
  return {
    ...track,
    sourceUrl: null,
    downloadUrl: null,
  };
}

export function toStudioTrack(track: LibraryTrack) {
  return {
    ...track,
    downloadUrl:
      track.status === "ready" && track.audioFile
        ? `/api/audio/${track.uuid}`
        : null,
  };
}

export function createTrackRecord(
  meta: SpotifyTrackMeta,
  uuid = randomUUID(),
): LibraryTrack {
  const now = new Date().toISOString();
  return {
    uuid,
    spotifyId: meta.id,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    year: meta.year,
    releaseDate: meta.releaseDate,
    catalogDuration: meta.duration,
    duration: meta.duration,
    thumbnail: meta.thumbnail,
    webpageUrl: meta.webpageUrl,
    sourceTitle: null,
    sourceUrl: null,
    extractor: null,
    audioFile: null,
    status: "downloading",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function resolveAudioPath(uuid: string): Promise<string | null> {
  const dir = getTrackDir(uuid);
  try {
    await access(dir);
  } catch {
    return null;
  }

  return findAudioInDir(dir);
}

async function rmTrackDir(dir: string, retries = 6): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code =
        err instanceof Error && "code" in err
          ? String((err as NodeJS.ErrnoException).code)
          : "";
      if (code === "ENOENT") return;
      lastError = err;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/** Smaže skladbu z disku (s retry — Windows drží soubor otevřený při streamu). */
export async function deleteLibraryTrack(uuid: string): Promise<void> {
  const track = await getTrack(uuid);
  if (!track) {
    throw new Error("Skladba nenalezena.");
  }

  const dir = getTrackDir(uuid);
  try {
    await access(dir);
  } catch {
    return;
  }

  await rmTrackDir(dir);
}
