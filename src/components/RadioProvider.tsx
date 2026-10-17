"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BreakState,
  PlaybackSegment,
  RadioNowPlaying,
  ScheduledTrack,
} from "@/lib/types";
import { buildProgramSchedule, pickNextScheduleTrack, sliceScheduleForDisplay } from "@/lib/program-schedule";
import { STREAM_URL } from "@/lib/types";

function recentKey(tracks: RadioNowPlaying[]): string {
  return tracks.map((t) => t.uuid).join("|");
}

const VOLUME_KEY = "ai-radio-volume";
const DEFAULT_VOLUME = 0.85;

type StreamFormat = "mp3" | "aac";
export type StreamQuality = "auto" | "high" | "low";

const QUALITY_KEY = "ai-radio-quality";

/** Formát, který si přehrávač právě vybral (sdílí ho resolveStreamUrl). */
let activeFormat: StreamFormat = "mp3";
const streamUrlCache = new Map<StreamFormat, { url: string; expiresAt: number }>();

function withStreamCacheBust(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

function invalidateStreamUrls(): void {
  streamUrlCache.clear();
}

async function resolveStreamUrl(): Promise<string> {
  const format = activeFormat;
  const now = Math.floor(Date.now() / 1000);
  const cached = streamUrlCache.get(format);
  if (cached && cached.expiresAt > now + 120) return cached.url;

  const fallback = format === "aac" ? `${STREAM_URL}?format=aac` : STREAM_URL;
  try {
    const res = await fetch(
      `/api/radio/stream-url${format === "aac" ? "?format=aac" : ""}`,
      { cache: "no-store" },
    );
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      url?: string;
      expiresAt?: number | null;
      signed?: boolean;
    };
    if (data.url) {
      streamUrlCache.set(format, {
        url: data.url,
        expiresAt: data.signed && data.expiresAt ? data.expiresAt : now + 86400,
      });
      return data.url;
    }
  } catch {
    // fallback na přímý proxy stream
  }
  streamUrlCache.set(format, { url: fallback, expiresAt: now + 86400 });
  return fallback;
}

/** Slabé připojení / úspora dat / telefon → úspornější AAC. */
function prefersLightStream(): boolean {
  if (typeof window === "undefined") return false;
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (conn?.saveData) return true;
  if (conn?.effectiveType && /(^|-)(2g|3g)$/.test(conn.effectiveType)) return true;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

function readStoredQuality(): StreamQuality {
  if (typeof window === "undefined") return "auto";
  const raw = localStorage.getItem(QUALITY_KEY);
  return raw === "high" || raw === "low" ? raw : "auto";
}

function readStoredVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw == null) return DEFAULT_VOLUME;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_VOLUME;
}

type ConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "offline";

type RadioContextValue = {
  playing: boolean;
  nowPlaying: RadioNowPlaying | null;
  trackStartedAt: string | null;
  recentlyPlayed: RadioNowPlaying[];
  listeners: number;
  broadcasting: boolean;
  stationOnline: boolean;
  queueRemaining: number;
  upcoming: RadioNowPlaying[];
  schedule: ScheduledTrack[];
  nextUp: ScheduledTrack | null;
  segment: PlaybackSegment;
  crossfadeSec: number;
  streamUrl: string;
  shareUrl: string;
  connection: ConnectionState;
  error: string | null;
  statusReady: boolean;
  volume: number;
  setVolume: (value: number) => void;
  quality: StreamQuality;
  setQuality: (value: StreamQuality) => void;
  /** Co se právě přehrává — např. "AAC 96 kbps". */
  streamLabel: string;
  aacAvailable: boolean;
  /** Moderátor mluví do vysílání. */
  micLive: boolean;
  /** Přání čekající na moderátora (pro studio). */
  moderationPending: number;
  breakState: BreakState;
  bed: string;
  bedLevelDb: number;
  /** Jméno moderátora (null = nezobrazovat). */
  moderator: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  reconnect: () => void;
};

const RadioContext = createContext<RadioContextValue | null>(null);

type StatusPayload = {
  nowPlaying?: RadioNowPlaying | null;
  trackStartedAt?: string | null;
  recentlyPlayed?: RadioNowPlaying[];
  listeners?: number;
  broadcasting?: boolean;
  queueRemaining?: number;
  sessionId?: string | null;
  upcoming?: RadioNowPlaying[];
  schedule?: ScheduledTrack[];
  nextUp?: ScheduledTrack | null;
  segment?: PlaybackSegment;
  crossfadeSec?: number;
  streamEpoch?: number;
  songsUntilMidsong?: number;
  midsongDurationSec?: number;
  midsongConfigured?: boolean;
  midsongMinTracks?: number;
  midsongMaxTracks?: number;
  formats?: { mp3: number; aac: number | null };
  micLive?: boolean;
  moderationPending?: number;
  breakState?: BreakState;
  bed?: string;
  bedLevelDb?: number;
  moderator?: string | null;
};

const CONNECTION_DEBOUNCE_MS = 800;

export function RadioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recentKeyRef = useRef("");
  const trackUuidRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [statusReady, setStatusReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<RadioNowPlaying | null>(null);
  const [trackStartedAt, setTrackStartedAt] = useState<string | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<RadioNowPlaying[]>([]);
  const [listeners, setListeners] = useState(0);
  const [broadcasting, setBroadcasting] = useState(false);
  const [stationOnline, setStationOnline] = useState(false);
  const [queueRemaining, setQueueRemaining] = useState(0);
  const [upcoming, setUpcoming] = useState<RadioNowPlaying[]>([]);
  const [schedule, setSchedule] = useState<ScheduledTrack[]>([]);
  const [nextUp, setNextUp] = useState<ScheduledTrack | null>(null);
  const [segment, setSegment] = useState<PlaybackSegment>("song");
  const [crossfadeSec, setCrossfadeSec] = useState(6);
  const [songsUntilMidsong, setSongsUntilMidsong] = useState(4);
  const [midsongDurationSec, setMidsongDurationSec] = useState(6);
  const [midsongConfigured, setMidsongConfigured] = useState(false);
  const [midsongMinTracks, setMidsongMinTracks] = useState(3);
  const [midsongMaxTracks, setMidsongMaxTracks] = useState(6);
  const [streamUrl, setStreamUrl] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [micLive, setMicLive] = useState(false);
  const [moderationPending, setModerationPending] = useState(0);
  const [breakState, setBreakState] = useState<BreakState>("none");
  const [bed, setBed] = useState("builtin");
  const [bedLevelDb, setBedLevelDb] = useState(-10);
  const [moderator, setModerator] = useState<string | null>(null);
  const [quality, setQualityState] = useState<StreamQuality>("auto");
  const [formats, setFormats] = useState<{ mp3: number; aac: number | null }>({
    mp3: 0,
    aac: null,
  });

  const setVolume = useCallback((value: number) => {
    const next = Math.min(1, Math.max(0, value));
    setVolumeState(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(VOLUME_KEY, String(next));
    }
    if (audioRef.current) {
      audioRef.current.volume = next;
    }
  }, []);

  const applyStatus = useCallback((data: StatusPayload) => {
    if (data.sessionId !== undefined && data.sessionId !== sessionIdRef.current) {
      const hadSession = sessionIdRef.current !== null;
      sessionIdRef.current = data.sessionId;
      if (hadSession && data.sessionId) {
        setError("Stanice restartovala — připojuji znovu…");
        const el = audioRef.current;
        if (el && !el.paused) {
          void resolveStreamUrl().then((url) => {
            el.src = url;
            el.load();
            void el.play().catch(() => {});
          });
        }
      }
    } else if (data.sessionId !== undefined) {
      sessionIdRef.current = data.sessionId;
    }

    if (data.nowPlaying !== undefined) {
      const nextUuid = data.nowPlaying?.uuid ?? null;
      if (nextUuid !== trackUuidRef.current) {
        trackUuidRef.current = nextUuid;
        setNowPlaying(data.nowPlaying);
      }
    }

    if (data.trackStartedAt !== undefined) {
      setTrackStartedAt((prev) =>
        data.trackStartedAt === prev ? prev : data.trackStartedAt ?? null,
      );
    }

    const recent = data.recentlyPlayed ?? [];
    const key = recentKey(recent);
    if (key !== recentKeyRef.current) {
      recentKeyRef.current = key;
      setRecentlyPlayed(recent);
    }

    if (data.listeners !== undefined) setListeners(data.listeners);
    if (data.broadcasting !== undefined) setBroadcasting(data.broadcasting);
    if (data.queueRemaining !== undefined) setQueueRemaining(data.queueRemaining);
    if (data.upcoming !== undefined) setUpcoming(data.upcoming);
    if (data.segment !== undefined) setSegment(data.segment);
    if (data.crossfadeSec !== undefined) setCrossfadeSec(data.crossfadeSec);
    if (data.songsUntilMidsong !== undefined) {
      setSongsUntilMidsong(data.songsUntilMidsong);
    }
    if (data.midsongDurationSec !== undefined) {
      setMidsongDurationSec(data.midsongDurationSec);
    }
    if (data.midsongConfigured !== undefined) {
      setMidsongConfigured(data.midsongConfigured);
    }
    if (data.midsongMinTracks !== undefined) {
      setMidsongMinTracks(data.midsongMinTracks);
    }
    if (data.midsongMaxTracks !== undefined) {
      setMidsongMaxTracks(data.midsongMaxTracks);
    }
    if (data.micLive !== undefined) setMicLive(data.micLive);
    if (data.moderationPending !== undefined) setModerationPending(data.moderationPending);
    if (data.breakState !== undefined) setBreakState(data.breakState);
    if (data.bed !== undefined) setBed(data.bed);
    if (data.bedLevelDb !== undefined) setBedLevelDb(data.bedLevelDb);
    if (data.moderator !== undefined) setModerator(data.moderator);
    if (data.formats) {
      const f = data.formats;
      setFormats((prev) =>
        prev.mp3 === f.mp3 && prev.aac === f.aac ? prev : f,
      );
    }
  }, []);

  useEffect(() => {
    // Až po mountu — localStorage na serveru není (a hydratace musí sedět).
    const restore = setTimeout(() => {
      setVolumeState(readStoredVolume());
      setQualityState(readStoredQuality());
      setShareUrl(`${window.location.origin}/player`);
    }, 0);

    void resolveStreamUrl().then((url) => {
      setStreamUrl(url);
    });

    void fetch("/api/radio/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        applyStatus(data as StatusPayload);
        setStatusReady(true);
      })
      .catch(() => setStatusReady(true));
    return () => clearTimeout(restore);
  }, [applyStatus]);

  useEffect(() => {
    const recompute = () => {
      const live = buildProgramSchedule({
        nowPlaying,
        trackStartedAt,
        upcoming,
        crossfadeSec,
        songsUntilMidsong,
        stingerEveryAvg: (midsongMinTracks + midsongMaxTracks) / 2,
        stingerSec: midsongDurationSec,
        showStingers: midsongConfigured,
        stingerLabel: "Jingle",
      });
      setSchedule(sliceScheduleForDisplay(live, 5));
      setNextUp(pickNextScheduleTrack(live));
    };

    const first = setTimeout(recompute, 0);
    const timer = setInterval(recompute, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [
    nowPlaying,
    trackStartedAt,
    upcoming,
    crossfadeSec,
    songsUntilMidsong,
    midsongDurationSec,
    midsongConfigured,
    midsongMinTracks,
    midsongMaxTracks,
  ]);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es?.close();
      es = new EventSource("/api/radio/events");

      es.onopen = () => {
        setStationOnline(true);
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          applyStatus(JSON.parse(event.data) as StatusPayload);
        } catch {
          // ignore malformed
        }
      };

      es.onerror = () => {
        setStationOnline(false);
        es?.close();
        es = null;
        reconnectTimer = setTimeout(connect, 4000);
      };
    };

    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [applyStatus]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    let connectionTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;

    const setConnectionSoon = (state: ConnectionState) => {
      if (connectionTimer) clearTimeout(connectionTimer);
      if (state === "live" || state === "idle") {
        setConnection(state);
        return;
      }
      connectionTimer = setTimeout(() => setConnection(state), CONNECTION_DEBOUNCE_MS);
    };

    const scheduleRetry = () => {
      if (retryTimer) return;
      const delay = Math.min(30_000, 2000 * 2 ** retryAttempt);
      retryAttempt += 1;
      setConnectionSoon("reconnecting");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (el.paused) return;
        void resolveStreamUrl().then((url) => {
          el.src = withStreamCacheBust(url);
          el.load();
          void el.play().catch(() => scheduleRetry());
        });
      }, delay);
    };

    const onPlay = () => {
      setPlaying(true);
      setConnection("live");
      setError(null);
      retryAttempt = 0;
    };
    const onPause = () => {
      setPlaying(false);
      setConnection("idle");
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (connectionTimer) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
      }
    };
    const onWaiting = () => setConnectionSoon("connecting");
    const onPlaying = () => {
      setConnection("live");
      setError(null);
      retryAttempt = 0;
      if (connectionTimer) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
      }
    };
    const onStalled = () => setConnectionSoon("reconnecting");
    const onError = () => {
      setError("Stream offline — zkouším znovu…");
      scheduleRetry();
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("stalled", onStalled);
    el.addEventListener("error", onError);
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (connectionTimer) clearTimeout(connectionTimer);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("stalled", onStalled);
      el.removeEventListener("error", onError);
    };
  }, []);

  const connectStream = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return false;
    setConnection("connecting");
    const url = await resolveStreamUrl();
    setStreamUrl(url);
    el.src = url;
    el.load();
    return true;
  }, []);

  const play = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    void connectStream().then((ok) => {
      if (!ok) return;
      void el.play().catch(() => {
        setError("Přehrávání zablokováno prohlížečem. Klikni znovu.");
        setConnection("idle");
      });
    });
  }, [connectStream]);

  // Vybrat formát podle nastavení kvality a toho, co stanice umí.
  const wantsLight =
    quality === "low" || (quality === "auto" && prefersLightStream());
  const format: StreamFormat = wantsLight && formats.aac ? "aac" : "mp3";

  useEffect(() => {
    if (format === activeFormat) return;
    activeFormat = format;
    const el = audioRef.current;
    if (el && !el.paused) {
      void resolveStreamUrl().then((url) => {
        setStreamUrl(url);
        el.src = withStreamCacheBust(url);
        el.load();
        void el.play().catch(() => {});
      });
    }
  }, [format]);

  const setQuality = useCallback((value: StreamQuality) => {
    setQualityState(value);
    try {
      localStorage.setItem(QUALITY_KEY, value);
    } catch {
      // storage nedostupný
    }
  }, []);

  const streamLabel =
    format === "aac" && formats.aac
      ? `AAC ${formats.aac} kbps`
      : formats.mp3
        ? `MP3 ${formats.mp3} kbps`
        : "";

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    play();
  }, [play]);

  const reconnect = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    setError(null);
    setConnection("reconnecting");
    el.pause();
    invalidateStreamUrls();
    void resolveStreamUrl().then((url) => {
      setStreamUrl(url);
      el.src = withStreamCacheBust(url);
      el.load();
      void el.play().catch(() => {
        setError("Broadcaster neběží. Spusť start.bat.");
        setConnection("offline");
      });
    });
  }, []);

  return (
    <RadioContext.Provider
      value={{
        playing,
        nowPlaying,
        trackStartedAt,
        recentlyPlayed,
        listeners,
        broadcasting,
        stationOnline,
        queueRemaining,
        upcoming,
        schedule,
        nextUp,
        segment,
        crossfadeSec,
        streamUrl,
        shareUrl,
        connection,
        error,
        statusReady,
        volume,
        setVolume,
        quality,
        setQuality,
        streamLabel,
        aacAvailable: formats.aac !== null,
        micLive,
        moderationPending,
        breakState,
        bed,
        bedLevelDb,
        moderator,
        play,
        pause,
        toggle,
        reconnect,
      }}
    >
      {children}
      <audio ref={audioRef} preload="none" />
    </RadioContext.Provider>
  );
}

export function useRadio(): RadioContextValue {
  const ctx = useContext(RadioContext);
  if (!ctx) {
    throw new Error("useRadio must be used within RadioProvider");
  }
  return ctx;
}
