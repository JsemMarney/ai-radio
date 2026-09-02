"use client";

import Link from "next/link";
import { useState } from "react";
import {
  LiveBadge,
  NowPlayingHero,
  PlayControl,
  ProgramLog,
  StationHeader,
  VolumeControl,
} from "@/components/player/BroadcastUi";
import { NextUpBanner, ProgramSchedule, TrackTimeline } from "@/components/ProgramSchedule";
import { SongRequestPanel } from "@/components/player/SongRequestPanel";
import { useRadio } from "@/components/RadioProvider";
import type { StationConfig } from "@/lib/types";

export function PlayerClient({ station }: { station: StationConfig }) {
  const {
    playing,
    nowPlaying,
    trackStartedAt,
    recentlyPlayed,
    schedule,
    nextUp,
    segment,
    crossfadeSec,
    listeners,
    broadcasting,
    stationOnline,
    shareUrl,
    connection,
    error,
    toggle,
    reconnect,
    volume,
    setVolume,
    statusReady,
    queueRemaining,
  } = useRadio();
  const [copied, setCopied] = useState(false);

  const recentList = recentlyPlayed.filter((t) => t.uuid !== nowPlaying?.uuid);
  const durationSec = nowPlaying?.durationSec ?? null;
  const onAir = (broadcasting || playing) && stationOnline;

  async function copyShareUrl() {
    try {
      const url = shareUrl || (typeof window !== "undefined" ? window.location.href : "/player");
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  const statusHint = (() => {
    if (!stationOnline) return "Stanice je momentálně offline.";
    if (connection === "connecting" || connection === "reconnecting") {
      return "Připojuji se ke streamu…";
    }
    if (!nowPlaying && broadcasting) return "Načítám program…";
    return null;
  })();

  return (
    <main className="broadcast-grain relative mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-6 pb-14 sm:px-6 sm:py-10">
      <header className="animate-fade-up mb-6 flex items-center justify-between gap-4">
        <StationHeader config={station} compact />
        <Link
          href="/studio"
          className="shrink-0 rounded-lg bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
        >
          Studio
        </Link>
      </header>

      <div className="animate-fade-up mb-5 flex flex-wrap items-center justify-between gap-3">
        <LiveBadge live={onAir} listeners={listeners} />
        <div className="flex items-center gap-3 text-xs text-[var(--ink-muted)]">
          {queueRemaining > 0 ? <span>{queueRemaining} ve frontě</span> : null}
          {connection === "connecting" || connection === "reconnecting" ? (
            <span className="text-[var(--accent-soft)]">Buffer…</span>
          ) : playing && connection === "live" ? (
            <span className="text-[var(--ok)]">Stream OK</span>
          ) : null}
        </div>
      </div>

      <div className="animate-fade-up mb-4" style={{ animationDelay: "30ms" }}>
        <NextUpBanner next={nextUp} />
      </div>

      <div className="animate-fade-up mb-6" style={{ animationDelay: "40ms" }}>
        <NowPlayingHero
          thumbnail={nowPlaying?.thumbnail ?? null}
          title={nowPlaying?.title ?? "Čekám na signál…"}
          artist={nowPlaying?.artist ?? (statusHint ?? "Klikni play pro poslech")}
          album={nowPlaying?.album}
          year={nowPlaying?.year}
          playing={playing && connection === "live"}
        />
      </div>

      <div
        className="animate-fade-up mb-6 px-1"
        style={{ animationDelay: "80ms" }}
        aria-live="polite"
      >
        <TrackTimeline
          trackId={nowPlaying?.uuid ?? null}
          trackStartedAt={trackStartedAt}
          durationSec={durationSec}
          crossfadeSec={crossfadeSec}
          segment={segment}
          active={Boolean(nowPlaying && broadcasting)}
        />
      </div>

      <div
        className="animate-fade-up mb-8 flex flex-col items-center gap-4"
        style={{ animationDelay: "120ms" }}
      >
        <div className="flex items-center gap-4">
          <PlayControl playing={playing} onToggle={toggle} />
          {(error || connection === "reconnecting" || !stationOnline) && (
            <button
              type="button"
              onClick={reconnect}
              className="rounded-xl bg-[var(--bg-elevated)] px-4 py-2.5 text-sm text-[var(--ink)] transition hover:bg-[var(--bg-panel)]"
            >
              Připojit znovu
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
          className="animate-fade-up mb-6 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/8 px-4 py-3 text-center text-sm text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="animate-fade-up space-y-8" style={{ animationDelay: "160ms" }}>
        <ProgramSchedule tracks={schedule} title="Program — odhad" />
        <SongRequestPanel />
        <ProgramLog title="Historie skladeb" tracks={recentList} variant="recent" />
      </div>

      <section
        className="animate-fade-up mt-10 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/60 p-5"
        style={{ animationDelay: "200ms" }}
      >
        <h2 className="text-sm font-medium text-[var(--ink-muted)]">Sdílet stanici</h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]/80">
          Pošli odkaz na přehrávač — stream je chráněný a nejde sdílet natvrdo.
        </p>
        <code className="mt-3 block truncate rounded-lg bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--accent-soft)]">
          {shareUrl || "/player"}
        </code>
        <button
          type="button"
          onClick={() => void copyShareUrl()}
          className="mt-3 rounded-lg bg-[var(--bg-elevated)] px-4 py-2 text-xs text-[var(--ink)] transition hover:bg-[var(--bg-panel)]"
        >
          {copied ? "Zkopírováno ✓" : "Kopírovat odkaz"}
        </button>
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
