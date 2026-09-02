import type { RadioNowPlaying } from "@/lib/types";
import { computePairFade } from "@/lib/fade-math";

export type ScheduledTrack = RadioNowPlaying & {
  position: number;
  /** Unix ms — odhad startu skladby (včetně crossfade překryvu). */
  startsAtMs: number;
  /** Sekundy od teď; 0 = právě teď / crossfade. */
  startsInSec: number;
  kind?: "track" | "stinger";
};

export type ProgramScheduleInput = {
  nowPlaying: RadioNowPlaying | null;
  trackStartedAt: string | null;
  upcoming: RadioNowPlaying[];
  crossfadeSec: number;
  /** Délka midsong/stingeru (s) — z délky souboru. */
  stingerSec?: number;
  /** Skutečný stav enginu: kolik přechodů zbývá do další šance na midsong. */
  songsUntilMidsong?: number;
  /** Odhad dalšího intervalu po midsongu (průměr min–max). */
  stingerEveryAvg?: number;
  /** Vložit midsong řádky do programu (když je soubor nakonfigurovaný). */
  showStingers?: boolean;
  stingerLabel?: string;
};

function trackDuration(track: RadioNowPlaying | null): number {
  if (!track) return 0;
  const d = track.durationSec ?? 0;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

function elapsedSec(trackStartedAt: string | null): number {
  if (!trackStartedAt) return 0;
  const ms = Date.parse(trackStartedAt);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, (Date.now() - ms) / 1000);
}

function nextStingerInterval(stingerEveryAvg: number): number {
  return Math.max(1, Math.floor(stingerEveryAvg));
}

/**
 * Odhad programu — kdy která skladba z fronty začne.
 * Crossfade: další skladba startuje fadeSec před koncem předchozí.
 * Midsong: stejná logika jako engine (songsUntilMidsong), vložený PŘED skladbou.
 */
export function buildProgramSchedule(
  input: ProgramScheduleInput,
): ScheduledTrack[] {
  const {
    nowPlaying,
    trackStartedAt,
    upcoming,
    crossfadeSec,
    stingerSec = 6,
    songsUntilMidsong,
    stingerEveryAvg = 4.5,
    showStingers = false,
    stingerLabel = "Midsong",
  } = input;

  if (!upcoming.length) return [];

  const now = Date.now();
  let cursorMs = now;

  const durNow = trackDuration(nowPlaying);
  const elapsed = elapsedSec(trackStartedAt);

  if (nowPlaying && durNow > 0 && trackStartedAt) {
    const fade = computePairFade(
      Math.max(0, durNow - elapsed),
      trackDuration(upcoming[0]) || durNow,
      crossfadeSec,
    );
    const remaining = Math.max(0, durNow - elapsed);
    cursorMs = now + Math.max(0, (remaining - fade) * 1000);
  }

  const out: ScheduledTrack[] = [];
  let position = 0;
  let counter = Math.max(
    1,
    songsUntilMidsong ?? nextStingerInterval(stingerEveryAvg),
  );
  const afterMidsongInterval = nextStingerInterval(stingerEveryAvg);

  for (let i = 0; i < upcoming.length; i++) {
    const track = upcoming[i]!;
    const dur = trackDuration(track) || 210;
    const nextDur = trackDuration(upcoming[i + 1] ?? null) || dur;
    const fade = computePairFade(dur, nextDur, crossfadeSec);

    if (showStingers && stingerSec > 0 && counter === 1) {
      position += 1;
      out.push({
        uuid: `stinger-before-${track.uuid}`,
        title: stingerLabel,
        artist: "Mezi skladbami",
        album: null,
        year: null,
        thumbnail: null,
        durationSec: stingerSec,
        kind: "stinger",
        position,
        startsAtMs: cursorMs,
        startsInSec: Math.max(0, Math.round((cursorMs - now) / 1000)),
      });
      cursorMs += stingerSec * 1000;
      counter = afterMidsongInterval;
    }

    position += 1;
    out.push({
      ...track,
      kind: "track",
      position,
      startsAtMs: cursorMs,
      startsInSec: Math.max(0, Math.round((cursorMs - now) / 1000)),
    });

    const playableSec = Math.max(30, dur - fade);
    cursorMs += playableSec * 1000;

    counter -= 1;
    if (counter <= 0) {
      counter = afterMidsongInterval;
    }
  }

  return out;
}

export function formatStartsIn(sec: number): string {
  if (sec <= 0) return "brzy";
  if (sec < 60) return `za ${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `za ${m}:${s.toString().padStart(2, "0")}` : `za ${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `za ${h}:${rm.toString().padStart(2, "0")} h`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function pickNextScheduleTrack(
  schedule: ScheduledTrack[],
): ScheduledTrack | null {
  return schedule[0] ?? null;
}

/** Ořízne program pro UI — max N skladeb (midsong řádky mezi nimi zůstanou). */
export function sliceScheduleForDisplay(
  schedule: ScheduledTrack[],
  maxTracks = 5,
): ScheduledTrack[] {
  const out: ScheduledTrack[] = [];
  let tracks = 0;
  for (const item of schedule) {
    out.push(item);
    if (item.kind !== "stinger") {
      tracks += 1;
      if (tracks >= maxTracks) break;
    }
  }
  return out;
}
