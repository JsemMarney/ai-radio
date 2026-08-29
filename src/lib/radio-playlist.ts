import { listTracksWithAudio } from "@/lib/library";
import {
  readRadioState,
  writePlaylistState,
} from "@/lib/radio-state";

const TRACK_CACHE_TTL_MS = 30_000;

/** Kolik skladeb držíme ve frontě / zobrazujeme ve Studiu. */
export const QUEUE_TARGET_SIZE = 5;

let cachedReadyIds: { ids: string[]; at: number } | null = null;

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function invalidateTrackCache(): void {
  cachedReadyIds = null;
}

export async function getReadyTrackIds(): Promise<string[]> {
  const now = Date.now();
  if (cachedReadyIds && now - cachedReadyIds.at < TRACK_CACHE_TTL_MS) {
    return cachedReadyIds.ids;
  }
  const tracks = await listTracksWithAudio({ readyOnly: true });
  const ids = tracks.map((t) => t.uuid);
  cachedReadyIds = { ids, at: now };
  return ids;
}

/** Min. počet jiných skladeb mezi opakováním stejné skladby. */
export function computeRepeatCooldown(librarySize: number): number {
  if (librarySize <= 1) return 0;
  if (librarySize <= 3) return 1;
  return Math.min(
    librarySize - 1,
    Math.max(3, Math.floor(librarySize * 0.55)),
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

/** Fisher-Yates bag — recent skladby až na konec, aby se neotáčely pořád stejné 2. */
export function buildFreshBag(
  allIds: string[],
  recentUuids: string[] = [],
): string[] {
  if (!allIds.length) return [];

  const recentSet = new Set(recentUuids.filter(Boolean));
  const fresh = shuffle(allIds.filter((id) => !recentSet.has(id)));
  const stale = shuffle(allIds.filter((id) => recentSet.has(id)));
  const bag = [...fresh, ...stale];

  if (bag.length > 1 && recentSet.has(bag[0]!)) {
    const swapIdx = bag.findIndex((id, i) => i > 0 && !recentSet.has(id));
    if (swapIdx > 0) {
      [bag[0], bag[swapIdx]] = [bag[swapIdx]!, bag[0]!];
    }
  }

  return bag;
}

export function topUpBag(
  bag: string[],
  readyIds: string[],
  recentUuids: string[],
  targetSize = QUEUE_TARGET_SIZE,
): string[] {
  const valid = new Set(readyIds);
  const queue = bag.filter((id) => valid.has(id));
  const inQueue = new Set(queue);

  while (queue.length < targetSize && readyIds.length > 0) {
    const missing = readyIds.filter((id) => !inQueue.has(id));
    const pool = missing.length ? missing : readyIds;
    const additions = buildFreshBag(pool, [...recentUuids, ...queue]);
    let added = false;

    for (const id of additions) {
      if (queue.length >= targetSize) break;
      if (inQueue.has(id)) continue;
      queue.push(id);
      inQueue.add(id);
      added = true;
    }

    if (!added) break;
  }

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
  const ids = await getReadyTrackIds();
  const valid = new Set(ids);

  let bag = (state.playlistBag ?? []).filter((id) => valid.has(id));
  const lastPlayedUuid = state.lastPlayedUuid ?? null;
  const recentUuids = recentFromState(state.recentlyPlayed ?? [], lastPlayedUuid);

  if (!bag.length && ids.length) {
    bag = buildFreshBag(ids, recentUuids);
  }

  const topped = topUpBag(bag, ids, recentUuids);
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
  commit: boolean,
): SelectResult {
  if (!readyIds.length) return { uuid: null, bag: [] };

  const valid = new Set(readyIds);
  let queue = bag.filter((id) => valid.has(id));

  if (!queue.length) {
    queue = buildFreshBag(readyIds, recentUuids);
  }

  const blocked = buildBlockedUuids(
    avoidUuid,
    recentUuids,
    readyIds.length,
  );

  for (let attempt = 0; attempt < queue.length + readyIds.length; attempt++) {
    if (!queue.length) {
      queue = buildFreshBag(readyIds, [...recentUuids, ...bag]);
    }
    if (!queue.length) return { uuid: null, bag: [] };

    const candidate = queue[0]!;
    if (!blocked.has(candidate) || readyIds.length === 1) {
      if (commit) {
        if (queue !== bag) {
          return { uuid: candidate, bag: queue.slice(1) };
        }
        return { uuid: candidate, bag: removeFromBag(bag, candidate) };
      }
      return { uuid: candidate, bag: queue };
    }

    queue.push(queue.shift()!);
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
  const readyIds = await getReadyTrackIds();
  return selectFromBag(bag, recentUuids, avoidUuid, readyIds, false);
}

/** Odebere skladbu z fronty (commit). */
export async function pickFromBag(
  bag: string[],
  recentUuids: string[],
  avoidUuid: string | null,
): Promise<SelectResult> {
  const readyIds = await getReadyTrackIds();
  return selectFromBag(bag, recentUuids, avoidUuid, readyIds, true);
}

export async function ensureQueueDepth(
  bag: string[],
  recentUuids: string[],
  targetSize = QUEUE_TARGET_SIZE,
): Promise<string[]> {
  const readyIds = await getReadyTrackIds();
  return topUpBag(bag, readyIds, recentUuids, targetSize);
}
