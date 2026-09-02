"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MiniPlayer } from "@/components/MiniPlayer";
import { OnAirBadge } from "@/components/StationBranding";
import { TrackTimeline } from "@/components/TrackTimeline";
import { useRadio } from "@/components/RadioProvider";
import type {
  ImportJob,
  LibraryTrack,
  QueuePreview,
  RadioNowPlaying,
  RemasterJob,
  StudioHealth,
} from "@/lib/types";

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function importJobStatusLabel(status: ImportJob["status"]): string {
  switch (status) {
    case "queued":
      return "Ve frontě";
    case "running":
      return "Probíhá";
    case "done":
      return "Hotovo";
    case "failed":
      return "Selhalo";
    default:
      return status;
  }
}

function importItemStatusLabel(item: ImportJob["items"][number]): string {
  if (item.detail) return item.detail;
  switch (item.status) {
    case "pending":
      return "Čeká";
    case "downloading":
      return "Stahuje se…";
    case "ready":
      return "Hotovo";
    case "failed":
      return "Selhalo";
    case "skipped":
      return "Přeskočeno";
    default:
      return item.status;
  }
}

export default function StudioPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [library, setLibrary] = useState<LibraryTrack[]>([]);
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState<StudioHealth | null>(null);
  const [queue, setQueue] = useState<QueuePreview | null>(null);
  const [remasterJob, setRemasterJob] = useState<RemasterJob | null>(null);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [transitionMsg, setTransitionMsg] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const nextInQueue = queue?.upcoming[0] ?? null;

  const {
    playing,
    nowPlaying,
    trackStartedAt,
    broadcasting,
    queueRemaining,
    toggle,
  } = useRadio();

  const currentTrackMeta = useMemo(
    () => library.find((t) => t.uuid === nowPlaying?.uuid) ?? null,
    [library, nowPlaying?.uuid],
  );

  const trackDurationSec =
    currentTrackMeta?.playDuration ?? currentTrackMeta?.duration ?? null;

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/queue?limit=5", { cache: "no-store" });
      if (!res.ok) return;
      setQueue((await res.json()) as QueuePreview);
    } catch {
      // ignore
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/studio/health", { cache: "no-store" });
      if (!res.ok) return;
      setHealth((await res.json()) as StudioHealth);
    } catch {
      // ignore
    }
  }, []);

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
    void loadHealth();
    void loadQueue();
    const timer = setInterval(() => {
      void loadHealth();
      void loadQueue();
    }, 8000);
    return () => clearInterval(timer);
  }, [loadLibrary, loadHealth, loadQueue]);

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
    }, 800);

    return () => clearInterval(timer);
  }, [job, loadLibrary]);

  useEffect(() => {
    if (
      !remasterJob ||
      remasterJob.status === "done" ||
      remasterJob.status === "failed"
    ) {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/library/remaster?id=${remasterJob.id}`);
        const data = (await res.json()) as { job?: RemasterJob };
        if (data.job) {
          setRemasterJob(data.job);
          if (data.job.status === "done" || data.job.status === "failed") {
            void loadLibrary();
            void loadHealth();
          }
        }
      } catch {
        // ignore
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [remasterJob, loadLibrary, loadHealth]);

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

      if (data.job) {
        setJob(data.job as ImportJob);
      }
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Něco se pokazilo.");
    } finally {
      setLoading(false);
    }
  }

  async function removeFromQueue(track: RadioNowPlaying) {
    await fetch("/api/radio/queue/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: track.uuid }),
    });
    void loadQueue();
  }

  async function startRemaster(force = false) {
    const res = await fetch("/api/library/remaster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const data = (await res.json()) as { job?: RemasterJob; error?: string };
    if (!res.ok || !data.job) {
      alert(data.error ?? "Re-master selhal.");
      return;
    }
    setRemasterJob(data.job);
  }

  async function skipTrack() {
    await fetch("/api/radio/skip", { method: "POST" });
  }

  async function testMidsongLive() {
    if (!nowPlaying?.uuid || !nextInQueue?.uuid) {
      setTransitionMsg("Potřebuješ právě hrající skladbu a další ve frontě.");
      return;
    }
    setTransitionBusy(true);
    setTransitionMsg(null);
    try {
      const res = await fetch("/api/radio/test-midsong", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Test selhal.");
      setTransitionMsg(
        `Live midsong test: konec „${nowPlaying.title}" → midsong → „${nextInQueue.title}" (poslouchej stream).`,
      );
    } catch (err) {
      setTransitionMsg(err instanceof Error ? err.message : "Test selhal.");
    } finally {
      setTransitionBusy(false);
    }
  }

  async function testTransitionLive() {
    if (!nowPlaying?.uuid || !nextInQueue?.uuid) {
      setTransitionMsg("Potřebuješ právě hrající skladbu a další ve frontě.");
      return;
    }
    setTransitionBusy(true);
    setTransitionMsg(null);
    try {
      const res = await fetch("/api/radio/test-transition", { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Test selhal.");
      setTransitionMsg(
        `Live test: konec „${nowPlaying.title}" → „${nextInQueue.title}" (poslouchej stream).`,
      );
    } catch (err) {
      setTransitionMsg(err instanceof Error ? err.message : "Test selhal.");
    } finally {
      setTransitionBusy(false);
    }
  }

  async function previewTransition() {
    if (!nowPlaying?.uuid || !nextInQueue?.uuid) {
      setTransitionMsg("Potřebuješ právě hrající skladbu a další ve frontě.");
      return;
    }
    setTransitionBusy(true);
    setTransitionMsg("Generuji náhled…");
    try {
      const qs = new URLSearchParams({
        from: nowPlaying.uuid,
        to: nextInQueue.uuid,
        t: String(Date.now()),
      });
      const res = await fetch(`/api/radio/transition-preview?${qs}`);
      const contentType = res.headers.get("content-type") ?? "";

      if (!res.ok || !contentType.includes("audio")) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Náhled selhal (${res.status}).`);
      }

      const blob = await res.blob();
      if (blob.size < 2048) {
        throw new Error("Náhled je prázdný — zkontroluj ffmpeg a oba soubory.");
      }

      const el = previewRef.current;
      if (!el) throw new Error("Audio přehrávač není ready.");

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(blob);
      previewUrlRef.current = objectUrl;
      el.src = objectUrl;
      el.load();
      await el.play();
      setTransitionMsg(
        `Náhled: „${nowPlaying.title}" → „${nextInQueue.title}" (přehrávám).`,
      );
    } catch (err) {
      setTransitionMsg(
        err instanceof Error ? err.message : "Náhled nelze přehrát.",
      );
    } finally {
      setTransitionBusy(false);
    }
  }

  async function playUuidOnRadio(uuid: string, title: string) {
    if (
      !confirm(
        `Pustit „${title}" pro všechny posluchače? Změní to živý stream.`,
      )
    ) {
      return;
    }
    await fetch("/api/radio/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid }),
    });
    void loadQueue();
  }

  async function playOnRadio(track: LibraryTrack) {
    await playUuidOnRadio(track.uuid, track.title);
  }

  async function deleteTrack(track: LibraryTrack) {
    if (!confirm(`Smazat „${track.title}" z knihovny?`)) return;
    try {
      const res = await fetch(`/api/library/${track.uuid}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        alert(data.error || `Smazání selhalo (${res.status}).`);
        return;
      }
      void loadLibrary();
      void loadQueue();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Smazání selhalo.");
    }
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
              <TrackTimeline
                trackId={nowPlaying?.uuid ?? null}
                trackStartedAt={trackStartedAt}
                durationSec={trackDurationSec}
                active={broadcasting && Boolean(nowPlaying)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
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

          <div className="mt-5 border-t border-[var(--line)]/60 pt-4">
            <h3 className="mb-2 text-sm font-medium text-[var(--ink-muted)]">
              Test crossfade
            </h3>
            <p className="mb-3 text-xs text-[var(--ink-muted)]">
              {nowPlaying && nextInQueue ? (
                <>
                  <span className="text-[var(--accent-soft)]">{nowPlaying.title}</span>
                  {" → "}
                  <span className="text-[var(--accent-soft)]">{nextInQueue.title}</span>
                </>
              ) : (
                "Na test potřebuješ právě hrající skladbu a další ve frontě."
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={transitionBusy || !nowPlaying || !nextInQueue}
                onClick={() => void previewTransition()}
                className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-2 text-sm text-[var(--accent-soft)] disabled:opacity-40"
              >
                Náhled přechodu
              </button>
              <button
                type="button"
                disabled={transitionBusy || !nowPlaying || !nextInQueue}
                onClick={() => void testTransitionLive()}
                className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-40"
              >
                Test na live streamu
              </button>
            </div>
            {transitionMsg ? (
              <p className="mt-2 text-xs text-[var(--ink-muted)]">{transitionMsg}</p>
            ) : null}
          </div>

          <div className="mt-5 border-t border-[var(--line)]/60 pt-4">
            <h3 className="mb-2 text-sm font-medium text-[var(--ink-muted)]">
              Test midsong
            </h3>
            <p className="mb-3 text-xs text-[var(--ink-muted)]">
              {nowPlaying && nextInQueue ? (
                <>
                  <span className="text-[var(--accent-soft)]">{nowPlaying.title}</span>
                  {" → midsong → "}
                  <span className="text-[var(--accent-soft)]">{nextInQueue.title}</span>
                </>
              ) : (
                "Na test potřebuješ právě hrající skladbu a další ve frontě."
              )}
            </p>
            <button
              type="button"
              disabled={
                transitionBusy ||
                !nowPlaying ||
                !nextInQueue ||
                !health?.midsong.configured
              }
              onClick={() => void testMidsongLive()}
              className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-2 text-sm text-[var(--accent-soft)] disabled:opacity-40"
            >
              Test midsong na live streamu
            </button>
            {!health?.midsong.configured ? (
              <p className="mt-2 text-xs text-[var(--danger)]">
                Midsong soubor nenalezen — dej MIDSONGS-1.wav do public/ a restartuj.
              </p>
            ) : null}
            <audio ref={previewRef} className="sr-only" preload="none" />
          </div>
        </section>

        <section className="animate-fade-up grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 p-5">
            <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg">
              Stav systému
            </h2>
            {health ? (
              <ul className="space-y-2 text-sm text-[var(--ink-muted)]">
                <li>
                  Broadcaster:{" "}
                  <span
                    className={
                      health.broadcaster.online
                        ? "text-[var(--accent-soft)]"
                        : "text-[var(--danger)]"
                    }
                  >
                    {health.broadcaster.online ? "online" : "offline"}
                  </span>
                  {health.broadcaster.pid
                    ? ` · PID ${health.broadcaster.pid}`
                    : ""}
                </li>
                <li>Posluchači: {health.broadcaster.listeners}</li>
                <li>
                  Knihovna: {health.library.ready} ready ·{" "}
                  {health.library.processed} zmasterováno
                  {health.library.needsRemaster > 0
                    ? ` · ${health.library.needsRemaster} čeká`
                    : ""}
                </li>
                <li className="truncate" title={health.tools.ffmpeg ?? undefined}>
                  ffmpeg: {health.tools.ffmpeg ? "✓" : "—"}
                </li>
                <li>yt-dlp: {health.tools.ytDlp ?? "—"}</li>
                <li>
                  Stinger:{" "}
                  {health.midsong.configured
                    ? `náhodně ${health.midsong.minTracks}–${health.midsong.maxTracks} skladeb · fade ${health.midsong.fadeSec}s · ${health.midsong.count} soubor(ů)`
                    : "není nastaven"}
                </li>
              </ul>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">Načítám…</p>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-[family-name:var(--font-display)] text-lg">
                Fronta
              </h2>
              <button
                type="button"
                onClick={() => void loadQueue()}
                className="text-xs text-[var(--accent-soft)]"
              >
                Obnovit
              </button>
            </div>
            {queue?.upcoming.length ? (
              <ul className="space-y-2">
                {queue.upcoming.map((t, i) => (
                  <li
                    key={t.uuid}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)]/60 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="mr-2 text-xs text-[var(--ink-muted)]">
                        {i + 1}.
                      </span>
                      <span className="font-medium">{t.title}</span>
                      <span className="ml-1 text-[var(--ink-muted)]">
                        — {t.artist}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="rounded border border-[var(--line)] px-2 py-0.5 text-xs"
                        onClick={() => void playUuidOnRadio(t.uuid, t.title)}
                      >
                        Hrát
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[var(--danger)]/30 px-2 py-0.5 text-xs text-[var(--danger)]"
                        onClick={() => void removeFromQueue(t)}
                      >
                        Pryč
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">
                Fronta prázdná nebo broadcaster offline.
              </p>
            )}
          </div>
        </section>

        <section className="animate-fade-up rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-lg">
                Re-master knihovny
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Ořez ticha, normalizace a pre-render{" "}
                <code className="text-xs">track.broadcast.mp3</code>
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={remasterJob?.status === "running"}
                onClick={() => void startRemaster(false)}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-50"
              >
                {remasterJob?.status === "running"
                  ? "Běží…"
                  : "Re-masterovat"}
              </button>
              <button
                type="button"
                disabled={remasterJob?.status === "running"}
                onClick={() => void startRemaster(true)}
                className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm"
              >
                Vynutit vše
              </button>
            </div>
          </div>
          {remasterJob && (
            <div className="mt-4">
              <p className="text-sm text-[var(--ink-muted)]">
                {remasterJob.completed}/{remasterJob.total} · {remasterJob.status}
                {remasterJob.current ? ` · ${remasterJob.current}` : ""}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-deep)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{
                    width: `${
                      remasterJob.total
                        ? Math.round((remasterJob.completed / remasterJob.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}
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
                placeholder="https://open.spotify.com/track/... album nebo playlist"
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
                {jobProgress?.label} · {importJobStatusLabel(job.status)}
              </p>
              {(job.current || job.currentDetail) && job.status === "running" && (
                <p className="mt-2 text-sm text-[var(--ink)]">
                  {job.current && (
                    <span className="font-medium">{job.current}</span>
                  )}
                  {job.currentDetail && (
                    <span className="mt-0.5 block text-[var(--accent)]">
                      {job.currentDetail}
                    </span>
                  )}
                </p>
              )}
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
                          : item.status === "downloading"
                            ? "text-[var(--ink)]"
                            : "text-[var(--ink-muted)]"
                      }
                    >
                      {item.title} — {item.artist}:{" "}
                      {importItemStatusLabel(item)}
                      {item.error ? ` (${item.error})` : ""}
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
              {library.length} v knihovně
              {health
                ? ` · ${health.library.ready} hratelných · ${health.library.failed} selhalo`
                : null}
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
                      {track.status !== "ready" ? (
                        <span className="ml-2 text-[var(--danger)]">· {track.status === "failed" ? "selhalo" : track.status}</span>
                      ) : null}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={track.status !== "ready" || !track.audioFile}
                        className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs disabled:opacity-40"
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
