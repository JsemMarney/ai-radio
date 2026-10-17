"use client";

import { useEffect, useState } from "react";
import { formatClock } from "@/lib/program-schedule";
import type { ScheduledTrack } from "@/lib/types";
import { formatLength, formatTime, LogRow } from "@/components/player/BroadcastUi";

type TrackTimelineProps = {
  trackId: string | null;
  trackStartedAt: string | null;
  durationSec: number | null;
  active?: boolean;
};

export function TrackTimeline({
  trackId,
  trackStartedAt,
  durationSec,
  active = true,
}: TrackTimelineProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active, trackId]);

  const startedMs = trackStartedAt ? Date.parse(trackStartedAt) : NaN;
  const elapsed = Number.isFinite(startedMs) ? Math.max(0, (now - startedMs) / 1000) : 0;

  const known = active && Boolean(trackStartedAt) && Boolean(durationSec);
  const total = durationSec ?? 0;
  const played = known ? Math.min(elapsed, total) : 0;
  const pct = known ? Math.min(100, (played / total) * 100) : 0;

  return (
    <div>
      <div
        className="dial relative h-5 border-b border-[var(--line-strong)]"
        role="progressbar"
        aria-label="Průběh skladby"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className="absolute inset-y-0 left-0 bg-[var(--accent)]/15"
          style={{ width: `${pct}%` }}
        />
        <div
          className="dial-needle absolute -bottom-px -top-1 w-[2px] bg-[var(--accent)]"
          style={{ left: `calc(${pct}% - 1px)` }}
        />
      </div>
      <div className="mt-2 flex justify-between font-[family-name:var(--font-mono)] text-xs tabular-nums text-[var(--ink-muted)]">
        <span>{known ? formatClock(played) : "–:––"}</span>
        <span>{known ? `−${formatClock(total - played)}` : "–:––"}</span>
      </div>
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
  if (!tracks.length) return null;

  return (
    <section>
      <h2 className="label mb-2">{title}</h2>
      <ul>
        {tracks.map((track, index) =>
          track.kind === "stinger" ? (
            <li
              key={track.uuid}
              className="flex items-center gap-3 border-t border-[var(--line)] py-1.5 text-xs text-[var(--ink-faint)] first:border-t-0"
            >
              <span className="w-11 shrink-0 font-[family-name:var(--font-mono)] tabular-nums">
                {formatTime(track.startsAtMs)}
              </span>
              <span className="uppercase tracking-widest">jingle</span>
            </li>
          ) : (
            <LogRow
              key={track.uuid}
              time={formatTime(track.startsAtMs)}
              track={track}
              highlight={index === 0}
              aside={
                <span className="flex shrink-0 items-center gap-3">
                  {index === 0 ? (
                    <span className="font-[family-name:var(--font-display)] text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                      Další
                    </span>
                  ) : null}
                  <span className="font-[family-name:var(--font-mono)] text-xs tabular-nums text-[var(--ink-faint)]">
                    {formatLength(track.durationSec)}
                  </span>
                </span>
              }
            />
          ),
        )}
      </ul>
    </section>
  );
}
