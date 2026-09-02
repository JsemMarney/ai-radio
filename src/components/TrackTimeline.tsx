"use client";

import { useEffect, useState } from "react";

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

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
        <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div className="h-full w-0 bg-[var(--accent)]/30" />
        </div>
      </div>
    );
  }

  const played = Math.min(elapsed, durationSec);
  const remaining = Math.max(0, durationSec - played);
  const pct = Math.min(100, (played / durationSec) * 100);

  return (
    <div>
      <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs tabular-nums text-[var(--ink-muted)]">
        <span>
          {formatClock(played)} / {formatClock(durationSec)}
        </span>
        <span>−{formatClock(remaining)}</span>
      </div>
    </div>
  );
}
