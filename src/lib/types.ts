export type RadioNowPlaying = {
  uuid: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  thumbnail: string | null;
  durationSec?: number | null;
};

export type ScheduledTrack = RadioNowPlaying & {
  position: number;
  startsAtMs: number;
  startsInSec: number;
  /** Položka programu — skladba nebo midsong/stinger mezi skladbami. */
  kind?: "track" | "stinger";
};

export type ScheduledProgramItem = ScheduledTrack;

export type PlaybackSegment = "song" | "crossfade" | "stinger";

export type StationConfig = {
  name: string;
  tagline: string;
  logoUrl: string;
  colorAccent: string;
  colorAccentSoft: string;
  colorBg: string;
  colorBgMid: string;
  colorBgPanel: string;
};

export type LibraryTrack = {
  uuid: string;
  spotifyId: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  duration: number | null;
  playDuration?: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  downloadUrl: string | null;
  audioFile?: string | null;
  status: string;
};

export type ImportJob = {
  id: string;
  type: string;
  title: string;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  current: string | null;
  currentDetail: string | null;
  error: string | null;
  items: {
    title: string;
    artist: string;
    status: string;
    detail: string | null;
    error: string | null;
  }[];
};

export type RemasterJob = {
  id: string;
  status: "running" | "done" | "failed";
  total: number;
  completed: number;
  failed: number;
  current: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type StudioHealth = {
  broadcaster: {
    online: boolean;
    pid: number | null;
    broadcasting: boolean;
    listeners: number;
    sessionId: string | null;
  };
  library: {
    total: number;
    ready: number;
    failed: number;
    processed: number;
    needsRemaster: number;
  };
  tools: { ffmpeg: string | null; ytDlp: string | null };
  midsong: {
    configured: boolean;
    count: number;
    minTracks: number;
    maxTracks: number;
    chance: number;
    fadeSec: number;
  };
};

export type QueuePreview = {
  upcoming: RadioNowPlaying[];
  schedule: ScheduledTrack[];
  nextUp: ScheduledTrack | null;
  reserved: string | null;
  queueRemaining: number;
};

export const STREAM_URL = "/api/radio/stream";

/** @deprecated Stream jde přes Next.js proxy — použij fetchStreamUrl(). */
export function getDirectStreamUrl(): string {
  return STREAM_URL;
}
