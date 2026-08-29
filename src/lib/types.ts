export type RadioNowPlaying = {
  uuid: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  thumbnail: string | null;
  durationSec?: number | null;
};

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
  error: string | null;
  items: {
    title: string;
    artist: string;
    status: string;
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
  jingle: {
    configured: boolean;
    everyNTracks: number;
    path: string | null;
  };
  midsong: {
    configured: boolean;
    count: number;
    everyNTracks: number;
    chance: number;
    fadeSec: number;
  };
};

export type QueuePreview = {
  upcoming: RadioNowPlaying[];
  reserved: string | null;
  queueRemaining: number;
};

export const STREAM_URL = "/api/radio/stream";

/** Přímý Icecast stream — bez Next.js proxy, live edge. */
export function getDirectStreamUrl(host?: string): string {
  const h = host ?? (typeof window !== "undefined" ? window.location.hostname : "127.0.0.1");
  const port = process.env.NEXT_PUBLIC_RADIO_STREAM_PORT ?? "8788";
  return `http://${h}:${port}/stream`;
}
