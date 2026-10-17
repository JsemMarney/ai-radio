import { listTracksWithAudio } from "@/lib/library";
import type { RadioNowPlaying } from "@/lib/types";

const TRACK_CACHE_TTL_MS = 30_000;

/** Kolik skladeb má engine naplánovaných dopředu. */
export function getQueueTargetSize(): number {
  const raw = Number(process.env.RADIO_QUEUE_SIZE ?? 12);
  if (!Number.isFinite(raw) || raw < 3) return 12;
  return Math.min(Math.floor(raw), 30);
}

/** Kolik skladeb ukazujeme v UI (program / fronta). */
export function getQueueDisplaySize(): number {
  const raw = Number(process.env.RADIO_QUEUE_DISPLAY ?? 5);
  if (!Number.isFinite(raw) || raw < 1) return 5;
  return Math.min(Math.floor(raw), 15);
}

export const QUEUE_TARGET_SIZE = getQueueTargetSize();
export const QUEUE_DISPLAY_SIZE = getQueueDisplaySize();

/** Minimální počet jiných interpretů mezi dvěma skladbami stejného interpreta. */
export function getArtistSpacing(): number {
  const raw = Number(process.env.RADIO_ARTIST_SPACING ?? 3);
  if (!Number.isFinite(raw) || raw < 0) return 3;
  return Math.min(Math.floor(raw), 10);
}

/** Jaký podíl knihovny musí zaznít, než se skladba může zopakovat (0–0.95). */
function getSongSeparationRatio(): number {
  const raw = Number(process.env.RADIO_SONG_SEPARATION ?? 0.6);
  if (!Number.isFinite(raw)) return 0.6;
  return Math.min(Math.max(raw, 0), 0.95);
}

export type CatalogEntry = RadioNowPlaying & {
  artistKey: string;
  albumKey: string;
};

let cachedCatalog: { entries: Map<string, CatalogEntry>; at: number } | null =
  null;

export function invalidateTrackCache(): void {
  cachedCatalog = null;
}

/** Primární interpret (bez feat. / & / x) — pro rozestupy. */
export function normalizeArtist(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
  if (!base) return "";
  const cut =
    base.split(/\s+(?:feat\.?|ft\.?|featuring|with|x|vs\.?)\s+/i)[0] ?? base;
  return (cut.split(/[,&/]/)[0] ?? cut).trim();
}

export async function getCatalog(): Promise<Map<string, CatalogEntry>> {
  const now = Date.now();
  if (cachedCatalog && now - cachedCatalog.at < TRACK_CACHE_TTL_MS) {
    return cachedCatalog.entries;
  }
  const tracks = await listTracksWithAudio({ readyOnly: true });
  const entries = new Map<string, CatalogEntry>();
  for (const t of tracks) {
    entries.set(t.uuid, {
      uuid: t.uuid,
      title: t.title,
      artist: t.artist,
      album: t.album,
      year: t.year,
      thumbnail: t.thumbnail,
      durationSec: t.playDuration ?? t.duration ?? null,
      artistKey: normalizeArtist(t.artist) || t.uuid,
      albumKey: (t.album ?? "").toLowerCase().trim(),
    });
  }
  cachedCatalog = { entries, at: now };
  return entries;
}

/**
 * Vybere další skladbu do rotace.
 *
 * `recent` = co hrálo / bude hrát těsně před vybíranou pozicí, nejnovější první.
 * Pravidla (jako u rádiové automatizace):
 *  1. skladba se neopakuje, dokud nezazní ~60 % knihovny,
 *  2. stejný interpret ne dřív než po N jiných,
 *  3. ze zbylých kandidátů vážený los — čím déle nehrála, tím větší šance.
 */
export function pickRotationTrack(
  catalog: Map<string, CatalogEntry>,
  recent: string[],
  exclude: Set<string> = new Set(),
): string | null {
  const ids = [...catalog.keys()].filter((id) => !exclude.has(id));
  if (!ids.length) return null;
  if (ids.length === 1) return ids[0]!;

  const lastSeen = new Map<string, number>();
  recent.forEach((id, idx) => {
    if (!lastSeen.has(id)) lastSeen.set(id, idx);
  });

  const total = catalog.size;
  const neverPlayedAge = total * 2;
  const age = (id: string) => lastSeen.get(id) ?? neverPlayedAge;

  // 1) song separation — postupně povolujeme, když není z čeho vybírat
  const separation = Math.min(
    total - 1,
    Math.floor(total * getSongSeparationRatio()),
  );
  let pool = ids.filter((id) => age(id) >= separation);
  if (!pool.length) {
    const byAge = [...ids].sort((a, b) => age(b) - age(a));
    pool = byAge.slice(0, Math.max(1, Math.ceil(byAge.length / 4)));
  }

  // 2) artist separation
  const distinctArtists = new Set(
    [...catalog.values()].map((e) => e.artistKey),
  ).size;
  const spacing = Math.min(getArtistSpacing(), Math.max(0, distinctArtists - 1));
  if (spacing > 0) {
    const blockedArtists = new Set<string>();
    for (const id of recent) {
      if (blockedArtists.size >= spacing) break;
      const artist = catalog.get(id)?.artistKey;
      if (artist) blockedArtists.add(artist);
    }
    const spaced = pool.filter(
      (id) => !blockedArtists.has(catalog.get(id)!.artistKey),
    );
    if (spaced.length) pool = spaced;
  }

  // 3) vážený los
  const prevAlbum = recent.length ? catalog.get(recent[0]!)?.albumKey : "";
  const weights = pool.map((id) => {
    let w = Math.pow(Math.min(age(id), neverPlayedAge) + 1, 1.5);
    const album = catalog.get(id)!.albumKey;
    if (album && album === prevAlbum) w *= 0.25;
    return w;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * sum;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

/** Doplní frontu na cílovou délku. `context` = co hraje/hrálo, nejnovější první. */
export function fillRotationQueue(
  queue: string[],
  catalog: Map<string, CatalogEntry>,
  context: string[],
  target = QUEUE_TARGET_SIZE,
  exclude: Set<string> = new Set(),
): string[] {
  const out = queue.filter((id) => catalog.has(id) && !exclude.has(id));
  const limit = Math.min(target, Math.max(0, catalog.size - exclude.size));
  while (out.length < limit) {
    const recent = [...[...out].reverse(), ...context];
    const pick = pickRotationTrack(
      catalog,
      recent,
      new Set([...out, ...exclude]),
    );
    if (!pick) break;
    out.push(pick);
  }
  return out;
}
