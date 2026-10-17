"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Cover,
  DedicationNote,
  formatLength,
  formatTime,
  LevelMeter,
  LiveBadge,
  StationHeader,
} from "@/components/player/BroadcastUi";
import { TrackTimeline } from "@/components/ProgramSchedule";
import { BreakPanel } from "@/components/studio/BreakPanel";
import { MicPanel } from "@/components/studio/MicPanel";
import { RequestModeration } from "@/components/studio/RequestModeration";
import { useRadio } from "@/components/RadioProvider";
import type {
  ImportJob,
  LibraryStats,
  LibraryStatsRow,
  LibraryTrack,
  RemasterJob,
  StationConfig,
  StudioHealth,
  StudioQueueItem,
} from "@/lib/types";

type Tab = "library" | "stats" | "import" | "system";

const TABS: [Tab, string][] = [
  ["library", "Knihovna"],
  ["stats", "Statistiky"],
  ["import", "Import"],
  ["system", "Systém"],
];

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: res.ok, error: data.error };
  } catch {
    return { ok: false, error: "Broadcaster neodpovídá." };
  }
}

function relativeDay(iso: string | null): string {
  if (!iso) return "nikdy";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "teď";
  if (diff < 3_600_000) return `před ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `dnes ${formatTime(iso)}`;
  const days = Math.round(diff / 86_400_000);
  return days === 1 ? "včera" : `před ${days} dny`;
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="label">{children}</h2>
      {aside}
    </div>
  );
}

function TextButton({
  children,
  onClick,
  danger = false,
  disabled = false,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`text-xs transition-colors disabled:opacity-30 ${
        danger
          ? "text-[var(--ink-muted)] hover:text-[var(--danger)]"
          : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
      }`}
    >
      {children}
    </button>
  );
}

function OutlineButton({
  children,
  onClick,
  disabled,
  primary = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-4 py-1.5 text-sm transition-colors disabled:opacity-40 ${
        primary
          ? "bg-[var(--accent)] font-medium text-[var(--bg-deep)] hover:bg-[var(--accent-soft)]"
          : "border border-[var(--line-strong)] text-[var(--ink)] hover:border-[var(--ink)]"
      }`}
    >
      {children}
    </button>
  );
}

/** Odpočet do konce skladby — ať moderátor ví, kdy začít mluvit. */
function TimeLeft({
  trackStartedAt,
  durationSec,
}: {
  trackStartedAt: string | null;
  durationSec: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const started = trackStartedAt ? Date.parse(trackStartedAt) : NaN;
  if (!durationSec || !Number.isFinite(started)) return null;
  const left = Math.max(0, Math.round(durationSec - (now - started) / 1000));
  const soon = left <= 30;
  return (
    <>
      {" · do konce "}
      <span
        className={`font-[family-name:var(--font-mono)] ${soon ? "text-[var(--accent-soft)]" : "text-[var(--ink)]"}`}
      >
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </span>
    </>
  );
}

export function StudioClient({ station }: { station: StationConfig }) {
  const {
    playing,
    nowPlaying,
    trackStartedAt,
    broadcasting,
    stationOnline,
    listeners,
    segment,
    toggle,
    moderationPending,
  } = useRadio();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("library");
  const [queue, setQueue] = useState<StudioQueueItem[]>([]);
  const [library, setLibrary] = useState<LibraryTrack[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [health, setHealth] = useState<StudioHealth | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragUuid, setDragUuid] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const previewRef = useRef<HTMLAudioElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((ok: boolean, text: string) => {
    setNotice({ ok, text });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/queue/full", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: StudioQueueItem[] };
      setQueue(data.items ?? []);
    } catch {
      // offline
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/library", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { tracks?: LibraryTrack[] };
      setLibrary(data.tracks ?? []);
    } catch {
      // offline
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/stats", { cache: "no-store" });
      if (!res.ok) return;
      setStats((await res.json()) as LibraryStats);
    } catch {
      // offline
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/studio/health", { cache: "no-store" });
      if (!res.ok) return;
      setHealth((await res.json()) as StudioHealth);
    } catch {
      // offline
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => {
      void loadQueue();
      void loadLibrary();
      void loadStats();
      void loadHealth();
    }, 0);
    const fast = setInterval(() => void loadQueue(), 5_000);
    const slow = setInterval(() => {
      void loadStats();
      void loadHealth();
    }, 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(fast);
      clearInterval(slow);
    };
  }, [loadQueue, loadLibrary, loadStats, loadHealth]);

  // Při změně skladby obnovit frontu a statistiky hned.
  useEffect(() => {
    const t = setTimeout(() => {
      void loadQueue();
      void loadStats();
    }, 500);
    return () => clearTimeout(t);
  }, [nowPlaying?.uuid, loadQueue, loadStats]);

  const statsByUuid = useMemo(() => {
    const map = new Map<string, LibraryStatsRow>();
    for (const row of stats?.rows ?? []) map.set(row.uuid, row);
    return map;
  }, [stats]);

  const nextItem = queue[0] ?? null;

  // ───────── akce ─────────

  async function skip() {
    const r = await postJson("/api/radio/skip");
    if (!r.ok) say(false, r.error ?? "Skip selhal.");
  }

  async function playNext(uuid: string, title: string) {
    const r = await postJson("/api/radio/queue/next", { uuid });
    say(r.ok, r.ok ? `„${title}“ hraje jako další.` : r.error ?? "Nepovedlo se.");
    void loadQueue();
  }

  async function playNow(uuid: string, title: string) {
    if (!confirm(`Pustit „${title}“ hned teď? Aktuální skladba se stáhne.`)) return;
    const r = await postJson("/api/radio/play", { uuid });
    say(r.ok, r.ok ? `Přepínám na „${title}“.` : r.error ?? "Nepovedlo se.");
    setTimeout(() => void loadQueue(), 1500);
  }

  async function removeFromQueue(item: StudioQueueItem) {
    setQueue((q) => q.filter((i) => i.uuid !== item.uuid));
    const r = await postJson("/api/radio/queue/remove", { uuid: item.uuid });
    if (!r.ok) say(false, r.error ?? "Odebrání selhalo.");
    void loadQueue();
  }

  async function moveRotation(uuid: string, toIndex: number) {
    const rotation = queue.filter((i) => i.source === "rotation");
    const item = rotation.find((i) => i.uuid === uuid);
    if (!item) return;
    const reordered = rotation.filter((i) => i.uuid !== uuid);
    const idx = Math.min(Math.max(0, toIndex), reordered.length);
    reordered.splice(idx, 0, item);
    setQueue([...queue.filter((i) => i.source !== "rotation"), ...reordered]);
    const r = await postJson("/api/radio/queue/move", { uuid, toIndex: idx });
    if (!r.ok) say(false, r.error ?? "Přesun selhal.");
    void loadQueue();
  }

  async function runTest(kind: "transition" | "jingle") {
    setBusy(true);
    const r = await postJson(
      kind === "transition" ? "/api/radio/test-transition" : "/api/radio/test-midsong",
    );
    setBusy(false);
    say(
      r.ok,
      r.ok
        ? kind === "transition"
          ? "Skáču na konec skladby — přechod uslyšíš za ~10 s."
          : "Skáču na konec skladby — za ~10 s jingle a další skladba."
        : r.error ?? "Test selhal.",
    );
  }

  async function previewTransition() {
    if (!nowPlaying || !nextItem) return;
    setBusy(true);
    say(true, "Připravuji náhled přechodu…");
    try {
      const qs = new URLSearchParams({ from: nowPlaying.uuid, to: nextItem.uuid, t: String(Date.now()) });
      const res = await fetch(`/api/radio/transition-preview?${qs}`);
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("audio")) {
        throw new Error("Náhled se nepodařilo vytvořit.");
      }
      const blob = await res.blob();
      const el = previewRef.current;
      if (!el) return;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = URL.createObjectURL(blob);
      el.src = previewUrlRef.current;
      await el.play();
      say(true, `Náhled do sluchátek: „${nowPlaying.title}“ → „${nextItem.title}“.`);
    } catch (err) {
      say(false, err instanceof Error ? err.message : "Náhled selhal.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/studio/logout", { method: "POST" });
    router.push("/player");
  }

  // ───────── drag & drop ve frontě ─────────

  const rotation = queue.filter((i) => i.source === "rotation");
  const fixed = queue.filter((i) => i.source !== "rotation");

  function onDragStart(e: DragEvent, uuid: string) {
    setDragUuid(uuid);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", uuid);
  }

  function onDragOver(e: DragEvent, index: number) {
    if (!dragUuid) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropIndex(index + (after ? 1 : 0));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (dragUuid && dropIndex !== null) {
      const from = rotation.findIndex((i) => i.uuid === dragUuid);
      const target = from >= 0 && from < dropIndex ? dropIndex - 1 : dropIndex;
      if (target !== from) void moveRotation(dragUuid, target);
    }
    setDragUuid(null);
    setDropIndex(null);
  }

  const onAir = broadcasting && stationOnline;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--line)]">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <StationHeader config={{ ...station, tagline: "" }} compact />
            <span className="label hidden border-l border-[var(--line-strong)] pl-4 sm:inline">
              Studio
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-5">
            <LiveBadge live={onAir} listeners={listeners} />
            <Link href="/player" className="hidden text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] sm:inline">
              Přehrávač
            </Link>
            <TextButton onClick={() => void logout()}>Odhlásit</TextButton>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-12 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-16">
        {/* ───────── vysílání + fronta ───────── */}
        <div className="min-w-0 space-y-10">
          <section>
            <SectionTitle
              aside={
                segment !== "song" ? (
                  <span className="text-xs text-[var(--accent)]">
                    {segment === "stinger" ? "jingle" : segment === "talk" ? "pauza" : "přechod"}
                  </span>
                ) : null
              }
            >
              Ve vysílání
            </SectionTitle>
            <div className="flex gap-4">
              <Cover src={nowPlaying?.thumbnail} size="md" className="rounded-[3px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight">
                  {nowPlaying?.title ?? (onAir ? "Ladím…" : "Nevysílá se")}
                </p>
                <p className="truncate text-sm text-[var(--ink-muted)]">
                  {nowPlaying?.artist ?? "Spusť broadcaster (start.bat)"}
                  {nowPlaying && segment !== "talk" ? (
                    <TimeLeft
                      trackStartedAt={trackStartedAt}
                      durationSec={nowPlaying.durationSec ?? null}
                    />
                  ) : null}
                </p>
              </div>
            </div>
            <div className="mt-4">
              <TrackTimeline
                trackId={nowPlaying?.uuid ?? null}
                trackStartedAt={trackStartedAt}
                durationSec={nowPlaying?.durationSec ?? null}
                active={Boolean(nowPlaying && broadcasting)}
              />
            </div>
            {nowPlaying?.dedication ? (
              <DedicationNote dedication={nowPlaying.dedication} large title="Přečti do éteru" />
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <OutlineButton primary onClick={() => void skip()} disabled={!onAir}>
                Další skladba
              </OutlineButton>
              <OutlineButton onClick={toggle}>
                <span className="inline-flex items-center gap-2">
                  <LevelMeter active={playing} />
                  {playing ? "Přestat poslouchat" : "Odposlech"}
                </span>
              </OutlineButton>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
              <TextButton disabled={busy || !nowPlaying || !nextItem} onClick={() => void previewTransition()}>
                Náhled přechodu
              </TextButton>
              <TextButton disabled={busy || !onAir} onClick={() => void runTest("transition")}>
                Test přechodu naživo
              </TextButton>
              <TextButton
                disabled={busy || !onAir || !health?.midsong.configured}
                onClick={() => void runTest("jingle")}
              >
                Test jinglu naživo
              </TextButton>
            </div>
            {notice ? (
              <p
                className={`mt-3 text-sm ${notice.ok ? "text-[var(--ink-muted)]" : "text-[var(--danger)]"}`}
                role="status"
              >
                {notice.text}
              </p>
            ) : null}
            <audio ref={previewRef} className="hidden" preload="none" />
          </section>

          <BreakPanel
            library={library}
            nextTitle={nextItem ? `${nextItem.artist} — ${nextItem.title}` : null}
          />

          <MicPanel />

          <RequestModeration />

          <section>
            <SectionTitle
              aside={<span className="text-xs text-[var(--ink-faint)]">přetáhni pro změnu pořadí</span>}
            >
              Fronta
            </SectionTitle>
            {!queue.length ? (
              <p className="text-sm text-[var(--ink-muted)]">Fronta je prázdná nebo broadcaster neběží.</p>
            ) : (
              <ol onDragLeave={() => setDropIndex(null)}>
                {fixed.map((item) => (
                  <QueueRow
                    key={`${item.source}-${item.uuid}`}
                    item={item}
                    badge={item.source === "prepared" ? "další" : "přání"}
                    onRemove={() => void removeFromQueue(item)}
                    onNow={() => void playNow(item.uuid, item.title)}
                  />
                ))}
                {rotation.map((item, index) => (
                  <QueueRow
                    key={item.uuid}
                    item={item}
                    draggable
                    dragging={dragUuid === item.uuid}
                    dropBefore={dropIndex === index}
                    dropAfter={dropIndex === rotation.length && index === rotation.length - 1}
                    onDragStart={(e) => onDragStart(e, item.uuid)}
                    onDragOver={(e) => onDragOver(e, index)}
                    onDrop={onDrop}
                    onDragEnd={() => {
                      setDragUuid(null);
                      setDropIndex(null);
                    }}
                    onUp={index > 0 ? () => void moveRotation(item.uuid, index - 1) : undefined}
                    onDown={
                      index < rotation.length - 1
                        ? () => void moveRotation(item.uuid, index + 1)
                        : undefined
                    }
                    onNext={() => void playNext(item.uuid, item.title)}
                    onRemove={() => void removeFromQueue(item)}
                  />
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* ───────── záložky ───────── */}
        <div className="min-w-0">
          <nav className="mb-8 flex gap-6 border-b border-[var(--line)]" aria-label="Sekce studia">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 pb-3 font-[family-name:var(--font-display)] text-sm font-semibold uppercase tracking-wider transition-colors ${
                  tab === key
                    ? "border-[var(--accent)] text-[var(--ink)]"
                    : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {tab === "library" ? (
            <LibraryTab
              library={library}
              statsByUuid={statsByUuid}
              nowPlayingUuid={nowPlaying?.uuid ?? null}
              onNext={(t) => void playNext(t.uuid, t.title)}
              onNow={(t) => void playNow(t.uuid, t.title)}
              onDeleted={() => {
                void loadLibrary();
                void loadQueue();
                void loadStats();
              }}
              say={say}
              stats={stats}
              moderationPending={moderationPending}
              onAdd={() => setTab("import")}
            />
          ) : tab === "stats" ? (
            <StatsTab stats={stats} onNext={(r) => void playNext(r.uuid, r.title)} />
          ) : tab === "import" ? (
            <ImportTab onDone={() => {
              void loadLibrary();
              void loadStats();
            }} />
          ) : (
            <SystemTab health={health} onRemasterDone={() => {
              void loadLibrary();
              void loadHealth();
            }} />
          )}
        </div>
      </main>
    </div>
  );
}

// ───────────────────────── fronta ─────────────────────────

function QueueRow({
  item,
  badge,
  draggable = false,
  dragging = false,
  dropBefore = false,
  dropAfter = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onUp,
  onDown,
  onNext,
  onNow,
  onRemove,
}: {
  item: StudioQueueItem;
  badge?: string;
  draggable?: boolean;
  dragging?: boolean;
  dropBefore?: boolean;
  dropAfter?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onDragEnd?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onNext?: () => void;
  onNow?: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`group relative flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${dragging ? "opacity-30" : ""}`}
    >
      {dropBefore ? <span className="absolute inset-x-0 -top-px h-0.5 bg-[var(--accent)]" /> : null}
      {dropAfter ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--accent)]" /> : null}
      <span className="w-4 shrink-0 text-center text-[var(--ink-faint)]" aria-hidden>
        {draggable ? "⋮⋮" : ""}
      </span>
      <Cover src={item.thumbnail} size="sm" className="rounded-[2px]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {item.stingerBefore ? (
            <span className="mr-1.5 text-xs uppercase tracking-wider text-[var(--ink-faint)]">jingle ·</span>
          ) : null}
          {item.title}
        </p>
        <p className="truncate text-xs text-[var(--ink-muted)]">
          {item.artist}
          {badge ? <span className="text-[var(--accent)]"> · {badge}</span> : null}
        </p>
      </div>
      <span className="shrink-0 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-faint)] group-hover:hidden">
        {formatLength(item.durationSec)}
      </span>
      <div className="hidden shrink-0 items-center gap-3 group-hover:flex group-focus-within:flex">
        {onUp ? <TextButton title="Posunout výš" onClick={onUp}>↑</TextButton> : null}
        {onDown ? <TextButton title="Posunout níž" onClick={onDown}>↓</TextButton> : null}
        {onNext ? <TextButton onClick={onNext}>Jako další</TextButton> : null}
        {onNow ? <TextButton onClick={onNow}>Teď</TextButton> : null}
        <TextButton danger onClick={onRemove}>Odebrat</TextButton>
      </div>
    </li>
  );
}

// ───────────────────────── knihovna ─────────────────────────

function LibraryTab({
  library,
  statsByUuid,
  nowPlayingUuid,
  onNext,
  onNow,
  onDeleted,
  say,
  stats,
  moderationPending,
  onAdd,
}: {
  library: LibraryTrack[];
  statsByUuid: Map<string, LibraryStatsRow>;
  nowPlayingUuid: string | null;
  onNext: (t: LibraryTrack) => void;
  onNow: (t: LibraryTrack) => void;
  onDeleted: () => void;
  say: (ok: boolean, text: string) => void;
  stats: LibraryStats | null;
  moderationPending: number;
  onAdd: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"new" | "plays" | "artist">("new");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? library.filter((t) =>
          `${t.title} ${t.artist} ${t.album ?? ""}`.toLowerCase().includes(q),
        )
      : library;
    const sorted = [...filtered];
    if (sort === "plays") {
      sorted.sort((a, b) => (statsByUuid.get(b.uuid)?.plays ?? 0) - (statsByUuid.get(a.uuid)?.plays ?? 0));
    } else if (sort === "artist") {
      sorted.sort((a, b) => a.artist.localeCompare(b.artist, "cs"));
    }
    return sorted;
  }, [library, search, sort, statsByUuid]);

  async function remove(track: LibraryTrack) {
    if (!confirm(`Smazat „${track.title}“ z knihovny? Soubor se odstraní z disku.`)) return;
    const res = await fetch(`/api/library/${track.uuid}`, { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    say(res.ok, res.ok ? `„${track.title}“ smazáno.` : data.error ?? "Smazání selhalo.");
    if (res.ok) onDeleted();
  }

  return (
    <section>
      <div className="mb-9 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Figure value={String(library.length)} label="skladeb" />
        <Figure
          value={stats ? stats.libraryHours.toFixed(1).replace(".", ",") : "–"}
          label="hodin hudby"
        />
        <Figure value={stats ? String(stats.totalPlays) : "–"} label="odehráno" />
        <Figure value={String(moderationPending)} label="přání čeká" accent={moderationPending > 0} />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Hledat v ${library.length} skladbách`}
          className="min-w-0 flex-1 border-b border-[var(--line-strong)] bg-transparent py-2 text-sm outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
        />
        <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          Řadit
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="border-b border-[var(--line-strong)] bg-transparent py-1 text-[var(--ink)] outline-none"
          >
            <option value="new" className="bg-[var(--bg-panel)]">nejnovější</option>
            <option value="plays" className="bg-[var(--bg-panel)]">nejhranější</option>
            <option value="artist" className="bg-[var(--bg-panel)]">interpret</option>
          </select>
        </label>
        <OutlineButton primary onClick={onAdd}>
          Přidat skladby
        </OutlineButton>
      </div>

      {!rows.length ? (
        <p className="py-10 text-center text-sm text-[var(--ink-muted)]">
          {library.length ? "Nic nenalezeno." : "Knihovna je prázdná — klikni na „Přidat skladby“."}
        </p>
      ) : (
        <ul>
          {rows.map((t) => {
            const s = statsByUuid.get(t.uuid);
            const playable = t.status === "ready" && Boolean(t.audioFile);
            const isOnAir = t.uuid === nowPlayingUuid;
            return (
              <li
                key={t.uuid}
                className="group flex items-center gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0"
              >
                <Cover src={t.thumbnail} size="sm" className="rounded-[2px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {t.title}
                    {isOnAir ? <span className="ml-2 text-xs text-[var(--accent)]">ve vysílání</span> : null}
                  </p>
                  <p className="truncate text-xs text-[var(--ink-muted)]">
                    {t.artist}
                    {s?.broken ? <span className="text-[var(--danger)]"> · {s.broken.reason}</span> : null}
                    {!playable && !s?.broken ? <span className="text-[var(--danger)]"> · nelze přehrát</span> : null}
                  </p>
                </div>
                <div className="hidden shrink-0 items-center gap-5 font-[family-name:var(--font-mono)] text-xs tabular-nums text-[var(--ink-faint)] sm:flex group-hover:hidden">
                  <span title="Počet odehrání">{s?.plays ?? 0}×</span>
                  <span className="w-10 text-right">{formatLength(t.playDuration ?? t.duration)}</span>
                </div>
                <div className="hidden shrink-0 items-center gap-4 group-hover:flex group-focus-within:flex">
                  <TextButton disabled={!playable} onClick={() => onNext(t)}>Jako další</TextButton>
                  <TextButton disabled={!playable} onClick={() => onNow(t)}>Teď</TextButton>
                  <TextButton danger onClick={() => void remove(t)}>Smazat</TextButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ───────────────────────── statistiky ─────────────────────────

function Figure({
  value,
  label,
  accent = false,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p
        className={`font-[family-name:var(--font-display)] text-4xl font-semibold leading-none ${
          accent ? "text-[var(--accent-soft)]" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-2 text-xs text-[var(--ink-muted)]">{label}</p>
    </div>
  );
}

function StatsTab({
  stats,
  onNext,
}: {
  stats: LibraryStats | null;
  onNext: (row: LibraryStatsRow) => void;
}) {
  if (!stats) {
    return <p className="text-sm text-[var(--ink-muted)]">Načítám… (statistiky dává broadcaster)</p>;
  }

  const rows = stats.rows;
  const top = [...rows].filter((r) => r.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 8);
  const never = rows.filter((r) => r.plays === 0 && !r.broken);
  const broken = rows.filter((r) => r.broken);
  const maxPlays = top[0]?.plays ?? 1;

  return (
    <div className="space-y-12">
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
        <Figure value={String(rows.length)} label="skladeb v knihovně" />
        <Figure value={stats.libraryHours.toFixed(1).replace(".", ",")} label="hodin hudby" />
        <Figure value={String(stats.totalPlays)} label="odehráno celkem" />
        <Figure value={String(never.length)} label="ještě nehrálo" />
      </div>

      <section>
        <SectionTitle>Nejhranější</SectionTitle>
        {!top.length ? (
          <p className="text-sm text-[var(--ink-muted)]">Zatím nic — statistiky se sbírají od teď.</p>
        ) : (
          <ul>
            {top.map((r) => (
              <li key={r.uuid} className="flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0">
                <Cover src={r.thumbnail} size="sm" className="rounded-[2px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{r.title}</p>
                  <div className="mt-1 h-[3px] bg-[var(--line)]">
                    <div className="h-full bg-[var(--accent)]" style={{ width: `${(r.plays / maxPlays) * 100}%` }} />
                  </div>
                </div>
                <span className="w-36 shrink-0 text-right font-[family-name:var(--font-mono)] text-xs text-[var(--ink-muted)]">
                  {r.plays}× · {relativeDay(r.lastPlayedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle aside={<span className="text-xs text-[var(--ink-faint)]">{never.length} skladeb</span>}>
          Ještě nehrály
        </SectionTitle>
        {!never.length ? (
          <p className="text-sm text-[var(--ink-muted)]">Všechno už zaznělo.</p>
        ) : (
          <ul>
            {never.slice(0, 12).map((r) => (
              <li key={r.uuid} className="group flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0">
                <Cover src={r.thumbnail} size="sm" className="rounded-[2px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{r.title}</p>
                  <p className="truncate text-xs text-[var(--ink-muted)]">{r.artist}</p>
                </div>
                <TextButton onClick={() => onNext(r)}>Jako další</TextButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Problémy</SectionTitle>
        {!broken.length ? (
          <p className="text-sm text-[var(--ink-muted)]">Žádné — všechny skladby jdou přehrát.</p>
        ) : (
          <ul>
            {broken.map((r) => (
              <li key={r.uuid} className="flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{r.title} <span className="text-[var(--ink-muted)]">— {r.artist}</span></p>
                  <p className="truncate text-xs text-[var(--danger)]">{r.broken!.reason}</p>
                </div>
                <span className="shrink-0 text-xs text-[var(--ink-faint)]">{relativeDay(r.broken!.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {broken.length ? (
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            Rotace je přeskakuje. Pomůže re-master v záložce Systém, nebo skladbu smazat a stáhnout znovu.
          </p>
        ) : null}
      </section>
    </div>
  );
}

// ───────────────────────── import ─────────────────────────

function importItemLabel(item: ImportJob["items"][number]): string {
  if (item.detail) return item.detail;
  switch (item.status) {
    case "pending":
      return "čeká";
    case "downloading":
      return "stahuje se…";
    case "ready":
      return "hotovo";
    case "failed":
      return "selhalo";
    case "skipped":
      return "už v knihovně";
    default:
      return item.status;
  }
}

function ImportTab({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`);
        const data = (await res.json()) as { job?: ImportJob };
        if (!data.job) return;
        setJob(data.job);
        if (data.job.status === "done" || data.job.status === "failed") onDone();
      } catch {
        // ignore
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [job, onDone]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { job?: ImportJob; error?: string };
      if (!res.ok) throw new Error(data.error || "Import selhal.");
      if (data.job) setJob(data.job);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import selhal.");
    } finally {
      setLoading(false);
    }
  }

  const running = job?.status === "running" || job?.status === "queued";
  const pct = job?.total ? Math.round((job.completed / job.total) * 100) : 0;

  return (
    <section>
      <p className="mb-6 max-w-lg text-sm text-[var(--ink-muted)]">
        Vlož odkaz na skladbu, album nebo playlist ze Spotify (max 50 skladeb).
        Audio se stáhne, zmasteruje a skladby se samy zařadí do rotace.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading || running}
          placeholder="https://open.spotify.com/playlist/…"
          className="min-w-0 flex-1 border-b border-[var(--line-strong)] bg-transparent py-2 text-sm outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
        />
        <OutlineButton type="submit" primary disabled={loading || running || !url.trim()}>
          {loading ? "Odesílám…" : "Stáhnout"}
        </OutlineButton>
      </form>
      {error ? <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}

      {job ? (
        <div className="mt-10">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate font-medium">{job.title}</p>
            <span className="shrink-0 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-muted)]">
              {job.completed}/{job.total}
            </span>
          </div>
          <div className="mt-2 h-[3px] bg-[var(--line-strong)]">
            <div className="h-full bg-[var(--accent)] transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          {running && (job.current || job.currentDetail) ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              {job.current}
              {job.currentDetail ? ` — ${job.currentDetail}` : ""}
            </p>
          ) : null}
          {job.items.length ? (
            <ul className="mt-4 max-h-80 overflow-y-auto">
              {job.items.map((item, i) => (
                <li
                  key={`${item.title}-${i}`}
                  className="flex justify-between gap-4 border-t border-[var(--line)] py-1.5 text-xs first:border-t-0"
                >
                  <span className="truncate">
                    {item.title} <span className="text-[var(--ink-muted)]">— {item.artist}</span>
                  </span>
                  <span
                    className={`shrink-0 ${
                      item.status === "failed" ? "text-[var(--danger)]" : "text-[var(--ink-muted)]"
                    }`}
                    title={item.error ?? undefined}
                  >
                    {importItemLabel(item)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ───────────────────────── systém ─────────────────────────

function SystemTab({
  health,
  onRemasterDone,
}: {
  health: StudioHealth | null;
  onRemasterDone: () => void;
}) {
  const [job, setJob] = useState<RemasterJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/library/remaster?id=${job.id}`);
        const data = (await res.json()) as { job?: RemasterJob };
        if (!data.job) return;
        setJob(data.job);
        if (data.job.status !== "running") onRemasterDone();
      } catch {
        // ignore
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [job, onRemasterDone]);

  async function start(force: boolean) {
    setError(null);
    const res = await fetch("/api/library/remaster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const data = (await res.json()) as { job?: RemasterJob; error?: string };
    if (!res.ok || !data.job) {
      setError(data.error ?? "Re-master se nepodařilo spustit.");
      return;
    }
    setJob(data.job);
  }

  const rows: [string, ReactNode][] = health
    ? [
        [
          "Broadcaster",
          health.broadcaster.online ? (
            <span className="text-[var(--ok)]">běží{health.broadcaster.pid ? ` (PID ${health.broadcaster.pid})` : ""}</span>
          ) : (
            <span className="text-[var(--danger)]">neběží</span>
          ),
        ],
        ["Posluchači", String(health.broadcaster.listeners)],
        [
          "Knihovna",
          `${health.library.ready} hratelných · ${health.library.processed} zmasterováno` +
            (health.library.failed ? ` · ${health.library.failed} selhalo` : ""),
        ],
        ["ffmpeg", health.tools.ffmpeg ?? <span className="text-[var(--danger)]">nenalezen</span>],
        ["yt-dlp", health.tools.ytDlp ?? <span className="text-[var(--danger)]">nenalezen</span>],
        [
          "Jingly",
          health.midsong.configured
            ? `${health.midsong.count} soubor(ů) · každých ${health.midsong.minTracks}–${health.midsong.maxTracks} skladeb`
            : "nenastaveno (public/MIDSONGS-*.wav)",
        ],
      ]
    : [];

  const pct = job?.total ? Math.round((job.completed / job.total) * 100) : 0;

  return (
    <div className="space-y-12">
      <section>
        <SectionTitle>Stav</SectionTitle>
        {!health ? (
          <p className="text-sm text-[var(--ink-muted)]">Načítám…</p>
        ) : (
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[var(--ink-muted)]">{k}</dt>
                <dd className="truncate">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section>
        <SectionTitle>Re-master knihovny</SectionTitle>
        <p className="mb-4 max-w-lg text-sm text-[var(--ink-muted)]">
          Ořízne ticho, srovná hlasitost a připraví soubory pro vysílání. Hlasitost
          během vysílání navíc dorovnává engine podle změřených LUFS.
        </p>
        <div className="flex flex-wrap gap-2">
          <OutlineButton primary disabled={job?.status === "running"} onClick={() => void start(false)}>
            {job?.status === "running" ? "Běží…" : "Zmasterovat nové"}
          </OutlineButton>
          <OutlineButton disabled={job?.status === "running"} onClick={() => void start(true)}>
            Znovu všechno
          </OutlineButton>
        </div>
        {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
        {job ? (
          <div className="mt-6">
            <div className="flex justify-between text-xs text-[var(--ink-muted)]">
              <span className="truncate">{job.current ?? (job.status === "done" ? "Hotovo" : job.status)}</span>
              <span className="font-[family-name:var(--font-mono)]">{job.completed}/{job.total}</span>
            </div>
            <div className="mt-2 h-[3px] bg-[var(--line-strong)]">
              <div className="h-full bg-[var(--accent)] transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
