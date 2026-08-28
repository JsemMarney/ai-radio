"use client";

import Link from "next/link";
import { useRadio } from "@/components/RadioProvider";

export function MiniPlayer() {
  const { playing, nowPlaying, toggle, volume, setVolume } = useRadio();

  if (!nowPlaying && !playing) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--line)] bg-[var(--bg-panel)]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[var(--bg-deep)]">
          {nowPlaying?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={nowPlaying.thumbnail}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--ink)]">
            {nowPlaying?.title ?? "Rádio"}
          </p>
          <p className="truncate text-xs text-[var(--accent-soft)]">
            {nowPlaying?.artist ?? "—"}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--bg-deep)]"
        >
          {playing ? "Pauza" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="hidden h-1 w-20 cursor-pointer appearance-none rounded-full bg-[var(--line)] accent-[var(--accent)] sm:block"
          aria-label="Hlasitost"
        />
        <Link
          href="/player"
          className="text-xs text-[var(--ink-muted)] hover:text-[var(--accent-soft)]"
        >
          Player
        </Link>
      </div>
    </div>
  );
}
