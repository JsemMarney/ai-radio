export type RadioNowPlaying = {
  uuid: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  thumbnail: string | null;
  durationSec?: number | null;
  /** Skladba si přál posluchač. */
  requested?: boolean;
  /** Kdy skladba začala hrát (ISO) — pro výpis "co hrálo". */
  startedAt?: string;
  /** Věnování ze schváleného přání. */
  dedication?: Dedication;
};

export type Dedication = {
  from: string | null;
  message: string | null;
  /** Id přání s hlasovkou — moderátor ji může pustit do éteru. */
  voiceId?: string;
};

export type RequestStatus = "pending" | "approved" | "rejected" | "played" | "expired";

/** Přání posluchače — čeká na moderátora, pak jde do fronty. */
export type ListenerRequest = {
  id: string;
  uuid: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  from: string | null;
  message: string | null;
  /** Vzkaz obsahoval sprosté slovo (je vyhvězdičkovaný). */
  flagged: boolean;
  status: RequestStatus;
  createdAt: string;
  decidedAt?: string;
  playedAt?: string;
  /** Posluchač přiložil hlasovku (downloads/_voice/<id>.mp3). */
  hasVoice?: boolean;
  voiceSec?: number;
};

/** Co posluchač vidí o svém přání. */
export type RequestStatusView = {
  id: string;
  status: RequestStatus;
  title: string;
  artist: string;
  /** Pořadí ve frontě, když je schválené (1 = hraje jako další). */
  position: number | null;
};

export type ScheduledTrack = RadioNowPlaying & {
  position: number;
  startsAtMs: number;
  startsInSec: number;
  /** Položka programu — skladba nebo midsong/stinger mezi skladbami. */
  kind?: "track" | "stinger";
};

export type ScheduledProgramItem = ScheduledTrack;

export type PlaybackSegment = "song" | "crossfade" | "stinger" | "talk";

/** Pauza na mluvené slovo: none → armed (po skladbě) → on (hraje podkres). */
export type BreakState = "none" | "armed" | "on";

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

export type QueueItemSource = "prepared" | "request" | "rotation";

/** Položka fronty ve studiu. */
export type StudioQueueItem = RadioNowPlaying & {
  source: QueueItemSource;
  stingerBefore?: boolean;
};

export type LibraryStatsRow = {
  uuid: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  plays: number;
  lastPlayedAt: string | null;
  lufs: number | null;
  broken: { reason: string; at: string } | null;
};

export type DuplicateTrack = {
  uuid: string;
  title: string;
  artist: string;
  album: string | null;
  thumbnail: string | null;
  createdAt: string;
  plays: number;
};

export type LibraryStats = {
  rows: LibraryStatsRow[];
  totalPlays: number;
  libraryHours: number;
  /** Stejná skladba vícekrát (jiné verze / Spotify ID) — první se hraje, další jsou navíc. */
  duplicates: DuplicateTrack[][];
};

export const STREAM_URL = "/api/radio/stream";

/** @deprecated Stream jde přes Next.js proxy — použij fetchStreamUrl(). */
export function getDirectStreamUrl(): string {
  return STREAM_URL;
}
