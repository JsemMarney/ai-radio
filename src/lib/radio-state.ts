import { open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureDownloadsDir, getDownloadsDir } from "@/lib/library";

export type RadioNowPlaying = {
  uuid: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  thumbnail: string | null;
};

export type PersistedRadioState = {
  nowPlaying: RadioNowPlaying | null;
  trackStartedAt: string | null;
  recentlyPlayed: RadioNowPlaying[];
  listenerCount: number;
  broadcasting: boolean;
  broadcasterPid: number | null;
  updatedAt: string;
};

const MAX_RECENT = 5;

function lockPath(): string {
  return path.join(getDownloadsDir(), ".radio-broadcast.lock");
}

function statePath(): string {
  return path.join(getDownloadsDir(), "radio-state.json");
}

function lockStaleMs(): number {
  const raw = process.env.RADIO_LOCK_STALE_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return process.env.NODE_ENV === "development" ? 12_000 : 45_000;
}

type LockInfo = { pid: number; at: number };

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLockInfo(): Promise<LockInfo | null> {
  try {
    const raw = await readFile(lockPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    if (typeof parsed.pid !== "number" || typeof parsed.at !== "number") return null;
    return { pid: parsed.pid, at: parsed.at };
  } catch {
    return null;
  }
}

async function isLockStale(): Promise<boolean> {
  if (!existsSync(lockPath())) return true;

  const info = await readLockInfo();
  const fileStat = await stat(lockPath()).catch(() => null);
  const now = Date.now();

  if (info && !isPidAlive(info.pid)) return true;
  if (info && now - info.at > lockStaleMs()) return true;
  if (fileStat && now - fileStat.mtimeMs > lockStaleMs()) return true;

  return false;
}

export async function cleanupStaleBroadcastLock(): Promise<boolean> {
  if (!existsSync(lockPath())) return false;
  if (!(await isLockStale())) return false;
  await unlink(lockPath()).catch(() => {});
  return true;
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, filePath);
}

const DEFAULT_STATE = (): PersistedRadioState => ({
  nowPlaying: null,
  trackStartedAt: null,
  recentlyPlayed: [],
  listenerCount: 0,
  broadcasting: false,
  broadcasterPid: null,
  updatedAt: new Date().toISOString(),
});

export async function readRadioState(): Promise<PersistedRadioState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await readFile(statePath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedRadioState>;
      return {
        ...DEFAULT_STATE(),
        ...parsed,
        recentlyPlayed: parsed.recentlyPlayed ?? [],
        listenerCount: parsed.listenerCount ?? 0,
        broadcasting: parsed.broadcasting ?? false,
        broadcasterPid: parsed.broadcasterPid ?? null,
      };
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 25));
    }
  }
  return DEFAULT_STATE();
}

async function writeState(state: PersistedRadioState): Promise<void> {
  await ensureDownloadsDir();
  state.updatedAt = new Date().toISOString();
  await atomicWriteJson(statePath(), state);
}

export async function tryAcquireBroadcastLock(): Promise<boolean> {
  await ensureDownloadsDir();
  await cleanupStaleBroadcastLock();

  const p = lockPath();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fh = await open(p, "wx");
      await fh.writeFile(
        JSON.stringify({ pid: process.pid, at: Date.now() }),
        "utf8",
      );
      await fh.close();
      return true;
    } catch {
      if (await isLockStale()) {
        await unlink(p).catch(() => {});
        continue;
      }
      const info = await readLockInfo();
      if (info?.pid === process.pid) return true;
      return false;
    }
  }
  return false;
}

export async function refreshBroadcastLock(): Promise<void> {
  if (!existsSync(lockPath())) return;
  await writeFile(
    lockPath(),
    JSON.stringify({ pid: process.pid, at: Date.now() }),
    "utf8",
  );
}

export async function releaseBroadcastLock(): Promise<void> {
  const info = await readLockInfo();
  if (info?.pid === process.pid) {
    await unlink(lockPath()).catch(() => {});
  }
}

export async function setBroadcasting(active: boolean): Promise<void> {
  const existing = await readRadioState();
  await writeState({
    ...existing,
    broadcasting: active,
    broadcasterPid: active ? process.pid : null,
  });
}

export async function adjustListenerCount(delta: number): Promise<number> {
  const existing = await readRadioState();
  const listenerCount = Math.max(0, (existing.listenerCount ?? 0) + delta);
  await writeState({ ...existing, listenerCount });
  return listenerCount;
}

export async function writeRadioState(
  nowPlaying: RadioNowPlaying | null,
  trackStartedAt?: string | null,
  atCrossfade = false,
): Promise<void> {
  const existing = await readRadioState();

  let startedAt: string | null;
  if (!nowPlaying) {
    startedAt = null;
  } else if (atCrossfade) {
    startedAt = new Date().toISOString();
  } else if (trackStartedAt !== undefined) {
    startedAt = trackStartedAt;
  } else if (
    existing.nowPlaying?.uuid === nowPlaying.uuid &&
    existing.trackStartedAt
  ) {
    startedAt = existing.trackStartedAt;
  } else {
    startedAt = new Date().toISOString();
  }

  await writeState({
    ...existing,
    nowPlaying,
    trackStartedAt: startedAt,
  });
}

/** Atomically update nowPlaying + optionally append to recently played. */
export async function updateNowPlaying(
  nowPlaying: RadioNowPlaying | null,
  options?: { atCrossfade?: boolean; addPreviousToRecent?: RadioNowPlaying },
): Promise<void> {
  const existing = await readRadioState();

  let trackStartedAt: string | null;
  if (!nowPlaying) {
    trackStartedAt = null;
  } else if (options?.atCrossfade) {
    trackStartedAt = new Date().toISOString();
  } else if (
    existing.nowPlaying?.uuid === nowPlaying.uuid &&
    existing.trackStartedAt
  ) {
    trackStartedAt = existing.trackStartedAt;
  } else {
    trackStartedAt = new Date().toISOString();
  }

  let recentlyPlayed = existing.recentlyPlayed ?? [];
  const prev = options?.addPreviousToRecent;
  if (prev && prev.uuid !== nowPlaying?.uuid) {
    const alreadyFirst = recentlyPlayed[0]?.uuid === prev.uuid;
    if (!alreadyFirst) {
      recentlyPlayed = [
        prev,
        ...recentlyPlayed.filter((t) => t.uuid !== prev.uuid),
      ].slice(0, MAX_RECENT);
    }
  }

  await writeState({
    ...existing,
    nowPlaying,
    trackStartedAt,
    recentlyPlayed,
  });
}

export async function pushRecentlyPlayed(track: RadioNowPlaying): Promise<void> {
  const existing = await readRadioState();
  const recent = existing.recentlyPlayed.filter((t) => t.uuid !== track.uuid);
  recent.unshift(track);

  await writeState({
    ...existing,
    recentlyPlayed: recent.slice(0, MAX_RECENT),
  });
}
