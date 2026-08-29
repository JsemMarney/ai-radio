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
import type { RadioNowPlaying, QueuePreview } from "@/lib/types";
import { getDirectStreamUrl } from "@/lib/types";

function recentKey(tracks: RadioNowPlaying[]): string {
  return tracks.map((t) => t.uuid).join("|");
}

const VOLUME_KEY = "ai-radio-volume";
const DEFAULT_VOLUME = 0.85;

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
  streamUrl: string;
  connection: ConnectionState;
  error: string | null;
  statusReady: boolean;
  volume: number;
  setVolume: (value: number) => void;
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
  const [streamUrl, setStreamUrl] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);

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

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/queue?limit=5", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as QueuePreview;
      setUpcoming(data.upcoming ?? []);
      if (data.queueRemaining !== undefined) {
        setQueueRemaining(data.queueRemaining);
      }
    } catch {
      // ignore
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
          el.pause();
          el.src = getDirectStreamUrl();
          el.load();
          void el.play().catch(() => {});
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
  }, []);

  useEffect(() => {
    const direct = getDirectStreamUrl();
    setStreamUrl(direct);
    setVolumeState(readStoredVolume());

    void fetch("/api/radio/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        applyStatus(data as StatusPayload);
        setStatusReady(true);
      })
      .catch(() => setStatusReady(true));
  }, [applyStatus]);

  useEffect(() => {
    if (!statusReady) return;
    void loadQueue();
    const timer = setInterval(() => void loadQueue(), 10_000);
    return () => clearInterval(timer);
  }, [statusReady, loadQueue, nowPlaying?.uuid]);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;

    function connect() {
      if (closed) return;
      es?.close();
      es = new EventSource("/api/radio/events");

      es.onopen = () => {
        attempt = 0;
        setStationOnline(true);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as StatusPayload & { offline?: boolean };
          if (data.offline) {
            setStationOnline(false);
            return;
          }
          setStationOnline(true);
          applyStatus(data);
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        setStationOnline(false);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        attempt += 1;
        const waitMs = Math.min(30_000, 2000 * Math.min(attempt, 5));
        reconnectTimer = setTimeout(connect, waitMs);
      };
    }

    connect();

    return () => {
      closed = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [applyStatus]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
  }, [volume]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let connectionTimer: ReturnType<typeof setTimeout> | null = null;
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
        el.src = getDirectStreamUrl();
        el.load();
        void el.play().catch(() => scheduleRetry());
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

  const connectStream = useCallback(() => {
    const el = audioRef.current;
    if (!el) return false;
    setConnection("connecting");
    // Bez cache-bust — jeden kontinuální live mount (jako Icecast)
    el.src = getDirectStreamUrl();
    el.load();
    return true;
  }, []);

  const play = useCallback(() => {
    const el = audioRef.current;
    if (!el || !connectStream()) return;
    void el.play().catch(() => {
      setError("Přehrávání zablokováno prohlížečem. Klikni znovu.");
      setConnection("idle");
    });
  }, [connectStream]);

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
    el.src = getDirectStreamUrl();
    el.load();
    void el.play().catch(() => {
      setError("Broadcaster neběží. Spusť start.bat.");
      setConnection("offline");
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
        streamUrl,
        connection,
        error,
        volume,
        setVolume,
        statusReady,
        play,
        pause,
        toggle,
        reconnect,
      }}
    >
      {children}
      <audio
        ref={audioRef}
        className="sr-only"
        preload="none"
        playsInline
        controlsList="nodownload noplaybackrate noremoteplayback"
      />
    </RadioContext.Provider>
  );
}

export function useRadio(): RadioContextValue {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio must be used within RadioProvider");
  return ctx;
}
