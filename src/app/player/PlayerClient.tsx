"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BroadcastMonitor,
  OnAirLamp,
  PlayControl,
  ProgramLog,
  StationHeader,
  VolumeControl,
} from "@/components/player/BroadcastUi";
import { TrackTimeline } from "@/components/TrackTimeline";
import { useRadio } from "@/components/RadioProvider";
import type { StationConfig } from "@/lib/types";

export function PlayerClient({ station }: { station: StationConfig }) {
  const {
    playing,
    nowPlaying,
    trackStartedAt,
    recentlyPlayed,
    upcoming,
    listeners,
    broadcasting,
    stationOnline,
    streamUrl,
    connection,
    error,
    toggle,
    reconnect,
    volume,
    setVolume,
    play,
    statusReady,
  } = useRadio();
  const [copied, setCopied] = useState(false);

  const recentList = recentlyPlayed.filter((t) => t.uuid !== nowPlaying?.uuid);
  const durationSec = nowPlaying?.durationSec ?? null;
  const onAir = (broadcasting || playing) && stationOnline;

  useEffect(() => {
    if (!statusReady) return;
    const timer = setTimeout(() => play(), 600);
    return () => clearTimeout(timer);
  }, [statusReady, play]);

  async function copyStreamUrl() {
    try {
      await navigator.clipboard.writeText(streamUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&bgcolor=0a0e0c&color=d4a24c&margin=8&data=${encodeURIComponent(streamUrl)}`;

  const signalLabel = (() => {
    if (!stationOnline) return "Stanice offline";
    if (connection === "connecting" || connection === "reconnecting") {
      return "Bufferuji signál…";
    }
    if (!nowPlaying && broadcasting) return "Načítám program…";
    if (nowPlaying) return nowPlaying.artist;
    return "Klikni pro poslech";
  })();

  return (
    <main className="broadcast-grain relative mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-8 pb-12">
      <header className="animate-fade-up mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <StationHeader config={station} size="lg" />
        </div>
        <Link
          href="/studio"
          className="shrink-0 rounded border border-[var(--line)] px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10px] tracking-wide text-[var(--ink-muted)] transition hover:border-[var(--accent)]/30 hover:text-[var(--accent-soft)]"
        >
          Studio
        </Link>
      </header>

      <div className="animate-fade-up mb-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <OnAirLamp live={onAir} />
        <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-muted)]">
          {listeners}{" "}
          {listeners === 1 ? "posluchač" : listeners < 5 ? "posluchači" : "posluchačů"}
        </span>
        {connection === "connecting" || connection === "reconnecting" ? (
          <span
            className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--accent-soft)]"
            style={{ animation: "signal-pulse 1.2s ease-in-out infinite" }}
          >
            ◆ BUFFER
          </span>
        ) : playing && connection === "live" ? (
          <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ok)]">
            ◆ LIVE
          </span>
        ) : null}
      </div>

      <div className="animate-fade-up mb-6 w-full" style={{ animationDelay: "60ms" }}>
        <BroadcastMonitor
          thumbnail={nowPlaying?.thumbnail ?? null}
          title={nowPlaying?.title ?? "—"}
          playing={playing && connection === "live"}
        />
      </div>

      <div
        className="animate-fade-up mb-6 w-full text-center"
        style={{ animationDelay: "100ms" }}
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.25em] text-[var(--accent-soft)] uppercase">
          Právě hraje
        </p>
        <h2 className="mt-1 truncate font-[family-name:var(--font-display)] text-2xl uppercase tracking-wide text-[var(--ink)]">
          {nowPlaying?.title ?? "Čekám na signál…"}
        </h2>
        <p className="mt-1 truncate text-sm text-[var(--ink-muted)]">{signalLabel}</p>
        {nowPlaying?.album ? (
          <p className="mt-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
            {nowPlaying.year ? `${nowPlaying.year} · ` : ""}
            {nowPlaying.album}
          </p>
        ) : null}
        <TrackTimeline
          trackId={nowPlaying?.uuid ?? null}
          trackStartedAt={trackStartedAt}
          durationSec={durationSec}
          active={Boolean(nowPlaying && broadcasting)}
        />
      </div>

      <div
        className="animate-fade-up mb-8 flex flex-col items-center gap-5"
        style={{ animationDelay: "140ms" }}
      >
        <div className="flex items-center gap-4">
          <PlayControl playing={playing} onToggle={toggle} />
          {(error || connection === "reconnecting" || !stationOnline) && (
            <button
              type="button"
              onClick={reconnect}
              className="rounded-lg border border-[var(--line)] px-4 py-2 font-[family-name:var(--font-mono)] text-xs text-[var(--ink)] transition hover:border-[var(--accent)]/40"
            >
              Připojit
            </button>
          )}
        </div>
        <VolumeControl
          volume={volume}
          onChange={setVolume}
          onToggleMute={() => setVolume(volume > 0 ? 0 : readLastVolume())}
        />
      </div>

      {error ? (
        <p
          className="animate-fade-up mb-6 w-full rounded-lg border border-[var(--danger)]/25 bg-[var(--danger)]/8 px-4 py-3 text-center font-[family-name:var(--font-mono)] text-xs text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="animate-fade-up space-y-6" style={{ animationDelay: "180ms" }}>
        <ProgramLog title="Program — bude hrát" tracks={upcoming} variant="upcoming" />
        <ProgramLog title="Program — nedávno" tracks={recentList} variant="recent" />
      </div>

      <section
        className="animate-fade-up mt-8 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)]/50 p-4"
        style={{ animationDelay: "220ms" }}
      >
        <h2 className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.2em] text-[var(--ink-muted)] uppercase">
          Nalaď se
        </h2>
        <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrUrl}
            alt="QR kód streamu"
            className="h-24 w-24 rounded border border-[var(--line)]"
          />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <code className="block truncate font-[family-name:var(--font-mono)] text-xs text-[var(--accent-soft)]">
              {streamUrl}
            </code>
            <p className="mt-2 text-xs leading-relaxed text-[var(--ink-muted)]">
              Živý signál — vstoupíš do aktuálního vysílání. Bez přetáčení, jako rádio.
            </p>
            <button
              type="button"
              onClick={() => void copyStreamUrl()}
              className="mt-3 rounded border border-[var(--line)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink)] transition hover:border-[var(--accent)]/40"
            >
              {copied ? "Zkopírováno" : "Kopírovat URL"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function readLastVolume(): number {
  if (typeof window === "undefined") return 0.85;
  const raw = localStorage.getItem("ai-radio-volume");
  const n = raw ? Number(raw) : 0.85;
  return Number.isFinite(n) && n > 0 ? n : 0.85;
}
