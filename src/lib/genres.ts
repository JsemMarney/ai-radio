import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDownloadsDir } from "@/lib/library";

/**
 * Žánr a energie skladeb (downloads/genres.json) — doplňuje je AI podle interpreta a názvu.
 * Zvlášť od knihovny, ať se engine a web nepřepisují v jednom souboru.
 */

export const GENRES = [
  "pop",
  "český pop",
  "rock",
  "český rock",
  "metal",
  "punk",
  "hip hop",
  "český rap",
  "r&b",
  "techno",
  "house",
  "trance",
  "eurodance",
  "edm",
  "drum and bass",
  "disco",
  "funk",
  "reggae",
  "latino",
  "country",
  "folk",
  "jazz",
  "blues",
  "balada",
  "chill",
  "klasika",
  "šlágr",
] as const;

export type GenreInfo = { genre: string; energy: number };

function filePath(): string {
  return path.join(getDownloadsDir(), "genres.json");
}

let cache: Record<string, GenreInfo> | null = null;

export async function loadGenres(): Promise<Record<string, GenreInfo>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(filePath(), "utf8")) as Record<string, GenreInfo>;
  } catch {
    cache = {};
  }
  return cache;
}

export function genreOf(uuid: string): GenreInfo | null {
  return cache?.[uuid] ?? null;
}

export async function saveGenres(add: Record<string, GenreInfo>): Promise<void> {
  const all = { ...(await loadGenres()), ...add };
  cache = all;
  await mkdir(path.dirname(filePath()), { recursive: true });
  const tmp = `${filePath()}.tmp`;
  await writeFile(tmp, JSON.stringify(all), "utf8");
  await rename(tmp, filePath());
}

/** Prompt pro dávku skladeb → řádky „číslo|žánr|energie 1–5“. */
export function genrePrompt(tracks: { artist: string; title: string }[]): string {
  return (
    `Urči žánr a energii (1 = klidná balada, 5 = nejrychlejší pecka) těchto skladeb. ` +
    `Žánr vyber VŽDY jen z tohoto seznamu: ${GENRES.join(", ")}.\n` +
    `Odpověz jen řádky ve tvaru „číslo|žánr|energie“, nic jiného.\n\n` +
    tracks.map((t, i) => `${i + 1}. ${t.artist} — ${t.title}`).join("\n")
  );
}

export function parseGenreReply(reply: string, count: number): (GenreInfo | null)[] {
  const out: (GenreInfo | null)[] = Array.from({ length: count }, () => null);
  for (const line of reply.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s*[|.)]\s*([^|]+?)\s*\|\s*([1-5])/.exec(line);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    const genre = m[2]!.toLowerCase().trim();
    if (i < 0 || i >= count || !(GENRES as readonly string[]).includes(genre)) continue;
    out[i] = { genre, energy: Number(m[3]) };
  }
  return out;
}
