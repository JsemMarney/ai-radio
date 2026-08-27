import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
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
  duration: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  extractor: string | null;
  audioFile: string | null;
  status: LibraryTrackStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const AUDIO_EXTS = [".mp3", ".m4a", ".opus", ".webm", ".ogg", ".wav", ".mp4"];

export function getDownloadsDir(): string {
  return path.join(process.cwd(), "downloads");
}

export function getTrackDir(uuid: string): string {
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
  return tracks;
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
