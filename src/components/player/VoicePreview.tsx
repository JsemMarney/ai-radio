"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Přehrávač hlasovky ve stylu stanice — místo systémového <audio controls>. */
export function VoicePreview({
  src,
  durationSec,
  preload = "metadata",
}: {
  src: string;
  /** Známá délka (webm z MediaRecorderu ji v hlavičce často nemá). */
  durationSec?: number;
  preload?: "none" | "metadata";
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationSec ?? 0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlay);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlay);
    };
  }, [src]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }

  function seek(e: MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrent(el.currentTime);
  }

  const pct = duration ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full bg-[var(--bg-deep)] py-1.5 pl-1.5 pr-4">
      <audio ref={audioRef} src={src} preload={preload} className="hidden" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pozastavit hlasovku" : "Přehrát hlasovku"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)]"
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5.5v13l11-6.5L8 5.5z" />
          </svg>
        )}
      </button>
      <div
        className="relative h-1.5 min-w-0 flex-1 cursor-pointer rounded-full bg-[var(--line-strong)]"
        onClick={seek}
        role="presentation"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-[var(--ink-muted)]">
        {clock(playing || current ? current : duration)}
      </span>
    </div>
  );
}
