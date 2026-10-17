"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ListenButton,
  LiveBadge,
  NowPlaying,
  ProgramLog,
  StationHeader,
  VolumeControl,
} from "@/components/player/BroadcastUi";
import { ProgramSchedule, TrackTimeline } from "@/components/ProgramSchedule";
import { SongRequestPanel } from "@/components/player/SongRequestPanel";
import { useRadio } from "@/components/RadioProvider";
import type { StationConfig } from "@/lib/types";

function StationClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const timer = setInterval(() => setNow(new Date()), 5_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  if (!now) return null;
  return (
    <span className="hidden font-[family-name:var(--font-mono)] text-sm tabular-nums text-[var(--ink-muted)] sm:inline">
      {now.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

function Ticker({
  live,
  items,
}: {
  live: boolean;
  items: string[];
}) {
  if (!items.length) return null;
  const run = (
    <span className="flex shrink-0 items-center">
      {items.map((text, i) => (
        <span key={i} className="flex items-center">
          <span className="px-6">{text}</span>
          <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-[var(--ink)]/60" />
        </span>
      ))}
    </span>
  );
  return (
    <div className="ticker flex h-8 items-center overflow-hidden bg-[var(--accent)] text-[var(--ink)]">
      <span className="z-10 flex h-full shrink-0 items-center gap-2 bg-[var(--bg-deep)] px-4 font-[family-name:var(--font-display)] text-xs font-semibold uppercase tracking-[0.2em]">
        <span
          className={`h-2 w-2 rounded-full ${live ? "bg-[var(--accent)]" : "bg-[var(--ink-faint)]"}`}
        />
        {live ? "Živě" : "Off air"}
      </span>
      <div className="min-w-0 flex-1 overflow-hidden" aria-live="off">
        <div className="ticker-track font-[family-name:var(--font-display)] text-sm font-semibold uppercase tracking-wider">
          {run}
          <span aria-hidden className="flex">{run}</span>
        </div>
      </div>
    </div>
  );
}

export function PlayerClient({ station }: { station: StationConfig }) {
  const {
    playing,
    nowPlaying,
    trackStartedAt,
    recentlyPlayed,
    schedule,
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
    quality,
    setQuality,
    streamLabel,
    aacAvailable,
    micLive,
    segment,
  } = useRadio();
  // Pauza na mluvené slovo — hraje jen podkres.
  const onBreak = segment === "talk";
  const [copied, setCopied] = useState(false);

  const onAir = broadcasting && stationOnline;
  const tuning = connection === "connecting" || connection === "reconnecting";
  const history = recentlyPlayed
    .filter((t) => t.uuid !== nowPlaying?.uuid)
    .slice(0, 10);

  const placeholder = !stationOnline
    ? "Stanice teď nevysílá"
    : broadcasting
      ? "Ladíme…"
      : "Za chvíli začínáme";

  const statusLine = (() => {
    if (!stationOnline) return "Zkusíme to znovu sami, nemusíš nic dělat.";
    if (tuning) return "Připojuji…";
    if (playing) return "Posloucháš živé vysílání.";
    return null;
  })();

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl || window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // schránka nedostupná
    }
  }

  const nextTrack = schedule.find((t) => t.kind !== "stinger");
  const tickerItems = [
    micLive ? "Ve studiu mluví moderátor" : null,
    onBreak ? "Krátká přestávka — za chvíli zase hudba" : null,
    nowPlaying ? `Právě hraje: ${nowPlaying.artist} — ${nowPlaying.title}` : null,
    nextTrack ? `Další: ${nextTrack.artist} — ${nextTrack.title}` : null,
    `${station.name} · ${station.tagline}`,
    "Přej si písničku dole na stránce",
  ].filter((t): t is string => Boolean(t));

  return (
    <div className="flex min-h-screen flex-col">
      <Ticker live={onAir} items={tickerItems} />
      <header className="border-b border-[var(--line)]">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
          <StationHeader config={station} compact />
          <div className="flex shrink-0 items-center gap-4">
            <StationClock />
            <LiveBadge live={onAir} listeners={listeners} />
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-12 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:gap-24 lg:py-14">
        <section className="animate-fade-up mx-auto w-full max-w-[460px] hero-sticky lg:mx-0 lg:self-start">
          {micLive ? (
            <p className="mb-4 flex items-center gap-2 font-[family-name:var(--font-display)] text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              <span className="live-mic h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
              Moderátor ve vysílání
            </p>
          ) : null}
          <NowPlaying
            track={onBreak ? null : nowPlaying}
            placeholder={onBreak ? "Mluvené slovo" : placeholder}
            playing={playing && connection === "live"}
          />

          <div className="mt-6">
            <TrackTimeline
              trackId={nowPlaying?.uuid ?? null}
              trackStartedAt={trackStartedAt}
              durationSec={nowPlaying?.durationSec ?? null}
              active={Boolean(nowPlaying && broadcasting && !onBreak)}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <ListenButton playing={playing} busy={playing && tuning} onToggle={toggle} />
            <VolumeControl
              volume={volume}
              onChange={setVolume}
              onToggleMute={() => setVolume(volume > 0 ? 0 : readLastVolume())}
            />
          </div>

          {error ? (
            <p className="mt-4 text-sm text-[var(--danger)]" role="alert">
              {error}{" "}
              <button
                type="button"
                onClick={reconnect}
                className="underline underline-offset-2 hover:text-[var(--ink)]"
              >
                Připojit znovu
              </button>
            </p>
          ) : statusLine ? (
            <p className="mt-4 text-sm text-[var(--ink-muted)]" aria-live="polite">
              {statusLine}
            </p>
          ) : null}

          {aacAvailable ? (
            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--ink-muted)]">
              <span>Kvalita</span>
              <div className="flex overflow-hidden rounded-full border border-[var(--line-strong)]" role="radiogroup" aria-label="Kvalita streamu">
                {(
                  [
                    ["auto", "Auto"],
                    ["high", "Vysoká"],
                    ["low", "Úsporná"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={quality === value}
                    onClick={() => setQuality(value)}
                    className={`px-3 py-1 transition-colors ${
                      quality === value
                        ? "bg-[var(--ink)] text-[var(--bg-deep)]"
                        : "hover:text-[var(--ink)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {streamLabel ? (
                <span className="font-[family-name:var(--font-mono)] text-[var(--ink-faint)]">
                  {streamLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="animate-fade-up min-w-0 space-y-12">
          <ProgramSchedule tracks={schedule} title="Na řadě" />
          <ProgramLog title="Hrálo" tracks={history.slice(0, 8)} />
          <SongRequestPanel />
        </div>
      </main>

      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-[var(--ink-muted)] sm:px-8">
          <span>
            {station.name} · {station.tagline}
          </span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => void copyShareUrl()}
              className="transition-colors hover:text-[var(--ink)]"
            >
              {copied ? "Odkaz zkopírován" : "Sdílet odkaz"}
            </button>
            <Link href="/studio" className="transition-colors hover:text-[var(--ink)]">
              Studio
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function readLastVolume(): number {
  if (typeof window === "undefined") return 0.85;
  const raw = localStorage.getItem("ai-radio-volume");
  const n = raw ? Number(raw) : 0.85;
  return Number.isFinite(n) && n > 0 ? n : 0.85;
}
