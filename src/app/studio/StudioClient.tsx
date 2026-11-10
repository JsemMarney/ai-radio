"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
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
import { AiDjPanel } from "@/components/studio/AiDjPanel";
import { AiHostsPanel } from "@/components/studio/AiHostsPanel";
import { ListenerChart } from "@/components/studio/ListenerChart";
import { MessagesPanel } from "@/components/studio/MessagesPanel";
import { SchedulePanel } from "@/components/studio/SchedulePanel";
import { SuggestionsPanel } from "@/components/studio/SuggestionsPanel";
import { TickerPanel } from "@/components/studio/TickerPanel";
import { useStudioMonitor } from "@/components/studio/useStudioMonitor";
import { VoiceNoteControls } from "@/components/studio/VoiceNoteControls";
import { useRadio } from "@/components/RadioProvider";
import type {
  DuplicateTrack,
  ImportJob,
  LibraryStats,
  LibraryStatsRow,
  LibraryTrack,
  RemasterJob,
  StationConfig,
  StudioHealth,
  StudioQueueItem,
} from "@/lib/types";
import {
  STUDIO_TABS,
  studioPath,
  studioTabFromPath,
  type StudioTab,
} from "@/lib/page-tabs";

type Tab = StudioTab;

async function postJson(
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string }> {
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

function SectionTitle({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
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

/**
 * Firefox si po obnovení stránky pamatuje stav tlačítek (disabled) a React pak hlásí
 * hydration error. HTML atribut autocomplete="off" to vypne (React typy ho u <button> neznají, proto spread).
 */
const NO_STATE_RESTORE = { autoComplete: "off" } as Record<string, string>;

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
      {...NO_STATE_RESTORE}
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
  aheadSec = 0,
}: {
  trackStartedAt: string | null;
  durationSec: number | null;
  /** Přímý odposlech je napřed před posluchači — odpočet podle toho, co slyší moderátor. */
  aheadSec?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const started = trackStartedAt ? Date.parse(trackStartedAt) : NaN;
  if (!durationSec || !Number.isFinite(started)) return null;
  const left = Math.max(
    0,
    Math.round(durationSec - (now - started) / 1000 - aheadSec),
  );
  const soon = left <= 30;
  return (
    <div className="shrink-0 text-left sm:text-right">
      <p className="label no-mark">Do konce</p>
      <p
        className={`text-4xl font-bold tabular-nums tracking-tight ${soon ? "text-[var(--accent-soft)]" : "text-[var(--ink)]"}`}
      >
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </p>
    </div>
  );
}

export function StudioClient({
  station,
  initialTab = "live",
}: {
  station: StationConfig;
  initialTab?: Tab;
}) {
  const {
    nowPlaying,
    trackStartedAt,
    broadcasting,
    stationOnline,
    listeners,
    segment,
    moderationPending,
  } = useRadio();
  const router = useRouter();
  const monitor = useStudioMonitor();
  const [unreadMessages, setUnreadMessages] = useState(0);
  const monitorAhead =
    monitor.state === "live" ? (monitor.listenerDelaySec ?? 0) : 0;

  const [tab, setTabState] = useState<Tab>(initialTab);
  // Každá záložka má vlastní adresu (/studio/library …) — jde sdílet, obnovit i vrátit zpět.
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    const path = studioPath(next);
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const label = STUDIO_TABS.find((t) => t.tab === tab)?.label;
    document.title = tab === "live" || !label ? "Studio" : `Studio — ${label}`;
  }, [tab]);
  useEffect(() => {
    const onPop = () => setTabState(studioTabFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [queue, setQueue] = useState<StudioQueueItem[]>([]);
  const [library, setLibrary] = useState<LibraryTrack[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [health, setHealth] = useState<StudioHealth | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
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
    say(
      r.ok,
      r.ok ? `„${title}“ hraje jako další.` : (r.error ?? "Nepovedlo se."),
    );
    void loadQueue();
  }

  async function playNow(uuid: string, title: string) {
    if (!confirm(`Pustit „${title}“ hned teď? Aktuální skladba se stáhne.`))
      return;
    const r = await postJson("/api/radio/play", { uuid });
    say(r.ok, r.ok ? `Přepínám na „${title}“.` : (r.error ?? "Nepovedlo se."));
    setTimeout(() => void loadQueue(), 1500);
  }

  async function removeFromQueue(item: StudioQueueItem) {
    setQueue((q) => q.filter((i) => i.uuid !== item.uuid));
    const r = await postJson("/api/radio/queue/remove", { uuid: item.uuid });
    if (!r.ok) say(false, r.error ?? "Odebrání selhalo.");
    void loadQueue();
  }

  async function addToQueueEnd(uuid: string, title: string) {
    const r = await postJson("/api/radio/queue/move", { uuid, toIndex: 9999 });
    say(
      r.ok,
      r.ok
        ? `„${title}“ přidáno na konec fronty.`
        : (r.error ?? "Nepovedlo se (už hraje nebo je ve frontě?)."),
    );
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
      kind === "transition"
        ? "/api/radio/test-transition"
        : "/api/radio/test-midsong",
    );
    setBusy(false);
    say(
      r.ok,
      r.ok
        ? kind === "transition"
          ? "Skáču na konec skladby — přechod uslyšíš za ~10 s."
          : "Skáču na konec skladby — za ~10 s jingle a další skladba."
        : (r.error ?? "Test selhal."),
    );
  }

  async function previewTransition() {
    if (!nowPlaying || !nextItem) return;
    setBusy(true);
    say(true, "Připravuji náhled přechodu…");
    try {
      const qs = new URLSearchParams({
        from: nowPlaying.uuid,
        to: nextItem.uuid,
        t: String(Date.now()),
      });
      const res = await fetch(`/api/radio/transition-preview?${qs}`);
      if (
        !res.ok ||
        !(res.headers.get("content-type") ?? "").includes("audio")
      ) {
        throw new Error("Náhled se nepodařilo vytvořit.");
      }
      const blob = await res.blob();
      const el = previewRef.current;
      if (!el) return;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = URL.createObjectURL(blob);
      el.src = previewUrlRef.current;
      await el.play();
      say(
        true,
        `Náhled do sluchátek: „${nowPlaying.title}“ → „${nextItem.title}“.`,
      );
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

  const queueList = !queue.length ? (
    <p className="text-sm text-[var(--ink-muted)]">
      Fronta je prázdná nebo broadcaster neběží.
    </p>
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
          dropAfter={
            dropIndex === rotation.length && index === rotation.length - 1
          }
          onDragStart={(e) => onDragStart(e, item.uuid)}
          onDragOver={(e) => onDragOver(e, index)}
          onDrop={onDrop}
          onDragEnd={() => {
            setDragUuid(null);
            setDropIndex(null);
          }}
          onUp={
            index > 0
              ? () => void moveRotation(item.uuid, index - 1)
              : undefined
          }
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
  );

  const segmentLabel =
    segment === "stinger"
      ? "jingle"
      : segment === "talk"
        ? "pauza na slovo"
        : segment === "crossfade"
          ? "přechod"
          : null;

  const noticeLine = notice ? (
    <p
      className={`mt-3 text-sm ${notice.ok ? "text-[var(--ink-muted)]" : "text-[var(--danger)]"}`}
      role="status"
    >
      {notice.text}
    </p>
  ) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg-deep)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <StationHeader config={{ ...station, tagline: "" }} compact />
            <span className="label no-mark hidden border-l border-[var(--line-strong)] pl-4 sm:inline">
              Studio
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-5">
            <LiveBadge live={onAir} listeners={listeners} />
            <Link
              href="/player"
              className="hidden text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] sm:inline"
            >
              Přehrávač
            </Link>
            <TextButton onClick={() => void logout()}>Odhlásit</TextButton>
          </div>
        </div>
        <nav
          className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-4 pb-3 sm:px-6"
          aria-label="Sekce studia"
        >
          {STUDIO_TABS.map(({ tab: key, label }) => (
            <a
              key={key}
              href={studioPath(key)}
              aria-current={tab === key ? "page" : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                setTab(key);
              }}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === key
                  ? "bg-[var(--accent)] text-[var(--ink)]"
                  : "text-[var(--ink-muted)] hover:bg-[var(--ink)]/10 hover:text-[var(--ink)]"
              }`}
            >
              {label}
              {key === "live" && moderationPending > 0 && tab !== "live" ? (
                <span className="rounded-full bg-[var(--ink)] px-1.5 text-[11px] text-[var(--bg-deep)]">
                  {moderationPending}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
      </header>

      <main
        className={`mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 ${tab === "live" ? "pb-28 lg:pb-6" : ""}`}
      >
        {tab === "live" ? (
          <div className="space-y-6">
            {/* ───────── co právě jde do éteru ───────── */}
            <Card>
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="w-24 shrink-0 sm:w-28">
                  <Cover
                    src={nowPlaying?.thumbnail}
                    size="lg"
                    className="rounded-xl"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <LevelMeter active={onAir} />
                    <span className="label no-mark">Ve vysílání</span>
                    {segmentLabel ? (
                      <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-soft)]">
                        {segmentLabel}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-3xl">
                    {nowPlaying?.title ?? (onAir ? "Ladím…" : "Nevysílá se")}
                  </p>
                  <p className="truncate text-sm text-[var(--ink-muted)]">
                    {nowPlaying?.artist ?? "Spusť broadcaster (start.bat)"}
                  </p>
                </div>
                {nowPlaying && segment !== "talk" ? (
                  <TimeLeft
                    trackStartedAt={trackStartedAt}
                    durationSec={nowPlaying.durationSec ?? null}
                    aheadSec={monitorAhead}
                  />
                ) : null}
              </div>
              <div className="mt-5">
                <TrackTimeline
                  trackId={nowPlaying?.uuid ?? null}
                  trackStartedAt={trackStartedAt}
                  durationSec={nowPlaying?.durationSec ?? null}
                  active={Boolean(nowPlaying && broadcasting)}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                <OutlineButton
                  primary
                  onClick={() => void skip()}
                  disabled={!onAir}
                >
                  Další skladba
                </OutlineButton>
                <OutlineButton
                  onClick={monitor.toggle}
                  disabled={monitor.state === "connecting"}
                >
                  <span className="inline-flex items-center gap-2">
                    <LevelMeter active={monitor.state === "live"} />
                    {monitor.state === "connecting"
                      ? "Připojuji…"
                      : monitor.state === "live"
                        ? "Vypnout odposlech"
                        : "Odposlech živě"}
                  </span>
                </OutlineButton>
                {monitor.state === "live" ? (
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={monitor.volume}
                    onChange={(e) => monitor.setVolume(Number(e.target.value))}
                    className="broadcast-range w-24"
                    style={
                      {
                        "--fill": `${Math.round(monitor.volume * 100)}%`,
                      } as CSSProperties
                    }
                    aria-label="Hlasitost odposlechu"
                  />
                ) : null}
                {nextItem ? (
                  <p className="min-w-0 truncate text-sm text-[var(--ink-muted)]">
                    Potom:{" "}
                    <span className="text-[var(--ink)]">
                      {nextItem.artist} — {nextItem.title}
                    </span>
                  </p>
                ) : null}
              </div>
              {monitor.state === "live" ? (
                <p className="mt-3 text-xs text-[var(--ink-muted)]">
                  Slyšíš vysílání bez zpoždění (bez svého mikrofonu). Posluchači
                  to slyší asi o {Math.round(monitor.listenerDelaySec ?? 3)} s
                  později — odpočet ukazuje tvůj čas.
                </p>
              ) : monitor.error ? (
                <p className="mt-3 text-sm text-[var(--danger)]">
                  {monitor.error}
                </p>
              ) : null}
              {noticeLine}
              {nowPlaying?.dedication ? (
                <>
                  <DedicationNote
                    dedication={nowPlaying.dedication}
                    large
                    title="Přečti do éteru"
                  />
                  {nowPlaying.dedication.voiceId ? (
                    <VoiceNoteControls id={nowPlaying.dedication.voiceId} />
                  ) : null}
                </>
              ) : null}
            </Card>

            {/* Na telefonu jeden sloupec seřazený podle důležitosti (order), na PC tři sloupce:
                hudba (fronta) · do éteru (mikrofon, pauza, AI) · posluchači (přání, vzkazy, pruh). */}
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="contents lg:block lg:min-w-0 lg:space-y-6">
                <p className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)] lg:block">
                  Hudba
                </p>
                <Card className="order-5 lg:order-none">
                  <SectionTitle
                    aside={
                      <span className="text-xs text-[var(--ink-faint)]">
                        přetáhni pro pořadí
                      </span>
                    }
                  >
                    Fronta
                  </SectionTitle>
                  <QueueAdd
                    library={library}
                    inQueue={
                      new Set([
                        ...queue.map((q) => q.uuid),
                        nowPlaying?.uuid ?? "",
                      ])
                    }
                    onNext={(t) => void playNext(t.uuid, t.title)}
                    onEnd={(t) => void addToQueueEnd(t.uuid, t.title)}
                  />
                  <div className="lg:max-h-[34rem] lg:overflow-y-auto lg:pr-1">
                    {queueList}
                  </div>
                </Card>
                <Card className="order-7 lg:order-none">
                  <SchedulePanel library={library} />
                </Card>
              </div>
              <div className="contents lg:block lg:min-w-0 lg:space-y-6">
                <p className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)] lg:block">
                  Do éteru
                </p>
                <Card id="studio-mic" className="order-2 lg:order-none">
                  <MicPanel />
                </Card>
                <Card className="order-4 lg:order-none">
                  <BreakPanel
                    library={library}
                    nextTitle={
                      nextItem ? `${nextItem.artist} — ${nextItem.title}` : null
                    }
                  />
                </Card>
                <Card className="order-9 lg:order-none">
                  <AiDjPanel />
                </Card>
              </div>
              <div className="contents lg:block lg:min-w-0 lg:space-y-6">
                <p className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)] lg:block">
                  Posluchači
                </p>
                <Card id="studio-requests" className="order-1 lg:order-none">
                  <RequestModeration />
                </Card>
                <Card id="studio-messages" className="order-3 lg:order-none">
                  <MessagesPanel onUnread={setUnreadMessages} />
                </Card>
                <Card className="order-6 lg:order-none">
                  <SuggestionsPanel />
                </Card>
                <Card className="order-8 lg:order-none">
                  <TickerPanel />
                </Card>
              </div>
            </div>

            {/* Telefon: rychlé ovládání palcem — mikrofon, další skladba, přání, vzkazy. */}
            <nav
              className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--bg-deep)]/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
              aria-label="Rychlé ovládání"
            >
              <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
                <MobileAction
                  label="Mikrofon"
                  onClick={() => scrollToCard("studio-mic")}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0014 0M12 18v3" />
                  </svg>
                </MobileAction>
                <MobileAction
                  label="Další"
                  onClick={() => void skip()}
                  primary
                  disabled={!onAir}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M5 5.5v13l9-6.5-9-6.5zM16 5h3v14h-3z" />
                  </svg>
                </MobileAction>
                <MobileAction
                  label="Přání"
                  badge={moderationPending}
                  onClick={() => scrollToCard("studio-requests")}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </MobileAction>
                <MobileAction
                  label="Vzkazy"
                  badge={unreadMessages}
                  onClick={() => scrollToCard("studio-messages")}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </MobileAction>
              </div>
            </nav>
          </div>
        ) : tab === "hosts" ? (
          <AiHostsPanel />
        ) : tab === "library" ? (
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
          <StatsTab
            stats={stats}
            onNext={(r) => void playNext(r.uuid, r.title)}
            onDeleted={() => {
              void loadLibrary();
              void loadQueue();
              void loadStats();
            }}
          />
        ) : tab === "import" ? (
          <ImportTab
            onDone={() => {
              void loadLibrary();
              void loadStats();
            }}
          />
        ) : (
          <div className="space-y-12">
            <section>
              <SectionTitle>Testy přechodů</SectionTitle>
              <p className="mb-4 max-w-lg text-sm text-[var(--ink-muted)]">
                Náhled přechodu hraje jen do tvých sluchátek. Testy naživo skočí
                na konec skladby ve vysílání.
              </p>
              <div className="flex flex-wrap gap-2">
                <OutlineButton
                  disabled={busy || !nowPlaying || !nextItem}
                  onClick={() => void previewTransition()}
                >
                  Náhled přechodu
                </OutlineButton>
                <OutlineButton
                  disabled={busy || !onAir}
                  onClick={() => void runTest("transition")}
                >
                  Test přechodu naživo
                </OutlineButton>
                <OutlineButton
                  disabled={busy || !onAir || !health?.midsong.configured}
                  onClick={() => void runTest("jingle")}
                >
                  Test jinglu naživo
                </OutlineButton>
              </div>
              {noticeLine}
            </section>
            <SystemTab
              health={health}
              onRemasterDone={() => {
                void loadLibrary();
                void loadHealth();
              }}
            />
          </div>
        )}
        <audio ref={previewRef} className="hidden" preload="none" />
      </main>
    </div>
  );
}

function Card({
  children,
  id,
  className = "",
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={`min-w-0 scroll-mt-32 rounded-2xl border border-[var(--line)] bg-[var(--bg-mid)] p-5 sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

function scrollToCard(id: string): void {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function MobileAction({
  label,
  children,
  onClick,
  badge = 0,
  primary = false,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  badge?: number;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...NO_STATE_RESTORE}
      className={`relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition-colors disabled:opacity-40 ${
        primary
          ? "bg-[var(--accent)] text-[var(--ink)]"
          : "bg-[var(--bg-mid)] text-[var(--ink)]"
      }`}
    >
      {children}
      {label}
      {badge > 0 ? (
        <span className="absolute right-2 top-1.5 min-w-[18px] rounded-full bg-[var(--accent)] px-1 text-[10px] leading-[18px] text-[var(--ink)]">
          {badge}
        </span>
      ) : null}
    </button>
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
      {dropBefore ? (
        <span className="absolute inset-x-0 -top-px h-0.5 bg-[var(--accent)]" />
      ) : null}
      {dropAfter ? (
        <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--accent)]" />
      ) : null}
      <span
        className="w-4 shrink-0 text-center text-[var(--ink-faint)]"
        aria-hidden
      >
        {draggable ? "⋮⋮" : ""}
      </span>
      <Cover src={item.thumbnail} size="sm" className="rounded-[2px]" />
      <div className="min-w-0 flex-1">
        {item.handoverBefore ? (
          <p
            className="truncate text-[11px] font-semibold text-[var(--accent)]"
            title={`Předávka směny: ${item.handoverBefore}`}
          >
            ⇄ {item.handoverBefore}
          </p>
        ) : null}
        {item.aiBefore ? (
          <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-2)]">
            AI · {item.aiBefore}
          </p>
        ) : null}
        <p className="truncate text-sm">
          {item.stingerBefore ? (
            <span className="mr-1.5 text-xs uppercase tracking-wider text-[var(--ink-faint)]">
              jingle ·
            </span>
          ) : null}
          {item.title}
        </p>
        <p className="truncate text-xs text-[var(--ink-muted)]">
          {item.artist}
          {badge ? (
            <span className="text-[var(--accent)]"> · {badge}</span>
          ) : null}
        </p>
      </div>
      <span className="hidden shrink-0 text-right font-[family-name:var(--font-mono)] text-xs text-[var(--ink-faint)] [@media(hover:hover)]:block [@media(hover:hover)]:group-hover:hidden">
        {item.startsAtMs ? (
          <span className="block text-[var(--ink-muted)]">
            {new Date(item.startsAtMs).toLocaleTimeString("cs-CZ", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : null}
        {formatLength(item.durationSec)}
      </span>
      <div className="flex shrink-0 items-center gap-3 [@media(hover:hover)]:hidden [@media(hover:hover)]:group-hover:flex [@media(hover:hover)]:group-focus-within:flex">
        {onUp ? (
          <TextButton title="Posunout výš" onClick={onUp}>
            ↑
          </TextButton>
        ) : null}
        {onDown ? (
          <TextButton title="Posunout níž" onClick={onDown}>
            ↓
          </TextButton>
        ) : null}
        {onNext ? <TextButton onClick={onNext}>Jako další</TextButton> : null}
        {onNow ? <TextButton onClick={onNow}>Teď</TextButton> : null}
        <TextButton danger onClick={onRemove}>
          Odebrat
        </TextButton>
      </div>
    </li>
  );
}

/** Rychlé přidání do fronty: hledání v knihovně → „Jako další“ / „Na konec“. */
function QueueAdd({
  library,
  inQueue,
  onNext,
  onEnd,
}: {
  library: LibraryTrack[];
  inQueue: Set<string>;
  onNext: (t: LibraryTrack) => void;
  onEnd: (t: LibraryTrack) => void;
}) {
  const [q, setQ] = useState("");
  const norm = (t: string) =>
    t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const needle = norm(q.trim());
  const hits = needle
    ? library
        .filter(
          (t) =>
            t.status === "ready" &&
            norm(`${t.artist} ${t.title}`).includes(needle),
        )
        .slice(0, 6)
    : [];
  return (
    <div className="mb-4">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="＋ Přidat do fronty — hledej písničku…"
        aria-label="Přidat do fronty"
        className="w-full rounded-full border border-[var(--line-strong)] bg-[var(--bg-deep)] px-4 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
      />
      {needle ? (
        <ul className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--bg-deep)]/60 px-2">
          {hits.length ? (
            hits.map((t) => (
              <li
                key={t.uuid}
                className="flex items-center gap-2 border-t border-[var(--line)] py-1.5 first:border-t-0"
              >
                <Cover src={t.thumbnail} size="sm" className="rounded-[2px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{t.title}</p>
                  <p className="truncate text-xs text-[var(--ink-muted)]">
                    {t.artist}
                  </p>
                </div>
                {inQueue.has(t.uuid) ? (
                  <span className="shrink-0 text-xs text-[var(--ink-faint)]">
                    ve frontě
                  </span>
                ) : (
                  <span className="flex shrink-0 gap-2">
                    <TextButton
                      onClick={() => {
                        onNext(t);
                        setQ("");
                      }}
                    >
                      Jako další
                    </TextButton>
                    <TextButton
                      onClick={() => {
                        onEnd(t);
                        setQ("");
                      }}
                    >
                      Na konec
                    </TextButton>
                  </span>
                )}
              </li>
            ))
          ) : (
            <li className="py-3 text-center text-xs text-[var(--ink-muted)]">
              Nic nenalezeno.
            </li>
          )}
        </ul>
      ) : null}
    </div>
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
  const [sort, setSort] = useState<"new" | "plays" | "artist" | "title">("new");
  const [page, setPage] = useState(0);
  const PAGE = 30;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? library.filter((t) =>
          `${t.title} ${t.artist} ${t.album ?? ""}`.toLowerCase().includes(q),
        )
      : library;
    const sorted = [...filtered];
    if (sort === "plays") {
      sorted.sort(
        (a, b) =>
          (statsByUuid.get(b.uuid)?.plays ?? 0) -
          (statsByUuid.get(a.uuid)?.plays ?? 0),
      );
    } else if (sort === "artist") {
      sorted.sort((a, b) => a.artist.localeCompare(b.artist, "cs"));
    } else if (sort === "title") {
      sorted.sort((a, b) => a.title.localeCompare(b.title, "cs"));
    }
    return sorted;
  }, [library, search, sort, statsByUuid]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const pageRows = rows.slice(current * PAGE, current * PAGE + PAGE);

  async function remove(track: LibraryTrack) {
    if (
      !confirm(
        `Smazat „${track.title}“ z knihovny? Soubor se odstraní z disku.`,
      )
    )
      return;
    const res = await fetch(`/api/library/${track.uuid}`, { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    say(
      res.ok,
      res.ok ? `„${track.title}“ smazáno.` : (data.error ?? "Smazání selhalo."),
    );
    if (res.ok) onDeleted();
  }

  return (
    <section id="studio-library-top" className="scroll-mt-32">
      <div className="mb-9 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Figure value={String(library.length)} label="skladeb" />
        <Figure
          value={stats ? stats.libraryHours.toFixed(1).replace(".", ",") : "–"}
          label="hodin hudby"
        />
        <Figure
          value={stats ? String(stats.totalPlays) : "–"}
          label="odehráno"
        />
        <Figure
          value={String(moderationPending)}
          label="přání čeká"
          accent={moderationPending > 0}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={`Hledat v ${library.length} skladbách`}
          className="min-w-0 flex-1 border-b border-[var(--line-strong)] bg-transparent py-2 text-sm outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
        />
        <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          Řadit
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as typeof sort);
              setPage(0);
            }}
            className="border-b border-[var(--line-strong)] bg-transparent py-1 text-[var(--ink)] outline-none"
          >
            <option value="new" className="bg-[var(--bg-panel)]">
              nejnovější
            </option>
            <option value="plays" className="bg-[var(--bg-panel)]">
              nejhranější
            </option>
            <option value="artist" className="bg-[var(--bg-panel)]">
              interpret
            </option>
            <option value="title" className="bg-[var(--bg-panel)]">
              název
            </option>
          </select>
        </label>
        <OutlineButton
          onClick={async () => {
            if (
              !confirm(
                "Vynulovat statistiky přehrání? Počty přehrání a přeskočení se smažou (přání zůstanou) a rotace začne míchat celou knihovnu rovnoměrně od začátku.",
              )
            )
              return;
            const res = await fetch("/api/radio/stats/reset", {
              method: "POST",
            });
            const data = (await res.json().catch(() => ({}))) as {
              tracks?: number;
              error?: string;
            };
            say(
              res.ok,
              res.ok
                ? `Statistiky vynulovány (${data.tracks ?? 0} skladeb) — rotace míchá znovu.`
                : (data.error ?? "Nepovedlo se."),
            );
            if (res.ok) onDeleted();
          }}
        >
          Vynulovat přehrání
        </OutlineButton>
        <OutlineButton primary onClick={onAdd}>
          Přidat skladby
        </OutlineButton>
      </div>

      {!rows.length ? (
        <p className="py-10 text-center text-sm text-[var(--ink-muted)]">
          {library.length
            ? "Nic nenalezeno."
            : "Knihovna je prázdná — klikni na „Přidat skladby“."}
        </p>
      ) : (
        <>
          <ul>
            {pageRows.map((t) => {
              const s = statsByUuid.get(t.uuid);
              const playable = t.status === "ready" && Boolean(t.audioFile);
              const isOnAir = t.uuid === nowPlayingUuid;
              return (
                <li
                  key={t.uuid}
                  className="group flex items-center gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0"
                >
                  <Cover
                    src={t.thumbnail}
                    size="sm"
                    className="rounded-[2px]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {t.title}
                      {isOnAir ? (
                        <span className="ml-2 text-xs text-[var(--accent)]">
                          ve vysílání
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-[var(--ink-muted)]">
                      {t.artist}
                      {s?.broken ? (
                        <span className="text-[var(--danger)]">
                          {" "}
                          · {s.broken.reason}
                        </span>
                      ) : null}
                      {!playable && !s?.broken ? (
                        <span className="text-[var(--danger)]">
                          {" "}
                          · nelze přehrát
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="hidden shrink-0 items-center gap-5 font-[family-name:var(--font-mono)] text-xs tabular-nums text-[var(--ink-faint)] sm:flex group-hover:hidden">
                    <span title="Počet odehrání">{s?.plays ?? 0}×</span>
                    <span className="w-10 text-right">
                      {formatLength(t.playDuration ?? t.duration)}
                    </span>
                  </div>
                  <div className="hidden shrink-0 items-center gap-4 group-hover:flex group-focus-within:flex">
                    <TextButton disabled={!playable} onClick={() => onNext(t)}>
                      Jako další
                    </TextButton>
                    <TextButton disabled={!playable} onClick={() => onNow(t)}>
                      Teď
                    </TextButton>
                    <TextButton danger onClick={() => void remove(t)}>
                      Smazat
                    </TextButton>
                  </div>
                </li>
              );
            })}
          </ul>
          <Pager
            page={current}
            pages={pages}
            total={rows.length}
            perPage={PAGE}
            onPage={(n) => {
              setPage(n);
              document
                .getElementById("studio-library-top")
                ?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
          />
        </>
      )}
    </section>
  );
}

/** Stránkování: ‹ 1 2 … 7 8 9 … 20 › + „31–60 z 412“. */
function Pager({
  page,
  pages,
  total,
  perPage,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  onPage: (n: number) => void;
}) {
  if (pages <= 1) return null;
  const nums: (number | "…")[] = [];
  for (let i = 0; i < pages; i++) {
    if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const btn =
    "min-w-9 rounded-full px-3 py-1.5 text-sm tabular-nums transition-colors disabled:opacity-30";
  return (
    <nav
      className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4"
      aria-label="Stránky"
    >
      <p className="text-xs text-[var(--ink-faint)] tabular-nums">
        {page * perPage + 1}–{Math.min(total, (page + 1) * perPage)} z {total}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={`${btn} text-[var(--ink-muted)] hover:text-[var(--ink)]`}
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          aria-label="Předchozí"
        >
          ‹
        </button>
        {nums.map((n, i) =>
          n === "…" ? (
            <span key={`gap-${i}`} className="px-1 text-[var(--ink-faint)]">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onPage(n)}
              aria-current={n === page ? "page" : undefined}
              className={`${btn} ${n === page ? "bg-[var(--accent)] font-semibold text-white" : "text-[var(--ink-muted)] hover:bg-[var(--bg-deep)] hover:text-[var(--ink)]"}`}
            >
              {n + 1}
            </button>
          ),
        )}
        <button
          type="button"
          className={`${btn} text-[var(--ink-muted)] hover:text-[var(--ink)]`}
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
          aria-label="Další"
        >
          ›
        </button>
      </div>
    </nav>
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

/** Stejná skladba vícekrát v knihovně — první kopie se hraje, ostatní jdou smazat. */
function DuplicatesSection({
  groups,
  onDeleted,
}: {
  groups: DuplicateTrack[][];
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(t: DuplicateTrack) {
    if (
      !confirm(
        `Smazat kopii „${t.title}“ (${t.album ?? "bez alba"})? Soubor se odstraní z disku.`,
      )
    )
      return;
    setBusy(t.uuid);
    setError(null);
    const res = await fetch(`/api/library/${t.uuid}`, { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!res.ok) setError(data.error ?? "Smazání selhalo.");
    else onDeleted();
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/60 p-5">
      <SectionTitle
        aside={
          <span className="text-xs text-[var(--ink-faint)]">
            {groups.length} skladeb
          </span>
        }
      >
        Duplicity
      </SectionTitle>
      {!groups.length ? (
        <p className="text-sm text-[var(--ink-muted)]">
          Žádné — každá skladba je v knihovně jen jednou.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-[var(--ink-muted)]">
            Stejná skladba ve víc verzích (single × album, remaster). V rotaci
            hraje jen první kopie; ostatní můžeš smazat.
          </p>
          <ul className="space-y-4">
            {groups.map((group) => (
              <li
                key={group[0]!.uuid}
                className="border-t border-[var(--line)] pt-3 first:border-t-0 first:pt-0"
              >
                <p className="text-sm">
                  {group[0]!.title}{" "}
                  <span className="text-[var(--ink-muted)]">
                    — {group[0]!.artist}
                  </span>
                </p>
                <ul className="mt-1">
                  {group.map((t, i) => (
                    <li
                      key={t.uuid}
                      className="flex items-center gap-3 py-1 text-xs"
                    >
                      <Cover
                        src={t.thumbnail}
                        size="sm"
                        className="rounded-[2px]"
                      />
                      <span className="min-w-0 flex-1 truncate text-[var(--ink-muted)]">
                        {t.album ?? "bez alba"} · {t.plays}× · přidáno{" "}
                        {new Date(t.createdAt).toLocaleDateString("cs-CZ")}
                      </span>
                      {i === 0 ? (
                        <span className="shrink-0 text-[var(--ok)]">
                          hraje se
                        </span>
                      ) : (
                        <TextButton
                          danger
                          disabled={busy === t.uuid}
                          onClick={() => void remove(t)}
                        >
                          {busy === t.uuid ? "Mažu…" : "Smazat"}
                        </TextButton>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {error ? (
            <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

function StatsTab({
  stats,
  onNext,
  onDeleted,
}: {
  stats: LibraryStats | null;
  onNext: (row: LibraryStatsRow) => void;
  onDeleted: () => void;
}) {
  if (!stats) {
    return (
      <p className="text-sm text-[var(--ink-muted)]">
        Načítám… (statistiky dává broadcaster)
      </p>
    );
  }

  const rows = stats.rows;
  const top = [...rows]
    .filter((r) => r.plays > 0)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 8);
  const never = rows.filter((r) => r.plays === 0 && !r.broken);
  const broken = rows.filter((r) => r.broken);
  const maxPlays = top[0]?.plays ?? 1;
  // Interpreti podle součtu přehrání (hlavní interpret, bez hostů).
  const byArtist = new Map<
    string,
    { plays: number; tracks: number; thumb: string | null }
  >();
  for (const r of rows) {
    const name =
      (String(r.artist ?? "").split(/,|&|\sfeat\.?\s/i)[0] ?? "").trim() || "Neznámý";
    const a = byArtist.get(name) ?? { plays: 0, tracks: 0, thumb: r.thumbnail };
    a.plays += r.plays;
    a.tracks += 1;
    byArtist.set(name, a);
  }
  const topArtists = [...byArtist.entries()]
    .filter(([, a]) => a.plays > 0)
    .sort((a, b) => b[1].plays - a[1].plays)
    .slice(0, 8);
  const maxArtist = topArtists[0]?.[1].plays || 1;
  const avgPlays = rows.length ? stats.totalPlays / rows.length : 0;

  const panel =
    "rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/60 p-5";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            [String(rows.length), "skladeb v knihovně"],
            [stats.libraryHours.toFixed(1).replace(".", ","), "hodin hudby"],
            [stats.totalPlays.toLocaleString("cs-CZ"), "odehráno celkem"],
            [
              avgPlays.toFixed(1).replace(".", ","),
              "průměrně přehrání na skladbu",
            ],
          ] as [string, string][]
        ).map(([value, label]) => (
          <div key={label} className={panel}>
            <p className="font-[family-name:var(--font-mono)] text-3xl font-semibold tabular-nums text-[var(--ink)]">
              {value}
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{label}</p>
          </div>
        ))}
      </div>

      <section className={panel}>
        <SectionTitle>Posluchači podle hodiny</SectionTitle>
        <ListenerChart />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={panel}>
          <SectionTitle>Nejhranější skladby</SectionTitle>
          {!top.length ? (
            <p className="text-sm text-[var(--ink-muted)]">
              Zatím nic — statistiky se sbírají od teď.
            </p>
          ) : (
            <ol>
              {top.map((r, i) => (
                <li
                  key={r.uuid}
                  className="flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0"
                >
                  <span className="w-5 shrink-0 text-right font-[family-name:var(--font-mono)] text-xs text-[var(--ink-faint)]">
                    {i + 1}
                  </span>
                  <Cover
                    src={r.thumbnail}
                    size="sm"
                    className="rounded-[4px]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {r.title}{" "}
                      <span className="text-[var(--ink-muted)]">
                        — {r.artist}
                      </span>
                    </p>
                    <div className="mt-1.5 h-1 rounded-full bg-[var(--line)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${(r.plays / maxPlays) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-28 shrink-0 text-right font-[family-name:var(--font-mono)] text-xs text-[var(--ink-muted)]">
                    <span className="text-[var(--ink)]">{r.plays}×</span> ·{" "}
                    {relativeDay(r.lastPlayedAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={panel}>
          <SectionTitle>Nejhranější interpreti</SectionTitle>
          {!topArtists.length || topArtists[0]![1].plays === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Zatím nic.</p>
          ) : (
            <ol>
              {topArtists.map(([name, a], i) => (
                <li
                  key={name}
                  className="flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0"
                >
                  <span className="w-5 shrink-0 text-right font-[family-name:var(--font-mono)] text-xs text-[var(--ink-faint)]">
                    {i + 1}
                  </span>
                  <Cover src={a.thumb} size="sm" className="rounded-full" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{name}</p>
                    <div className="mt-1.5 h-1 rounded-full bg-[var(--line)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${(a.plays / maxArtist) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-28 shrink-0 text-right font-[family-name:var(--font-mono)] text-xs text-[var(--ink-muted)]">
                    <span className="text-[var(--ink)]">{a.plays}×</span> ·{" "}
                    {a.tracks}{" "}
                    {a.tracks === 1
                      ? "skladba"
                      : a.tracks < 5
                        ? "skladby"
                        : "skladeb"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className={panel}>
        <SectionTitle
          aside={
            <span className="text-xs text-[var(--ink-faint)]">
              {never.length} skladeb
            </span>
          }
        >
          Ještě nehrály
        </SectionTitle>
        {!never.length ? (
          <p className="text-sm text-[var(--ink-muted)]">Všechno už zaznělo.</p>
        ) : (
          <ul>
            {never.slice(0, 12).map((r) => (
              <li
                key={r.uuid}
                className="group flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0"
              >
                <Cover src={r.thumbnail} size="sm" className="rounded-[2px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{r.title}</p>
                  <p className="truncate text-xs text-[var(--ink-muted)]">
                    {r.artist}
                  </p>
                </div>
                <TextButton onClick={() => onNext(r)}>Jako další</TextButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DuplicatesSection
        groups={stats.duplicates ?? []}
        onDeleted={onDeleted}
      />

      <section className={panel}>
        <SectionTitle>Problémy</SectionTitle>
        {!broken.length ? (
          <p className="text-sm text-[var(--ink-muted)]">
            Žádné — všechny skladby jdou přehrát.
          </p>
        ) : (
          <ul>
            {broken.map((r) => (
              <li
                key={r.uuid}
                className="flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {r.title}{" "}
                    <span className="text-[var(--ink-muted)]">
                      — {r.artist}
                    </span>
                  </p>
                  <p className="truncate text-xs text-[var(--danger)]">
                    {r.broken!.reason}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-[var(--ink-faint)]">
                  {relativeDay(r.broken!.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {broken.length ? (
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            Rotace je přeskakuje. Pomůže re-master v záložce Systém, nebo
            skladbu smazat a stáhnout znovu.
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
  // Odkazy, které se právě načítají ze Spotify — dá se mezitím vložit další.
  const [submitting, setSubmitting] = useState<{ key: number; url: string }[]>(
    [],
  );
  const [errors, setErrors] = useState<
    { key: number; url: string; text: string }[]
  >([]);
  // Importy ze serveru (i z dřívějška) — po přepnutí záložky nezmizí.
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const keyRef = useRef(0);
  const activeIdsRef = useRef<Set<string>>(new Set());

  const isActive = (j: ImportJob) =>
    j.status === "running" || j.status === "queued";
  const anyActive = jobs.some(isActive) || submitting.length > 0;

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs?: ImportJob[] };
      const list = [...(data.jobs ?? [])].reverse(); // nejstarší nahoře = pořadí stahování
      const nowActive = new Set(list.filter(isActive).map((j) => j.id));
      const finished = [...activeIdsRef.current].some(
        (id) => !nowActive.has(id),
      );
      activeIdsRef.current = nowActive;
      setJobs(list);
      if (finished) onDone();
    } catch {
      // offline
    }
  }, [onDone]);

  useEffect(() => {
    const first = setTimeout(() => void loadJobs(), 0);
    return () => clearTimeout(first);
  }, [loadJobs]);

  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => void loadJobs(), 1500);
    return () => clearInterval(timer);
  }, [anyActive, loadJobs]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const link = url.trim();
    if (!link) return;
    const key = ++keyRef.current;
    setUrl("");
    setSubmitting((s) => [...s, { key, url: link }]);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Import selhal.");
      await loadJobs();
    } catch (err) {
      setErrors((list) => [
        ...list,
        {
          key,
          url: link,
          text: err instanceof Error ? err.message : "Import selhal.",
        },
      ]);
    } finally {
      setSubmitting((s) => s.filter((x) => x.key !== key));
    }
  }

  const active = jobs.filter(isActive);
  const totals = active.reduce(
    (acc, j) => ({ done: acc.done + j.completed, all: acc.all + j.total }),
    { done: 0, all: 0 },
  );
  const focus =
    jobs.find((j) => j.status === "running") ??
    active[0] ??
    jobs.at(-1) ??
    null;

  return (
    <section>
      <p className="mb-6 max-w-lg text-sm text-[var(--ink-muted)]">
        Vkládej odkazy na skladby, alba nebo playlisty ze Spotify klidně jeden
        po druhém — řadí se do fronty a stahují postupně. Delší playlist (až 500
        skladeb) se sám rozdělí na části po 50.
      </p>
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://open.spotify.com/playlist/…"
          className="min-w-0 flex-1 border-b border-[var(--line-strong)] bg-transparent py-2 text-sm outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
        />
        <OutlineButton type="submit" primary disabled={!url.trim()}>
          {anyActive ? "Přidat do fronty" : "Stáhnout"}
        </OutlineButton>
      </form>

      {submitting.length ? (
        <ul className="mt-3 space-y-1">
          {submitting.map((s) => (
            <li
              key={s.key}
              className="truncate text-xs text-[var(--ink-muted)]"
            >
              Načítám ze Spotify…{" "}
              <span className="text-[var(--ink-faint)]">{s.url}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {errors.length ? (
        <ul className="mt-3 space-y-1" role="alert">
          {errors.map((er) => (
            <li
              key={er.key}
              className="flex items-start justify-between gap-3 text-sm text-[var(--danger)]"
            >
              <span className="min-w-0">
                {er.text}{" "}
                <span className="block truncate text-xs text-[var(--ink-faint)]">
                  {er.url}
                </span>
              </span>
              <TextButton
                onClick={() =>
                  setErrors((list) => list.filter((x) => x.key !== er.key))
                }
              >
                Zavřít
              </TextButton>
            </li>
          ))}
        </ul>
      ) : null}

      {jobs.length ? (
        <div className="mt-10">
          <div className="flex items-baseline justify-between gap-3">
            <p className="label">Fronta stahování</p>
            {active.length ? (
              <span className="shrink-0 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-muted)]">
                zbývá {totals.all - totals.done} skladeb
              </span>
            ) : null}
          </div>
          <ul className="mt-2">
            {jobs.map((j) => {
              const pct = j.total
                ? Math.round((j.completed / j.total) * 100)
                : 0;
              return (
                <li
                  key={j.id}
                  className="border-t border-[var(--line)] py-2 first:border-t-0"
                >
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span
                      className={`truncate ${j.id === focus?.id ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"}`}
                    >
                      {j.title}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                      {j.status === "queued"
                        ? "čeká"
                        : j.status === "running"
                          ? `${j.completed}/${j.total}`
                          : j.status === "failed"
                            ? j.error?.startsWith("Přerušeno")
                              ? "přerušeno"
                              : "selhalo"
                            : `hotovo ${j.completed - j.failed}/${j.total}`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-[3px] bg-[var(--line-strong)]">
                    <div
                      className="h-full bg-[var(--accent)] transition-[width]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {focus ? <ImportJobDetail job={focus} /> : null}
    </section>
  );
}

function ImportJobDetail({ job }: { job: ImportJob }) {
  const running = job.status === "running" || job.status === "queued";
  const pct = job.total ? Math.round((job.completed / job.total) * 100) : 0;
  return (
    <div className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate font-medium">{job.title}</p>
        <span className="shrink-0 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-muted)]">
          {job.completed}/{job.total}
        </span>
      </div>
      <div className="mt-2 h-[3px] bg-[var(--line-strong)]">
        <div
          className="h-full bg-[var(--accent)] transition-[width]"
          style={{ width: `${pct}%` }}
        />
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
                {item.title}{" "}
                <span className="text-[var(--ink-muted)]">— {item.artist}</span>
              </span>
              <span
                className={`shrink-0 ${
                  item.status === "failed"
                    ? "text-[var(--danger)]"
                    : "text-[var(--ink-muted)]"
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
            <span className="text-[var(--ok)]">
              běží
              {health.broadcaster.pid ? ` (PID ${health.broadcaster.pid})` : ""}
            </span>
          ) : (
            <span className="text-[var(--danger)]">neběží</span>
          ),
        ],
        ["Posluchači", String(health.broadcaster.listeners)],
        [
          "Knihovna",
          `${health.library.ready} hratelných · ${health.library.processed} zmasterováno` +
            (health.library.failed
              ? ` · ${health.library.failed} selhalo`
              : ""),
        ],
        [
          "ffmpeg",
          health.tools.ffmpeg ?? (
            <span className="text-[var(--danger)]">nenalezen</span>
          ),
        ],
        [
          "yt-dlp",
          health.tools.ytDlp ?? (
            <span className="text-[var(--danger)]">nenalezen</span>
          ),
        ],
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
          Ořízne ticho, srovná hlasitost a připraví soubory pro vysílání.
          Hlasitost během vysílání navíc dorovnává engine podle změřených LUFS.
        </p>
        <div className="flex flex-wrap gap-2">
          <OutlineButton
            primary
            disabled={job?.status === "running"}
            onClick={() => void start(false)}
          >
            {job?.status === "running" ? "Běží…" : "Zmasterovat nové"}
          </OutlineButton>
          <OutlineButton
            disabled={job?.status === "running"}
            onClick={() => void start(true)}
          >
            Znovu všechno
          </OutlineButton>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
        ) : null}
        {job ? (
          <div className="mt-6">
            <div className="flex justify-between text-xs text-[var(--ink-muted)]">
              <span className="truncate">
                {job.current ?? (job.status === "done" ? "Hotovo" : job.status)}
              </span>
              <span className="font-[family-name:var(--font-mono)]">
                {job.completed}/{job.total}
              </span>
            </div>
            <div className="mt-2 h-[3px] bg-[var(--line-strong)]">
              <div
                className="h-full bg-[var(--accent)] transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
