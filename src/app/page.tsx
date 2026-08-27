"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type LibraryTrack = {
  uuid: string;
  spotifyId: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  duration: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  downloadUrl: string | null;
  status: string;
};

type ImportJob = {
  id: string;
  type: string;
  title: string;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  current: string | null;
  error: string | null;
  items: {
    title: string;
    artist: string;
    status: string;
    error: string | null;
  }[];
};

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [library, setLibrary] = useState<LibraryTrack[]>([]);
  const [previewUuid, setPreviewUuid] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const libraryRef = useRef<LibraryTrack[]>([]);
  const bagRef = useRef<string[]>([]);
  const radioActiveRef = useRef(false);
  const switchingRef = useRef(false);
  const [radioOn, setRadioOn] = useState(false);
  const [radioTrack, setRadioTrack] = useState<LibraryTrack | null>(null);

  const loadLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/library");
      const data = (await res.json()) as { tracks?: LibraryTrack[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Nelze načíst knihovnu.");
      const tracks = data.tracks ?? [];
      setLibrary(tracks);
      libraryRef.current = tracks;
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

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
        // ignore transient poll errors
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
        setPreviewUuid(data.track.uuid);
      } else if (data.type === "playlist") {
        setJob(data.job as ImportJob);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Něco se pokazilo.");
    } finally {
      setLoading(false);
    }
  }

  const refillBag = useCallback(() => {
    const ready = libraryRef.current.filter((t) => t.downloadUrl);
    const ids = shuffle(ready.map((t) => t.uuid));
    // avoid instantly repeating the last played track when possible
    if (ids.length > 1 && radioTrack?.uuid && ids[0] === radioTrack.uuid) {
      const first = ids.shift()!;
      ids.push(first);
    }
    bagRef.current = ids;
  }, [radioTrack?.uuid]);

  const playTrack = useCallback(async (track: LibraryTrack) => {
    const el = audioRef.current;
    if (!el || !track.downloadUrl) return;

    switchingRef.current = true;
    setRadioTrack(track);
    setRadioOn(true);
    setPreviewUuid(null);
    radioActiveRef.current = true;

    try {
      el.pause();
      el.src = track.downloadUrl;
      el.load();
      await el.play();
    } catch {
      // browser may abort during rapid skips; retry once
      try {
        await el.play();
      } catch {
        // ignore
      }
    } finally {
      switchingRef.current = false;
    }
  }, []);

  const playNextRandom = useCallback(() => {
    const lib = libraryRef.current.filter((t) => t.downloadUrl);
    if (!lib.length) return;

    for (let attempt = 0; attempt < lib.length + 2; attempt++) {
      if (!bagRef.current.length) refillBag();
      if (!bagRef.current.length) return;

      const nextId = bagRef.current.shift()!;
      const track = lib.find((t) => t.uuid === nextId);
      if (track) {
        void playTrack(track);
        return;
      }
    }
  }, [playTrack, refillBag]);

  // Continuous radio: when a song ends, always queue the next random one
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onEnded = () => {
      if (!radioActiveRef.current) return;
      playNextRandom();
    };

    const onPlay = () => setRadioOn(true);
    const onPause = () => {
      if (switchingRef.current) return;
      // user paused via controls — stop continuous radio
      if (el.ended) return;
      setRadioOn(false);
      radioActiveRef.current = false;
    };

    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [playNextRandom]);

  function toggleRadio() {
    const el = audioRef.current;
    if (!el) return;

    if (radioActiveRef.current && !el.paused) {
      radioActiveRef.current = false;
      el.pause();
      setRadioOn(false);
      return;
    }

    // resume or start continuous random radio
    radioActiveRef.current = true;
    if (radioTrack?.downloadUrl && el.src) {
      setRadioOn(true);
      void el.play().catch(() => {
        playNextRandom();
      });
      return;
    }

    playNextRandom();
  }

  function playFromLibrary(track: LibraryTrack) {
    radioActiveRef.current = true;
    // rebuild bag without this track first so "next" continues randomly after
    const others = libraryRef.current
      .filter((t) => t.downloadUrl && t.uuid !== track.uuid)
      .map((t) => t.uuid);
    bagRef.current = shuffle(others);
    void playTrack(track);
  }

  const jobProgress = useMemo(() => {
    if (!job) return null;
    const pct = job.total ? Math.round((job.completed / job.total) * 100) : 0;
    return { pct, label: `${job.completed}/${job.total}` };
  }, [job]);

  const preview = previewUuid
    ? library.find((t) => t.uuid === previewUuid) ?? null
    : null;

  return (
    <main className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col gap-12 px-5 py-10 sm:py-14">
      <header className="animate-fade-up">
        <p className="mb-3 text-xs font-semibold tracking-[0.28em] text-[var(--accent)] uppercase">
          AI Radio
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-5xl">
          Knihovna & rádio
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--ink-muted)]">
          Vlož Spotify track nebo playlist. Skladby se uloží do UUID složek
          (info + mp3). Radio náhodně hraje ze všech stažených písní.
        </p>
      </header>

      {/* Import */}
      <section className="animate-fade-up" style={{ animationDelay: "60ms" }}>
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
          Import
        </h2>
        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 p-5 sm:p-6"
        >
          <label
            htmlFor="spotify-url"
            className="mb-2 block text-sm font-medium text-[var(--ink-muted)]"
          >
            Spotify odkaz (track nebo playlist)
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="spotify-url"
              type="url"
              required
              placeholder="https://open.spotify.com/playlist/... nebo /track/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading || job?.status === "running"}
              className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--bg-deep)]/70 px-4 py-3 text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-muted)]/60 focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              disabled={loading || !url.trim() || job?.status === "running"}
              suppressHydrationWarning
              className={`rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--bg-deep)] transition hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-50 ${loading ? "animate-pulse-ring" : ""}`}
            >
              {loading ? "Připravuju…" : "Stáhnout"}
            </button>
          </div>
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            Playlist max 50 skladeb. Spotify API klíče v{" "}
            <code className="text-[var(--accent-soft)]">.env.local</code>.
          </p>
        </form>

        {error && (
          <p
            className="mt-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]"
            role="alert"
          >
            {error}
          </p>
        )}

        {job && (
          <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-[var(--ink)]">
                Playlist: {job.title}
              </p>
              <p className="text-sm text-[var(--ink-muted)]">
                {jobProgress?.label} · {job.status}
                {job.skipped ? ` · přeskočeno ${job.skipped}` : ""}
                {job.failed ? ` · chyby ${job.failed}` : ""}
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-deep)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
                style={{ width: `${jobProgress?.pct ?? 0}%` }}
              />
            </div>
            {job.current && (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                Právě: {job.current}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Radio */}
      <section className="animate-fade-up" style={{ animationDelay: "100ms" }}>
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
          Radio
        </h2>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--bg-deep)]">
              {radioTrack?.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={radioTrack.thumbnail}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-[var(--ink-muted)]">
                  —
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
                {radioTrack?.title ?? "Nic nehraje"}
              </p>
              <p className="truncate text-[var(--accent-soft)]">
                {radioTrack?.artist ?? "Spusť rádio ze stažené knihovny"}
              </p>
              {radioTrack?.year && (
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {radioTrack.year}
                  {radioTrack.album ? ` · ${radioTrack.album}` : ""}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={toggleRadio}
                disabled={!library.length}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-40"
              >
                {radioOn ? "Pauza" : "Play"}
              </button>
              <button
                type="button"
                onClick={playNextRandom}
                disabled={!library.length}
                className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink)] disabled:opacity-40"
              >
                Další
              </button>
            </div>
          </div>
          <audio ref={audioRef} className="mt-4 w-full" controls preload="auto" />
          <p className="mt-2 text-xs text-[var(--ink-muted)]">
            Po Play rádio samo střídá náhodné skladby. Pauza vypne autoplay.
          </p>
        </div>
      </section>

      {/* Library */}
      <section className="animate-fade-up pb-10" style={{ animationDelay: "140ms" }}>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
            Knihovna
          </h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {library.length} stažených
          </p>
        </div>

        {!library.length ? (
          <p className="rounded-2xl border border-dashed border-[var(--line)] px-5 py-10 text-center text-sm text-[var(--ink-muted)]">
            Zatím nic. Importuj track nebo playlist výše.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {library.map((track) => (
              <li
                key={track.uuid}
                className={`flex gap-3 overflow-hidden rounded-2xl border p-3 transition ${
                  preview?.uuid === track.uuid || radioTrack?.uuid === track.uuid
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
                  <p className="truncate font-medium text-[var(--ink)]">
                    {track.title}
                  </p>
                  <p className="truncate text-sm text-[var(--accent-soft)]">
                    {track.artist}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                    {track.year ?? "—"} · {formatDuration(track.duration)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--ink)]"
                      onClick={() => playFromLibrary(track)}
                    >
                      Přehrát
                    </button>
                    {track.downloadUrl && (
                      <a
                        href={track.downloadUrl}
                        download
                        className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--ink-muted)]"
                      >
                        MP3
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {preview && (
          <article className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 p-5">
            <p className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
              Detail
            </p>
            <h3 className="mt-1 font-[family-name:var(--font-display)] text-2xl">
              {preview.title}
            </h3>
            <p className="text-[var(--accent-soft)]">{preview.artist}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[var(--ink-muted)]">Album</dt>
                <dd>{preview.album ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-muted)]">Rok</dt>
                <dd>{preview.year ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-muted)]">UUID</dt>
                <dd className="truncate font-mono text-xs">{preview.uuid}</dd>
              </div>
            </dl>
          </article>
        )}
      </section>
    </main>
  );
}
