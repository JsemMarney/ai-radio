"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type RadioNowPlaying = {
  uuid: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  thumbnail: string | null;
};

const STREAM_URL = "/api/radio/stream";

export default function PlayerPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackStartedAtRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<RadioNowPlaying | null>(null);
  const [listeners, setListeners] = useState(0);
  const [streamUrl, setStreamUrl] = useState(STREAM_URL);
  const [error, setError] = useState<string | null>(null);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/status");
      if (!res.ok) return;
      const data = (await res.json()) as {
        nowPlaying?: RadioNowPlaying | null;
        trackStartedAt?: string | null;
        listeners?: number;
      };
      const next = data.nowPlaying ?? null;
      const startedAt = data.trackStartedAt ?? null;

      setNowPlaying((prev) => {
        if (!next) return null;
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
      });
      setListeners(data.listeners ?? 0);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setStreamUrl(`${window.location.origin}${STREAM_URL}`);
  }, []);

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
      setError(null);
    };
    const onPause = () => setPlaying(false);
    const onError = () => {
      setError("Stream se nepodařilo přehrát. Zkus to znovu.");
      setPlaying(false);
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
    };
  }, []);

  function connectStream() {
    const el = audioRef.current;
    if (!el) return false;
    if (!el.src || !el.src.includes(STREAM_URL)) {
      el.src = STREAM_URL;
      el.load();
    }
    return true;
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;

    if (!el.paused) {
      el.pause();
      return;
    }

    if (!connectStream()) return;

    void el.play().catch(() => {
      setError("Přehrávání zablokováno prohlížečem. Klikni znovu na Play.");
    });
  }

  async function skipTrack() {
    await fetch("/api/radio/skip", { method: "POST" });
    void pollStatus();

    const el = audioRef.current;
    if (!el || !playing) return;
    if (!connectStream()) return;

    el.pause();
    el.load();
    void el.play().catch(() => {});
  }

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center px-5 py-10">
      <Link
        href="/"
        className="absolute left-5 top-6 text-sm text-[var(--ink-muted)] transition hover:text-[var(--accent-soft)]"
      >
        ← Knihovna
      </Link>

      <div className="animate-fade-up w-full text-center">
        <p className="mb-2 text-xs font-semibold tracking-[0.3em] text-[var(--accent)] uppercase">
          AI Radio
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
          Live
        </h1>
        {listeners > 0 && (
          <p className="mt-2 text-xs text-[var(--ink-muted)]">
            {listeners} {listeners === 1 ? "posluchač" : listeners < 5 ? "posluchači" : "posluchačů"}
          </p>
        )}
      </div>

      <div
        className="animate-fade-up relative my-10 aspect-square w-full max-w-[280px]"
        style={{ animationDelay: "80ms" }}
      >
        <div
          className={`absolute inset-0 rounded-full bg-[var(--bg-panel)] shadow-[0_0_60px_rgba(212,162,76,0.12)] ${playing ? "vinyl-spin" : ""}`}
        />
        <div className="absolute inset-[8%] overflow-hidden rounded-full border border-[var(--line)] bg-[var(--bg-deep)]">
          {nowPlaying?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={nowPlaying.uuid}
              src={nowPlaying.thumbnail}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--ink-muted)]">
              —
            </div>
          )}
        </div>
        <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--line)] bg-[var(--bg-deep)]" />
      </div>

      <div
        className="animate-fade-up w-full text-center"
        style={{ animationDelay: "120ms" }}
      >
        <p className="truncate font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
          {nowPlaying?.title ?? "Čekám na skladbu…"}
        </p>
        <p className="mt-1 truncate text-[var(--accent-soft)]">
          {nowPlaying?.artist ?? (playing ? "…" : "Rádio běží — klikni Play")}
        </p>
        {nowPlaying?.album && (
          <p className="mt-2 truncate text-sm text-[var(--ink-muted)]">
            {nowPlaying.year ? `${nowPlaying.year} · ` : ""}
            {nowPlaying.album}
          </p>
        )}
      </div>

      <div
        className="animate-fade-up mt-10 flex items-center justify-center gap-4"
        style={{ animationDelay: "160ms" }}
      >
        <button
          type="button"
          onClick={togglePlay}
          className={`flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-lg font-bold text-[var(--bg-deep)] transition hover:bg-[var(--accent-soft)] ${playing ? "" : "animate-pulse-ring"}`}
          aria-label={playing ? "Pauza" : "Přehrát"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          onClick={() => void skipTrack()}
          disabled={!playing}
          className="rounded-xl border border-[var(--line)] px-5 py-3 text-sm text-[var(--ink)] transition hover:border-[var(--accent)]/40 disabled:opacity-40"
        >
          Další
        </button>
      </div>

      {error && (
        <p
          className="animate-fade-up mt-6 w-full rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-center text-sm text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      )}

      <div
        className="animate-fade-up mt-8 w-full rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/60 p-4"
        style={{ animationDelay: "200ms" }}
      >
        <p className="text-xs text-[var(--ink-muted)]">Stream API</p>
        <code className="mt-1 block truncate text-sm text-[var(--accent-soft)]">
          {streamUrl}
        </code>
        <p className="mt-2 text-xs leading-relaxed text-[var(--ink-muted)]">
          Funguje v prohlížeči, VLC nebo jakémkoli přehrávači co umí HTTP stream.
        </p>
      </div>

      <audio ref={audioRef} className="sr-only" preload="none" />
    </main>
  );
}
