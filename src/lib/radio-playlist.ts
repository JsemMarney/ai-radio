import { listTracksWithAudio } from "@/lib/library";
import {
  readRadioState,
  writePlaylistState,
} from "@/lib/radio-state";

const TRACK_CACHE_TTL_MS = 30_000;

/** Kolik skladeb drží engine ve frontě (bag). */
export function getQueueTargetSize(): number {
  const raw = Number(process.env.RADIO_QUEUE_SIZE ?? 15);
  if (!Number.isFinite(raw) || raw < 3) return 15;
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

/** Kolik posledních interpretů se nesmí opakovat za sebou. */
export function getArtistSpacing(): number {
  const raw = Number(process.env.RADIO_ARTIST_SPACING ?? 2);
  if (!Number.isFinite(raw) || raw < 0) return 2;
  return Math.min(Math.floor(raw), 6);
}

type TrackMixMeta = { artist: string; album: string | null };
type TrackMetaMap = Map<string, TrackMixMeta>;

let cachedCatalog: {
  ids: string[];
  meta: TrackMetaMap;
  at: number;
} | null = null;

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function invalidateTrackCache(): void {
  cachedCatalog = null;
}

/** Jeden primární interpret pro mix (feat. / & / comma). */
export function normalizeArtist(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
  if (!base) return "";
  const cut =
    base.split(/\s+(?:feat\.?|ft\.?|featuring|with|x|vs\.?)\s+/i)[0] ??
    base;
  return (cut.split(/[,&/]/)[0] ?? cut).trim();
}

async function getTrackCatalog(): Promise<{
  ids: string[];
  meta: TrackMetaMap;
}> {
  const now = Date.now();
  if (cachedCatalog && now - cachedCatalog.at < TRACK_CACHE_TTL_MS) {
    return { ids: cachedCatalog.ids, meta: cachedCatalog.meta };
  }

  const tracks = await listTracksWithAudio({ readyOnly: true });
  const meta: TrackMetaMap = new Map();
  for (const t of tracks) {
    meta.set(t.uuid, { artist: t.artist, album: t.album });
  }
  const ids = tracks.map((t) => t.uuid);
  cachedCatalog = { ids, meta, at: now };
  return { ids, meta };
}

export async function getReadyTrackIds(): Promise<string[]> {
  const { ids } = await getTrackCatalog();
  return ids;
}

function artistsFromUuids(
  uuids: string[],
  meta: TrackMetaMap,
): string[] {
  const out: string[] = [];
  for (const id of uuids) {
    const artist = normalizeArtist(meta.get(id)?.artist ?? "");
    if (artist) out.push(artist);
  }
  return out;
}

function countDistinctArtists(
  ids: string[],
  meta: TrackMetaMap,
): number {
  const set = new Set<string>();
  for (const id of ids) {
    const artist = normalizeArtist(meta.get(id)?.artist ?? "");
    set.add(artist || id);
  }
  return set.size;
}

/**
 * Rozloží skladby tak, aby stejní interpreti nebyli hned vedle sebe.
 */
export function mixBagOrder(
  ids: string[],
  meta: TrackMetaMap,
  recentArtists: string[] = [],
): string[] {
  if (ids.length <= 1) return [...ids];

  const remaining = shuffle(ids);
  const result: string[] = [];
  const tailArtists = [...recentArtists].slice(0, getArtistSpacing());

  while (remaining.length) {
    let bestIdx = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const id = remaining[i]!;
      const artist = normalizeArtist(meta.get(id)?.artist ?? "");
      const album = (meta.get(id)?.album ?? "").toLowerCase().trim();

      let score = 0;
      if (!artist || !tailArtists.includes(artist)) score += 20;
      if (result.length) {
        const prevArtist = normalizeArtist(
          meta.get(result[result.length - 1]!)?.artist ?? "",
        );
        const prevAlbum = (
          meta.get(result[result.length - 1]!)?.album ?? ""
        )
          .toLowerCase()
          .trim();
        if (artist && artist !== prevArtist) score += 10;
        if (album && album !== prevAlbum) score += 4;
      }
      score -= i * 0.01;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const pick = remaining.splice(bestIdx, 1)[0]!;
    result.push(pick);
    const artist = normalizeArtist(meta.get(pick)?.artist ?? "");
    if (artist) {
      tailArtists.unshift(artist);
      while (tailArtists.length > getArtistSpacing()) tailArtists.pop();
    }
  }

  return result;
}

/** Min. počet jiných skladeb mezi opakováním stejné skladby. */
export function computeRepeatCooldown(librarySize: number): number {
  if (librarySize <= 1) return 0;
  if (librarySize <= 3) return 1;
  return Math.min(
    librarySize - 1,
    Math.max(3, Math.floor(librarySize * 0.45)),
  );
}

export function buildBlockedUuids(
  avoidUuid: string | null,
  recentUuids: string[],
  librarySize: number,
): Set<string> {
  const cooldown = computeRepeatCooldown(librarySize);
  const blocked = new Set<string>();
  if (avoidUuid) blocked.add(avoidUuid);

  for (const id of recentUuids) {
    if (!id || blocked.has(id)) continue;
    blocked.add(id);
    if (blocked.size >= cooldown + (avoidUuid ? 1 : 0)) break;
  }

  return blocked;
}

function buildBlockedArtists(
  avoidUuid: string | null,
  recentUuids: string[],
  meta: TrackMetaMap,
  spacing: number,
): Set<string> {
  const blocked = new Set<string>();
  const chain = [avoidUuid, ...recentUuids].filter(Boolean) as string[];

  for (const id of chain) {
    const artist = normalizeArtist(meta.get(id)?.artist ?? "");
    if (artist) blocked.add(artist);
    if (blocked.size >= spacing) break;
  }

  return blocked;
}

/** Fisher-Yates bag — recent skladby až na konec + rozložení interpretů. */
export function buildFreshBag(
  allIds: string[],
  recentUuids: string[] = [],
  meta: TrackMetaMap = new Map(),
): string[] {
  if (!allIds.length) return [];

  const recentSet = new Set(recentUuids.filter(Boolean));
  const fresh = shuffle(allIds.filter((id) => !recentSet.has(id)));
  const stale = shuffle(allIds.filter((id) => recentSet.has(id)));
  let bag = [...fresh, ...stale];

  if (bag.length > 1 && recentSet.has(bag[0]!)) {
    const swapIdx = bag.findIndex((id, i) => i > 0 && !recentSet.has(id));
    if (swapIdx > 0) {
      [bag[0], bag[swapIdx]] = [bag[swapIdx]!, bag[0]!];
    }
  }

  if (meta.size) {
    bag = mixBagOrder(bag, meta, artistsFromUuids(recentUuids, meta));
  }

  return bag;
}

function remixBagTail(
  bag: string[],
  meta: TrackMetaMap,
  contextUuids: string[],
  keepHead = 0,
): string[] {
  if (bag.length <= keepHead + 1) return bag;
  const head = bag.slice(0, keepHead);
  const tail = mixBagOrder(
    bag.slice(keepHead),
    meta,
    artistsFromUuids(contextUuids, meta),
  );
  return [...head, ...tail];
}

export async function topUpBag(
  bag: string[],
  readyIds: string[],
  recentUuids: string[],
  targetSize = QUEUE_TARGET_SIZE,
): Promise<string[]> {
  const { meta } = await getTrackCatalog();
  const valid = new Set(readyIds);
  let queue = bag.filter((id) => valid.has(id));
  const inQueue = new Set(queue);

  while (queue.length < targetSize && readyIds.length > 0) {
    const missing = readyIds.filter((id) => !inQueue.has(id));
    if (!missing.length) break;

    const contextIds = [...recentUuids, ...queue];
    const ordered = mixBagOrder(
      missing,
      meta,
      artistsFromUuids(contextIds, meta),
    );
    const pick = ordered[0];
    if (!pick || inQueue.has(pick)) break;

    queue.push(pick);
    inQueue.add(pick);
  }

  queue = remixBagTail(queue, meta, [...recentUuids, ...queue], 0);
  return queue;
}

function recentFromState(
  recentlyPlayed: { uuid: string }[],
  lastPlayedUuid: string | null,
): string[] {
  const ids: string[] = [];
  for (const track of recentlyPlayed) {
    if (!ids.includes(track.uuid)) ids.push(track.uuid);
  }
  if (lastPlayedUuid && !ids.includes(lastPlayedUuid)) {
    ids.push(lastPlayedUuid);
  }
  return ids;
}

/** Fisher-Yates bag — celá knihovna jednou, pak teprve znovu. */
export async function loadBag(): Promise<{
  bag: string[];
  lastPlayedUuid: string | null;
}> {
  const state = await readRadioState();
  const { ids, meta } = await getTrackCatalog();
  const valid = new Set(ids);

  let bag = (state.playlistBag ?? []).filter((id) => valid.has(id));
  const lastPlayedUuid = state.lastPlayedUuid ?? null;
  const recentUuids = recentFromState(state.recentlyPlayed ?? [], lastPlayedUuid);

  if (!bag.length && ids.length) {
    bag = buildFreshBag(ids, recentUuids, meta);
  }

  const topped = await topUpBag(bag, ids, recentUuids);
  if (
    topped.length !== bag.length ||
    topped.some((id, index) => id !== bag[index])
  ) {
    bag = topped;
    await writePlaylistState(bag, lastPlayedUuid);
  }

  return { bag, lastPlayedUuid };
}

export async function saveBag(
  bag: string[],
  lastPlayedUuid: string | null,
): Promise<void> {
  await writePlaylistState(bag, lastPlayedUuid);
}

export function prependToBag(bag: string[], uuid: string): string[] {
  if (!uuid) return bag;
  if (bag[0] === uuid) return bag;
  return [uuid, ...bag.filter((id) => id !== uuid)];
}

export function removeFromBag(bag: string[], uuid: string): string[] {
  return bag.filter((id) => id !== uuid);
}

type SelectResult = { uuid: string | null; bag: string[] };

function selectFromBag(
  bag: string[],
  recentUuids: string[],
  avoidUuid: string | null,
  readyIds: string[],
  meta: TrackMetaMap,
  commit: boolean,
): SelectResult {
  if (!readyIds.length) return { uuid: null, bag: [] };

  const valid = new Set(readyIds);
  let queue = bag.filter((id) => valid.has(id));

  if (!queue.length) {
    queue = buildFreshBag(readyIds, recentUuids, meta);
  }

  const blocked = buildBlockedUuids(
    avoidUuid,
    recentUuids,
    readyIds.length,
  );
  const spacing = getArtistSpacing();
  const useArtistBlock =
    countDistinctArtists(readyIds, meta) > Math.max(1, spacing);
  const blockedArtists = useArtistBlock
    ? buildBlockedArtists(avoidUuid, recentUuids, meta, spacing)
    : new Set<string>();

  const isOk = (candidate: string, checkArtist: boolean): boolean => {
    if (readyIds.length === 1) return true;
    if (blocked.has(candidate)) return false;
    if (!checkArtist || !useArtistBlock) return true;
    const artist = normalizeArtist(meta.get(candidate)?.artist ?? "");
    return !artist || !blockedArtists.has(artist);
  };

  const findInQueue = (
    q: string[],
    checkArtist: boolean,
  ): { candidate: string; rotated: string[] } | null => {
    if (!q.length) return null;
    let rotated = [...q];
    for (let attempt = 0; attempt < rotated.length; attempt++) {
      const candidate = rotated[0]!;
      if (isOk(candidate, checkArtist)) {
        return { candidate, rotated };
      }
      rotated.push(rotated.shift()!);
    }
    return null;
  };

  for (const checkArtist of [true, false]) {
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const found = findInQueue(queue, checkArtist);
      if (found) {
        queue = found.rotated;
        const candidate = found.candidate;
        if (commit) {
          if (queue !== bag) {
            const idx = queue.indexOf(candidate);
            return {
              uuid: candidate,
              bag: idx >= 0 ? removeFromBag(bag, candidate) : bag,
            };
          }
          return { uuid: candidate, bag: removeFromBag(bag, candidate) };
        }
        return { uuid: candidate, bag: queue };
      }
      queue = buildFreshBag(readyIds, [...recentUuids, ...bag], meta);
    }
  }

  const fallback = queue[0] ?? readyIds[0] ?? null;
  if (!fallback) return { uuid: null, bag: queue };
  if (commit) {
    return { uuid: fallback, bag: removeFromBag(queue, fallback) };
  }
  return { uuid: fallback, bag: queue };
}

/** Nahlédne do fronty bez odebrání skladby. */
export async function peekFromBag(
  bag: string[],
  recentUuids: string[],
  avoidUuid: string | null,
): Promise<SelectResult> {
  const { ids, meta } = await getTrackCatalog();
  return selectFromBag(bag, recentUuids, avoidUuid, ids, meta, false);
}

/** Odebere skladbu z fronty (commit). */
export async function pickFromBag(
  bag: string[],
  recentUuids: string[],
  avoidUuid: string | null,
): Promise<SelectResult> {
  const { ids, meta } = await getTrackCatalog();
  return selectFromBag(bag, recentUuids, avoidUuid, ids, meta, true);
}

export async function ensureQueueDepth(
  bag: string[],
  recentUuids: string[],
  targetSize = QUEUE_TARGET_SIZE,
): Promise<string[]> {
  const { ids } = await getTrackCatalog();
  return topUpBag(bag, ids, recentUuids, targetSize);
}

/** Po změně fronty — znovu promíchat pořadí (zachová první skladbu). */
export async function remixBag(
  bag: string[],
  recentUuids: string[],
  keepHead = 1,
): Promise<string[]> {
  if (bag.length <= keepHead) return bag;
  const { meta } = await getTrackCatalog();
  return remixBagTail(bag, meta, [...recentUuids, ...bag.slice(0, keepHead)], keepHead);
}
