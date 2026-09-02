"use client";

import { useEffect, useState } from "react";
import { formatClock, formatStartsIn } from "@/lib/program-schedule";
import type { PlaybackSegment, ScheduledTrack } from "@/lib/types";

function formatClockLocal(seconds: number): string {
  return formatClock(seconds);
}

type TrackTimelineProps = {
  trackId: string | null;
  trackStartedAt: string | null;
  durationSec: number | null;
  crossfadeSec?: number;
  segment?: PlaybackSegment;
  active?: boolean;
};

export function TrackTimeline({
  trackId,
  trackStartedAt,
  durationSec,
  crossfadeSec = 6,
  segment = "song",
  active = true,
}: TrackTimelineProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
  }, [trackId, trackStartedAt]);

  useEffect(() => {
    if (!active || !trackStartedAt) {
      setElapsed(0);
      return;
    }

    const startedMs = Date.parse(trackStartedAt);
    if (!Number.isFinite(startedMs)) {
      setElapsed(0);
      return;
    }

    const tick = () => {
      setElapsed(Math.max(0, (Date.now() - startedMs) / 1000));
    };

    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [active, trackStartedAt]);

  if (!active || !trackStartedAt || !durationSec || durationSec <= 0) {
    return (
      <div>
        <div className="timeline-track h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div className="h-full w-0 bg-[var(--accent)]/30" />
        </div>
      </div>
    );
  }

  const played = Math.min(elapsed, durationSec);
  const remaining = Math.max(0, durationSec - played);
  const pct = Math.min(100, (played / durationSec) * 100);
  const fadePct = Math.min(
    100,
    Math.max(0, ((durationSec - crossfadeSec) / durationSec) * 100),
  );

  const segmentLabel =
    segment === "crossfade"
      ? "Crossfade"
      : segment === "stinger"
        ? "Midsong"
        : null;

  return (
    <div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
        <div
          className="timeline-crossfade-zone pointer-events-none absolute inset-y-0 right-0"
          style={{ width: `${100 - fadePct}%` }}
          aria-hidden
        />
        <div
          className={`timeline-progress h-full rounded-full transition-[width] duration-500 ease-linear ${
            segment === "crossfade" ? "is-crossfade" : segment === "stinger" ? "is-stinger" : ""
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs tabular-nums text-[var(--ink-muted)]">
        <span>
          {formatClockLocal(played)} / {formatClockLocal(durationSec)}
        </span>
        <span className="flex items-center gap-2">
          {segmentLabel ? (
            <span className="rounded-md bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-soft)]">
              {segmentLabel}
            </span>
          ) : null}
          <span>−{formatClockLocal(remaining)}</span>
        </span>
      </div>
    </div>
  );
}

export function NextUpBanner({ next }: { next: ScheduledTrack | null }) {
  const [startsIn, setStartsIn] = useState(next?.startsInSec ?? 0);

  useEffect(() => {
    if (!next) {
      setStartsIn(0);
      return;
    }
    setStartsIn(next.startsInSec);
    const anchor = Date.now();
    const base = next.startsInSec;
    const timer = setInterval(() => {
      const drift = Math.floor((Date.now() - anchor) / 1000);
      setStartsIn(Math.max(0, base - drift));
    }, 1000);
    return () => clearInterval(timer);
  }, [next?.uuid, next?.startsInSec]);

  if (!next) return null;

  return (
    <div className="next-up-banner rounded-xl border border-[var(--line)] bg-[var(--bg-panel)]/80 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--accent-soft)]">
        {next.kind === "stinger" ? "Midsong" : "Další skladba"} · {formatStartsIn(startsIn)}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-[var(--ink)]">{next.title}</p>
      <p className="truncate text-xs text-[var(--ink-muted)]">{next.artist}</p>
    </div>
  );
}

export function ProgramSchedule({
  tracks,
  title,
}: {
  tracks: ScheduledTrack[];
  title: string;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!tracks.length) return null;

  return (
    <section className="w-full">
      <h2 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">{title}</h2>
      <ul className="space-y-1">
        {tracks.map((track, index) => {
          const startsIn = Math.max(
            0,
            Math.round((track.startsAtMs - now) / 1000),
          );
          const isStinger = track.kind === "stinger";
          const isNext = index === 0;
          return (
            <li
              key={track.uuid}
              className={`program-log-row flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                isNext ? "is-next" : isStinger ? "opacity-90" : ""
              }`}
            >
              <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-[var(--ink-muted)]">
                {isNext
                  ? formatStartsIn(startsIn)
                  : new Date(track.startsAtMs).toLocaleTimeString("cs-CZ", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
              </span>
              {isStinger ? (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/15 text-sm text-[var(--accent-soft)]">
                  ⚡
                </span>
              ) : track.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={track.thumbnail}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-sm text-[var(--ink-muted)]">
                  ♪
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--ink)]">
                  {track.title}
                </p>
                <p className="truncate text-xs text-[var(--ink-muted)]">
                  {isStinger ? "Mezi skladbami" : track.artist}
                </p>
              </div>
              {isStinger ? (
                <span className="shrink-0 rounded-md bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-soft)]">
                  MID
                </span>
              ) : isNext ? (
                <span className="shrink-0 rounded-md bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-soft)]">
                  Další
                </span>
              ) : (
                <span className="shrink-0 text-[10px] tabular-nums text-[var(--ink-muted)]">
                  #{track.position}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
