export type RadioNowPlaying = {
  uuid: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  thumbnail: string | null;
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

export const STREAM_URL = "/api/radio/stream";
