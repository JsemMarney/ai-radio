import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDownloadsDir } from "@/lib/library";
import type { SpotifyTrackMeta } from "@/lib/spotify";

/** Návrh posluchače: písnička, která v rádiu chybí — moderátor ji stáhne. */
export type SongSuggestion = {
  id: string;
  spotifyId: string;
  title: string;
  artist: string;
  album: string | null;
  thumbnail: string | null;
  url: string;
  from: string | null;
  /** Kolik posluchačů ji navrhlo. */
  votes: number;
  status: "new" | "downloading" | "dismissed";
  jobId?: string;
  createdAt: string;
  updatedAt: string;
};

const MAX_SUGGESTIONS = 200;

function filePath(): string {
  return path.join(getDownloadsDir(), "suggestions.json");
}

// Zápisy za sebou — dva návrhy naráz si nepřepíšou soubor.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function readAll(): Promise<SongSuggestion[]> {
  try {
    return JSON.parse(await readFile(filePath(), "utf8")) as SongSuggestion[];
  } catch {
    return [];
  }
}

async function writeAll(list: SongSuggestion[]): Promise<void> {
  await mkdir(path.dirname(filePath()), { recursive: true });
  const tmp = `${filePath()}.tmp`;
  await writeFile(tmp, JSON.stringify(list.slice(0, MAX_SUGGESTIONS), null, 2), "utf8");
  await rename(tmp, filePath());
}

/** Návrhy pro studio — nové nahoře, zahozené vynechané. */
export async function listSuggestions(): Promise<SongSuggestion[]> {
  return (await readAll()).filter((s) => s.status !== "dismissed");
}

/** Přidá návrh; stejná písnička znovu = +1 hlas místo duplicity. */
export function addSuggestion(meta: SpotifyTrackMeta, from: string | null): Promise<SongSuggestion> {
  return serialized(async () => {
    const list = await readAll();
    const now = new Date().toISOString();
    const existing = list.find((s) => s.spotifyId === meta.id && s.status !== "dismissed");
    if (existing) {
      existing.votes += 1;
      existing.updatedAt = now;
      if (!existing.from && from) existing.from = from;
      await writeAll(list);
      return existing;
    }
    const suggestion: SongSuggestion = {
      id: randomUUID(),
      spotifyId: meta.id,
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      thumbnail: meta.thumbnail,
      url: meta.webpageUrl,
      from,
      votes: 1,
      status: "new",
      createdAt: now,
      updatedAt: now,
    };
    list.unshift(suggestion);
    await writeAll(list);
    return suggestion;
  });
}

export function updateSuggestion(
  id: string,
  patch: Partial<Pick<SongSuggestion, "status" | "jobId">>,
): Promise<SongSuggestion | null> {
  return serialized(async () => {
    const list = await readAll();
    const item = list.find((s) => s.id === id);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    await writeAll(list);
    return item;
  });
}

export async function getSuggestion(id: string): Promise<SongSuggestion | null> {
  return (await readAll()).find((s) => s.id === id) ?? null;
}
