"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { MiniPlayer } from "@/components/MiniPlayer";
import { OnAirBadge } from "@/components/StationBranding";
import { useRadio } from "@/components/RadioProvider";
import type { ImportJob, LibraryTrack } from "@/lib/types";

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function StudioPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [library, setLibrary] = useState<LibraryTrack[]>([]);
  const [search, setSearch] = useState("");

  const {
    playing,
    nowPlaying,
    broadcasting,
    queueRemaining,
    toggle,
    reconnect,
  } = useRadio();

  const loadLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/library");
      const data = (await res.json()) as { tracks?: LibraryTrack[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Nelze načíst knihovnu.");
      setLibrary(data.tracks ?? []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`);
        const data = (await res.json()) as { job?: ImportJob; error?: string };
        if (!res.ok || !data.job) return;
        setJob(data.job);
        if (data.job.status === "done" || data.job.status === "failed") {
          void loadLibrary();
        }
      } catch {
        // ignore
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [job, loadLibrary]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setJob(null);
    setLoading(true);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import selhal.");

      if (data.type === "track") {
        await loadLibrary();
      } else if (data.type === "playlist") {
        setJob(data.job as ImportJob);
      }
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Něco se pokazilo.");
    } finally {
      setLoading(false);
    }
  }

  async function skipTrack() {
    await fetch("/api/radio/skip", { method: "POST" });
    reconnect();
  }

  async function playOnRadio(track: LibraryTrack) {
    if (
      !confirm(
        `Pustit „${track.title}" pro všechny posluchače? Změní to živý stream.`,
      )
    ) {
      return;
    }

    await fetch("/api/radio/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: track.uuid }),
    });
    reconnect();
  }

  async function deleteTrack(track: LibraryTrack) {
    if (!confirm(`Smazat „${track.title}" z knihovny?`)) return;
    const res = await fetch(`/api/library/${track.uuid}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      alert(data.error || "Smazání selhalo.");
      return;
    }
    void loadLibrary();
  }

  async function logout() {
    await fetch("/api/studio/logout", { method: "POST" });
    window.location.href = "/player";
  }

  const jobProgress = useMemo(() => {
    if (!job) return null;
    const pct = job.total ? Math.round((job.completed / job.total) * 100) : 0;
    return { pct, label: `${job.completed}/${job.total}` };
  }, [job]);

  const filteredLibrary = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        (t.album?.toLowerCase().includes(q) ?? false),
    );
  }, [library, search]);

  return (
    <>
      <main className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-5 py-10 pb-28 sm:py-14">
        <header className="animate-fade-up flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.28em] text-[var(--accent)] uppercase">
              Studio
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--ink)]">
              Správa stanice
            </h1>
            <p className="mt-3 max-w-xl text-sm text-[var(--ink-muted)]">
              Importuj skladby, ovládej živý stream. Posluchači jsou na{" "}
              <Link href="/player" className="text-[var(--accent-soft)]">
                /player
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OnAirBadge live={broadcasting} />
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-muted)]"
            >
              Odhlásit
            </button>
          </div>
        </header>

        <section className="animate-fade-up rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 p-5">
          <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl">
            Živý stream
          </h2>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-[var(--bg-deep)]">
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
              <p className="truncate text-lg font-medium">
                {nowPlaying?.title ?? "Nic nehraje"}
              </p>
              <p className="truncate text-sm text-[var(--accent-soft)]">
                {nowPlaying?.artist ?? "—"}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Ve frontě: {queueRemaining} skladeb
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={toggle}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)]"
              >
                {playing ? "Pauza" : "Play"}
              </button>
              <button
                type="button"
                onClick={() => void skipTrack()}
                className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm"
              >
                Další
              </button>
            </div>
          </div>
        </section>

        <section className="animate-fade-up">
          <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl">
            Import ze Spotify
          </h2>
          <form
            onSubmit={onSubmit}
            className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="url"
                required
                placeholder="https://open.spotify.com/track/... nebo playlist"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading || job?.status === "running"}
                className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--bg-deep)]/70 px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="submit"
                disabled={loading || !url.trim() || job?.status === "running"}
                className="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-50"
              >
                {loading ? "Stahuju…" : "Stáhnout"}
              </button>
            </div>
          </form>

          {error && (
            <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}

          {job && (
            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/70 p-4">
              <p className="font-medium">{job.title}</p>
              <p className="text-sm text-[var(--ink-muted)]">
                {jobProgress?.label} · {job.status}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-deep)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{ width: `${jobProgress?.pct ?? 0}%` }}
                />
              </div>
              {job.items.length > 0 && (
                <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto text-xs">
                  {job.items.map((item, i) => (
                    <li
                      key={`${item.title}-${i}`}
                      className={
                        item.status === "failed"
                          ? "text-[var(--danger)]"
                          : "text-[var(--ink-muted)]"
                      }
                    >
                      {item.title} — {item.artist} ({item.status})
                      {item.error ? `: ${item.error}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="animate-fade-up pb-6">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-[family-name:var(--font-display)] text-xl">
              Knihovna
            </h2>
            <p className="text-sm text-[var(--ink-muted)]">
              {library.length} skladeb
            </p>
          </div>

          <input
            type="search"
            placeholder="Hledat…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4 w-full rounded-xl border border-[var(--line)] bg-[var(--bg-deep)]/70 px-4 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />

          {!filteredLibrary.length ? (
            <p className="rounded-2xl border border-dashed border-[var(--line)] px-5 py-10 text-center text-sm text-[var(--ink-muted)]">
              {library.length ? "Žádné výsledky." : "Zatím nic — importuj výše."}
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {filteredLibrary.map((track) => (
                <li
                  key={track.uuid}
                  className={`flex gap-3 rounded-2xl border p-3 ${
                    nowPlaying?.uuid === track.uuid
                      ? "border-[var(--accent)]/50 bg-[var(--bg-panel)]"
                      : "border-[var(--line)] bg-[var(--bg-panel)]/60"
                  }`}
                >
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[var(--bg-deep)]">
                    {track.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={track.thumbnail}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{track.title}</p>
                    <p className="truncate text-sm text-[var(--accent-soft)]">
                      {track.artist}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                      {formatDuration(track.duration)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs"
                        onClick={() => void playOnRadio(track)}
                      >
                        Do rádií
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--danger)]/30 px-2 py-1 text-xs text-[var(--danger)]"
                        onClick={() => void deleteTrack(track)}
                      >
                        Smazat
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <MiniPlayer />
    </>
  );
}
