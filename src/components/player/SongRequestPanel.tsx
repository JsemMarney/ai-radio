"use client";

import { useCallback, useEffect, useState } from "react";
import type { RadioNowPlaying } from "@/lib/types";

export function SongRequestPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<RadioNowPlaying[]>([]);
  const [pending, setPending] = useState(0);
  const [busyUuid, setBusyUuid] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (search = query) => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/radio/requests?${params}`, { cache: "no-store" });
      const data = (await res.json()) as {
        enabled?: boolean;
        tracks?: RadioNowPlaying[];
        pending?: number;
      };
      setEnabled(Boolean(data.enabled));
      setTracks(data.tracks ?? []);
      setPending(data.pending ?? 0);
    } catch {
      setEnabled(false);
    }
  }, [query]);

  useEffect(() => {
    void load("");
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => void load(query), 300);
    return () => clearTimeout(timer);
  }, [query, load]);

  if (enabled === false) return null;

  async function requestTrack(uuid: string) {
    setBusyUuid(uuid);
    setMessage(null);
    try {
      const res = await fetch("/api/radio/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        position?: number;
      };
      if (data.ok) {
        setMessage(
          data.position
            ? `Přidáno do fronty requestů (#${data.position}).`
            : "Přidáno do fronty requestů.",
        );
        void load(query);
      } else {
        setMessage(data.error ?? "Request selhal.");
      }
    } catch {
      setMessage("Request selhal — stanice offline?");
    } finally {
      setBusyUuid(null);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-[var(--ink-muted)]">
          Request skladby
        </h2>
        {pending > 0 ? (
          <span className="text-[10px] text-[var(--accent-soft)]">
            {pending} ve frontě
          </span>
        ) : null}
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Hledat interpreta nebo název…"
        className="mb-3 w-full rounded-xl border border-[var(--line)] bg-[var(--bg-deep)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)]"
      />
      {message ? (
        <p className="mb-3 text-xs text-[var(--accent-soft)]">{message}</p>
      ) : null}
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {tracks.length ? (
          tracks.map((track) => (
            <li
              key={track.uuid}
              className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[var(--bg-elevated)]/60"
            >
              {track.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={track.thumbnail}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-xs">
                  ♪
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--ink)]">
                  {track.title}
                </p>
                <p className="truncate text-xs text-[var(--ink-muted)]">
                  {track.artist}
                </p>
              </div>
              <button
                type="button"
                disabled={busyUuid === track.uuid}
                onClick={() => void requestTrack(track.uuid)}
                className="shrink-0 rounded-lg bg-[var(--accent)]/15 px-2.5 py-1 text-[10px] font-medium text-[var(--accent-soft)] disabled:opacity-50"
              >
                {busyUuid === track.uuid ? "…" : "Request"}
              </button>
            </li>
          ))
        ) : (
          <li className="py-4 text-center text-xs text-[var(--ink-muted)]">
            {enabled === null ? "Načítám…" : "Nic nenalezeno."}
          </li>
        )}
      </ul>
    </section>
  );
}
