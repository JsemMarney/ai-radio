import { open, readFile, stat, unlink, writeFile } from "node:fs/promises";
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
  updatedAt: string;
};

function lockPath(): string {
  return path.join(getDownloadsDir(), ".radio-broadcast.lock");
}

export async function tryAcquireBroadcastLock(): Promise<boolean> {
  await ensureDownloadsDir();
  const p = lockPath();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(p, "wx");
      await fh.writeFile(
        JSON.stringify({ pid: process.pid, at: Date.now() }),
        "utf8",
      );
      await fh.close();
      return true;
    } catch {
      if (!existsSync(p)) continue;
      const info = await stat(p);
      if (Date.now() - info.mtimeMs > 60_000) {
        await unlink(p).catch(() => {});
        continue;
      }
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
  if (!existsSync(lockPath())) return;
  try {
    const raw = await readFile(lockPath(), "utf8");
    const data = JSON.parse(raw) as { pid?: number };
    if (data.pid === process.pid) {
      await unlink(lockPath());
    }
  } catch {
    // ignore
  }
}

function statePath(): string {
  return path.join(getDownloadsDir(), "radio-state.json");
}

export async function readRadioState(): Promise<PersistedRadioState | null> {
  try {
    const raw = await readFile(statePath(), "utf8");
    return JSON.parse(raw) as PersistedRadioState;
  } catch {
    return null;
  }
}

export async function writeRadioState(
  nowPlaying: RadioNowPlaying | null,
  trackStartedAt: string | null = nowPlaying ? new Date().toISOString() : null,
): Promise<void> {
  await ensureDownloadsDir();
  const state: PersistedRadioState = {
    nowPlaying,
    trackStartedAt,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(statePath(), JSON.stringify(state, null, 2), "utf8");
}
