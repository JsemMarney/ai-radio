import { listTracksWithAudio } from "@/lib/library";
import { readRadioState, writeListenerRequestQueue } from "@/lib/radio-state";
import type { RadioNowPlaying } from "@/lib/types";

export function areSongRequestsEnabled(): boolean {
  const flag = process.env.RADIO_REQUESTS?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on";
}

export function getMaxRequestQueue(): number {
  const raw = Number(process.env.RADIO_REQUESTS_MAX ?? 8);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 20) : 8;
}

export async function getListenerRequestQueue(): Promise<string[]> {
  const state = await readRadioState();
  return state.listenerRequests ?? [];
}

export async function setListenerRequestQueue(uuids: string[]): Promise<void> {
  await writeListenerRequestQueue(uuids);
}

export async function getRequestableTracks(options?: {
  search?: string;
  limit?: number;
  excludeUuids?: string[];
}): Promise<RadioNowPlaying[]> {
  const limit = Math.min(options?.limit ?? 40, 80);
  const q = options?.search?.trim().toLowerCase() ?? "";
  const exclude = new Set(options?.excludeUuids ?? []);

  const tracks = await listTracksWithAudio({ readyOnly: true });
  const out: RadioNowPlaying[] = [];

  for (const t of tracks) {
    if (exclude.has(t.uuid)) continue;
    const hay = `${t.title} ${t.artist} ${t.album ?? ""}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    out.push({
      uuid: t.uuid,
      title: t.title,
      artist: t.artist,
      album: t.album,
      year: t.year,
      thumbnail: t.thumbnail,
      durationSec: t.playDuration ?? t.duration,
    });
    if (out.length >= limit) break;
  }

  return out;
}

export async function validateListenerRequest(
  uuid: string,
  blockedUuids: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!areSongRequestsEnabled()) {
    return { ok: false, error: "Song requesty jsou vypnuté." };
  }

  const trimmed = uuid.trim();
  if (!trimmed) {
    return { ok: false, error: "Chybí skladba." };
  }

  if (blockedUuids.includes(trimmed)) {
    return {
      ok: false,
      error: "Tato skladba právě hraje nebo nedávno hrála.",
    };
  }

  const tracks = await listTracksWithAudio({ readyOnly: true });
  if (!tracks.some((t) => t.uuid === trimmed)) {
    return { ok: false, error: "Skladba není v knihovně nebo není ready." };
  }

  const queue = await getListenerRequestQueue();
  if (queue.includes(trimmed)) {
    return { ok: false, error: "Skladba už je ve frontě requestů." };
  }

  if (queue.length >= getMaxRequestQueue()) {
    return { ok: false, error: "Fronta requestů je plná. Zkus později." };
  }

  return { ok: true };
}

export async function enqueueListenerRequest(uuid: string): Promise<number> {
  const queue = await getListenerRequestQueue();
  queue.push(uuid);
  await setListenerRequestQueue(queue);
  return queue.length;
}
