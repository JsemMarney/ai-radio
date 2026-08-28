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
import type { RadioNowPlaying } from "@/lib/types";
import { STREAM_URL } from "@/lib/types";

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

type ConnectionState = "idle" | "connecting" | "live" | "reconnecting";

type RadioContextValue = {
  playing: boolean;
  nowPlaying: RadioNowPlaying | null;
  recentlyPlayed: RadioNowPlaying[];
  listeners: number;
  broadcasting: boolean;
  queueRemaining: number;
  streamUrl: string;
  connection: ConnectionState;
  error: string | null;
  volume: number;
  setVolume: (value: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  reconnect: () => void;
};

const RadioContext = createContext<RadioContextValue | null>(null);

export function RadioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackStartedAtRef = useRef<string | null>(null);
  const recentKeyRef = useRef("");
  const nullPollsRef = useRef(0);
  const pollFailRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<RadioNowPlaying | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<RadioNowPlaying[]>([]);
  const [listeners, setListeners] = useState(0);
  const [broadcasting, setBroadcasting] = useState(false);
  const [queueRemaining, setQueueRemaining] = useState(0);
  const [streamUrl, setStreamUrl] = useState(STREAM_URL);
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

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/status", { cache: "no-store" });
      if (!res.ok) {
        pollFailRef.current += 1;
        return;
      }
      pollFailRef.current = 0;

      const data = (await res.json()) as {
        nowPlaying?: RadioNowPlaying | null;
        trackStartedAt?: string | null;
        recentlyPlayed?: RadioNowPlaying[];
        listeners?: number;
        broadcasting?: boolean;
        queueRemaining?: number;
      };

      const next = data.nowPlaying ?? null;
      const startedAt = data.trackStartedAt ?? null;
      const isLive = data.broadcasting ?? false;

      setNowPlaying((prev) => {
        if (next) {
          nullPollsRef.current = 0;
          if (prev?.uuid === next.uuid) return prev;
          if (
            startedAt &&
            trackStartedAtRef.current &&
            startedAt < trackStartedAtRef.current
          ) {
            return prev;
          }
          trackStartedAtRef.current = startedAt;
          return next;
        }

        if (isLive && prev) {
          nullPollsRef.current += 1;
          return nullPollsRef.current >= 5 ? null : prev;
        }

        nullPollsRef.current = 0;
        return null;
      });

      const recent = data.recentlyPlayed ?? [];
      const key = recentKey(recent);
      if (key !== recentKeyRef.current) {
        recentKeyRef.current = key;
        setRecentlyPlayed(recent);
      }

      setListeners(data.listeners ?? 0);
      setBroadcasting(isLive);
      setQueueRemaining(data.queueRemaining ?? 0);
    } catch {
      pollFailRef.current += 1;
    }
  }, []);

  useEffect(() => {
    setStreamUrl(`${window.location.origin}${STREAM_URL}`);
    setVolumeState(readStoredVolume());
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
  }, [volume]);

  useEffect(() => {
    void pollStatus();
    const timer = setInterval(() => void pollStatus(), 2000);
    return () => clearInterval(timer);
  }, [pollStatus]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onPlay = () => {
      setPlaying(true);
      setConnection("live");
      setError(null);
    };
    const onPause = () => {
      setPlaying(false);
      setConnection("idle");
    };
    const onWaiting = () => setConnection("connecting");
    const onPlaying = () => {
      setConnection("live");
      setError(null);
    };
    const onStalled = () => setConnection("reconnecting");
    const onError = () => {
      setError("Stream se nepodařilo přehrát. Zkus znovu připojit.");
      setPlaying(false);
      setConnection("idle");
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("stalled", onStalled);
    el.addEventListener("error", onError);
    return () => {
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
    if (!el.src || !el.src.includes(STREAM_URL)) {
      el.src = `${STREAM_URL}?t=${Date.now()}`;
      el.load();
    }
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
    el.src = `${STREAM_URL}?t=${Date.now()}`;
    el.load();
    void el.play().catch(() => {
      setError("Nepodařilo se znovu připojit ke streamu.");
      setConnection("idle");
    });
  }, []);

  return (
    <RadioContext.Provider
      value={{
        playing,
        nowPlaying,
        recentlyPlayed,
        listeners,
        broadcasting,
        queueRemaining,
        streamUrl,
        connection,
        error,
        volume,
        setVolume,
        play,
        pause,
        toggle,
        reconnect,
      }}
    >
      {children}
      <audio ref={audioRef} className="sr-only" preload="none" />
    </RadioContext.Provider>
  );
}

export function useRadio(): RadioContextValue {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio must be used within RadioProvider");
  return ctx;
}
