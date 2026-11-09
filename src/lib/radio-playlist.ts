import { listTracksWithAudio, trackMatchKey } from "@/lib/library";
import { genreOf } from "@/lib/genres";
import { stationClock } from "@/lib/station-time";
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
  /** Hlasitost/energie (LUFS) z analýzy mixu — pro plynulý tok. */
  lufs: number | null;
};

/** Statistiky skladby, ze kterých se AutoDJ učí. */
export type RotationStats = Record<string, { plays: number; skips?: number; requests?: number }>;

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
  // Stejná skladba ve více verzích (single × album, remaster) hraje v rotaci jen jednou —
  // nejstarší kopie vyhrává, ať se vybraná verze neměnila s každým importem.
  const seenSongs = new Set<string>();
  for (const t of [...tracks].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const songKey = trackMatchKey(t.title, t.artist);
    if (seenSongs.has(songKey)) continue;
    seenSongs.add(songKey);
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
      lufs: t.mixAnalysis?.lufs ?? null,
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
 *  3. ze zbylých kandidátů vážený los — čím déle nehrála a čím méně hrála celkem, tím větší šance
 *     (nové skladby se tak rychle dostanou do vysílání a nic se neohraje víc než zbytek),
 *  4. učí se: často přeskakované skladby dostávají méně šancí, často přané víc,
 *  5. plynulý tok — velký skok v energii (hlasitosti) po sobě je méně pravděpodobný.
 */
export function pickRotationTrack(
  catalog: Map<string, CatalogEntry>,
  recent: string[],
  exclude: Set<string> = new Set(),
  /** Kolikrát už skladba hrála — málo hrané dostanou přednost. */
  plays: RotationStats = {},
  /** Kdy skladba odhadem pojede (pro bloky podle denní doby). */
  at: Date = new Date(),
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

  // 2) artist separation — počítají se i hosté (feat.), ne jen hlavní interpret
  const distinctArtists = new Set(
    [...catalog.values()].map((e) => e.artistKey),
  ).size;
  const spacing = Math.min(getArtistSpacing(), Math.max(0, distinctArtists - 1));
  if (spacing > 0) {
    const blockedArtists = new Set<string>();
    for (const id of recent.slice(0, spacing)) {
      const entry = catalog.get(id);
      if (entry) for (const a of allArtists(entry)) blockedArtists.add(a);
    }
    const spaced = pool.filter(
      (id) => !allArtists(catalog.get(id)!).some((a) => blockedArtists.has(a)),
    );
    if (spaced.length) pool = spaced;
  }

  // Průměrný počet přehrání v knihovně — měřítko pro férovost.
  const counts = ids.map((id) => plays[id]?.plays ?? 0);
  const avgPlays = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);

  // 3) vážený los
  const prev = recent.length ? catalog.get(recent[0]!) : undefined;
  const weights = pool.map((id) => {
    const entry = catalog.get(id)!;
    const stats = plays[id];
    let w = Math.pow(Math.min(age(id), neverPlayedAge) + 1, 1.5);
    // Ohraná skladba (víc než průměr) ztrácí šanci, nehraná / nová ji získává.
    const p = stats?.plays ?? 0;
    w *= Math.pow((avgPlays + 1) / (p + 1), 2);
    // Přeskakovaná skladba: každé přeskočení −40 % (max 4×), ať úplně nezmizí.
    w *= Math.pow(0.6, Math.min(stats?.skips ?? 0, 4));
    // Oblíbená přání: +35 % za každé (max 5×).
    w *= 1 + 0.35 * Math.min(stats?.requests ?? 0, 5);
    if (entry.albumKey && entry.albumKey === prev?.albumKey) w *= 0.25;
    // Plynulý tok: skok o víc než 4 LU po sobě je znát (ticho → nářez).
    if (entry.lufs != null && prev?.lufs != null) {
      const jump = Math.abs(entry.lufs - prev.lufs);
      if (jump > 4) w *= Math.max(0.3, 1 - (jump - 4) * 0.12);
    }
    w *= styleWeight(id, recent, at);
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

/** Cílová energie podle denní doby (RADIO_ENERGY_BLOCKS=0 vypne). Ráno nahoru, v noci klid. */
function energyWindow(at: Date): [number, number] | null {
  if (process.env.RADIO_ENERGY_BLOCKS === "0") return null;
  const h = stationClock(at).hour;
  if (h >= 6 && h < 10) return [4, 5];
  if (h >= 22 || h < 6) return [1, 3];
  return null;
}

/**
 * Plynulý styl podle žánrů (genres.json): energie se mění po krocích, ne z techna rovnou do balady,
 * dvě klidné za sebou méně často, tři stejné žánry za sebou málokdy. Bez žánru beze změny.
 */
function styleWeight(id: string, recent: string[], at: Date): number {
  const g = genreOf(id);
  if (!g) return 1;
  let w = 1;
  const p1 = recent[0] ? genreOf(recent[0]) : null;
  const p2 = recent[1] ? genreOf(recent[1]) : null;
  if (p1) {
    const jump = Math.abs(g.energy - p1.energy);
    w *= [1, 1, 0.5, 0.15, 0.05][jump] ?? 0.05;
    if (g.energy <= 2 && p1.energy <= 2) w *= 0.3;
    if (p2 && g.genre === p1.genre && g.genre === p2.genre) w *= 0.35;
  }
  const win = energyWindow(at);
  if (win) {
    const off = g.energy < win[0] ? win[0] - g.energy : g.energy > win[1] ? g.energy - win[1] : 0;
    w *= [1, 0.35, 0.1, 0.04][off] ?? 0.04;
  }
  return w;
}

/** Všichni interpreti skladby (hlavní i hosté) normalizovaně. */
function allArtists(entry: CatalogEntry): string[] {
  const names = entry.artist
    .split(/\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b|\bvs\.?)\s*/i)
    .map((a) => normalizeArtist(a))
    .filter(Boolean);
  return [...new Set([entry.artistKey, ...names])];
}

/** Doplní frontu na cílovou délku. `context` = co hraje/hrálo, nejnovější první. */
export function fillRotationQueue(
  queue: string[],
  catalog: Map<string, CatalogEntry>,
  context: string[],
  target = QUEUE_TARGET_SIZE,
  exclude: Set<string> = new Set(),
  plays: RotationStats = {},
): string[] {
  const out = queue.filter((id) => catalog.has(id) && !exclude.has(id));
  const limit = Math.min(target, Math.max(0, catalog.size - exclude.size));
  while (out.length < limit) {
    const recent = [...[...out].reverse(), ...context];
    // Odhad, kdy skladba pojede (~3,5 min na skladbu) — pro energii podle denní doby.
    const at = new Date(Date.now() + (out.length + 1) * 210_000);
    const pick = pickRotationTrack(
      catalog,
      recent,
      new Set([...out, ...exclude]),
      plays,
      at,
    );
    if (!pick) break;
    out.push(pick);
  }
  return out;
}
