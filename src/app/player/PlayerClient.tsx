"use client";

import Link from "next/link";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useState } from "react";
import {
  LISTENER_TABS,
  listenerTabFromPath,
  playerPath,
  type ListenerTab,
} from "@/lib/page-tabs";
import {
  ListenButton,
  NowPlaying,
  ProgramLog,
  StationHeader,
  VolumeControl,
} from "@/components/player/BroadcastUi";
import { SongRequestPanel } from "@/components/player/SongRequestPanel";
import { SuggestPanel } from "@/components/player/SuggestPanel";
import { QuizPanel } from "@/components/player/QuizPanel";
import { ActivitiesPanel } from "@/components/player/ActivitiesPanel";
import { InstallPrompt } from "@/components/player/InstallPrompt";
import { useRadio } from "@/components/RadioProvider";
import { useCoverTint } from "@/components/player/useCoverTint";
import type { StationConfig } from "@/lib/types";

function StationClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const timer = setInterval(() => setNow(new Date()), 5_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  if (!now) return null;
  return (
    <span className="hidden tabular-nums text-[var(--ink)] sm:inline">
      {now.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

/** Kolikrát zopakovat texty v jedné polovině pásu, aby byla delší než nejširší obrazovka. */
const TICKER_REPEAT = 4;

function Ticker({ items }: { items: string[] }) {
  if (!items.length) return null;
  // Pás = dvě stejné poloviny posouvané o -50 %; každá musí být širší než okno, jinak je vidět konec.
  const loop = Array.from({ length: TICKER_REPEAT }, () => items).flat();
  const run = (
    <span className="flex shrink-0 items-center">
      {loop.map((text, i) => (
        <span key={i} className="flex items-center">
          <span className="px-6">{text}</span>
          <span aria-hidden className="text-white/60">/</span>
        </span>
      ))}
    </span>
  );
  return (
    <div className="ticker flex h-7 items-center overflow-hidden bg-[var(--accent)] text-white">
      <div className="min-w-0 flex-1 overflow-hidden" aria-live="off">
        <div
          className="ticker-track font-[family-name:var(--font-mono)] text-[11px] font-medium uppercase tracking-wider sm:text-xs"
          // Delší pás = delší doba, ať rychlost zůstane stejná.
          style={{ animationDuration: `${40 * TICKER_REPEAT}s` }}
        >
          {run}
          <span aria-hidden className="flex">{run}</span>
        </div>
      </div>
    </div>
  );
}

export function PlayerClient({
  station,
  initialTab = "request",
}: {
  station: StationConfig;
  initialTab?: ListenerTab;
}) {
  const {
    playing,
    nowPlaying,
    recentlyPlayed,
    listeners,
    broadcasting,
    stationOnline,
    shareUrl,
    connection,
    error,
    toggle,
    reconnect,
    volume,
    setVolume,
    micLive,
    moderator: moderatorName,
    moderatorOnAir,
    aiHost,
    tickerMessages,
    segment,
  } = useRadio();
  // Živý moderátor má přednost; jinak AI moderátor se směnou; jinak AutoDJ.
  const moderator = micLive || moderatorOnAir ? moderatorName : aiHost;
  // Pauza na mluvené slovo — hraje jen podkres.
  const onBreak = segment === "talk";
  const [copied, setCopied] = useState(false);

  const onAir = broadcasting && stationOnline;
  const tint = useCoverTint(onBreak ? null : nowPlaying?.thumbnail);

  // Zamčená obrazovka / ovládací centrum (Media Session): „písnička — autor“, pod tím rádio, obal skladby.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const abs = (src: string) => new URL(src, window.location.href).href;
    const cover = !onBreak && nowPlaying?.thumbnail ? abs(nowPlaying.thumbnail) : abs("/brand/logo.svg");
    navigator.mediaSession.metadata = new MediaMetadata({
      // Auto (CarPlay, Škoda…) i zamčená obrazovka: název = písnička, interpret = autor, album = rádio + moderátor.
      title: onBreak || !nowPlaying ? station.name : nowPlaying.title,
      artist: onBreak || !nowPlaying ? station.tagline : nowPlaying.artist,
      album: moderator ? `${station.name} · ${moderator}` : station.name,
      artwork: [
        { src: cover, sizes: "512x512" },
        { src: cover, sizes: "256x256" },
      ],
    });
  }, [nowPlaying, onBreak, moderator, station.name, station.tagline]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // prohlížeč akci nezná
      }
    };
    set("play", () => {
      if (!playing) toggle();
    });
    set("pause", () => {
      if (playing) toggle();
    });
    // Živé vysílání — přetáčení o 10 s nedává smysl.
    for (const a of ["seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"] as MediaSessionAction[]) {
      set(a, null);
    }
  }, [playing, toggle]);
  const tuning = connection === "connecting" || connection === "reconnecting";
  const history = recentlyPlayed
    .filter((t) => t.uuid !== nowPlaying?.uuid)
    .slice(0, 10);

  const placeholder = !stationOnline
    ? "Stanice teď nevysílá"
    : broadcasting
      ? "Ladíme…"
      : "Za chvíli začínáme";

  const statusLine = (() => {
    if (!stationOnline) return "Zkusíme to znovu sami, nemusíš nic dělat.";
    if (tuning) return "Připojuji…";
    return null;
  })();

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl || window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // schránka nedostupná
    }
  }

  const tickerItems = [
    ...tickerMessages,
    micLive ? `Ve studiu mluví ${moderator ?? "moderátor"}` : moderator ? `Moderuje ${moderator}` : null,
    onBreak ? "Krátká přestávka — za chvíli zase hudba" : null,
    nowPlaying ? `Právě hraje: ${nowPlaying.artist} — ${nowPlaying.title}` : null,
    `${station.name} · ${station.tagline}`,
    "Přej si písničku — dole na stránce",
  ].filter((t): t is string => Boolean(t));

  return (
    <div
      className="ambient flex min-h-screen flex-col pt-[env(safe-area-inset-top)]"
      style={{ "--tint": tint } as CSSProperties}
    >
      <InstallPrompt name={station.name} />
      <Ticker items={tickerItems} />
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg-deep)]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-3 sm:h-16 sm:px-6">
          <StationHeader config={station} compact />
          <div className="flex shrink-0 items-center gap-4 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-muted)]">
            <StationClock />
            <span className="flex items-center gap-2" title={onAir ? "Vysíláme živě" : "Stanice teď nevysílá"}>
              {onAir ? (
                <span className="tabular-nums">
                  {listeners}
                  <span className="hidden sm:inline"> {listeners === 1 ? "posluchač" : listeners >= 2 && listeners <= 4 ? "posluchači" : "posluchačů"}</span>
                  <span className="sm:hidden"> poslouchá</span>
                </span>
              ) : (
                <span>offline</span>
              )}
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 space-y-4 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-8">
        <section className="animate-fade-up">
          <NowPlaying
            track={onBreak ? null : nowPlaying}
            placeholder={onBreak ? "Mluvené slovo" : placeholder}
            aside={
              stationOnline ? (
                micLive ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-soft)]">
                    <span className="live-mic h-2 w-2 bg-[var(--accent)]" />
                    {moderator ? `${moderator} mluví živě` : "Moderátor mluví živě"}
                  </span>
                ) : (
                  moderator ? (
                    <span className="text-xs text-[var(--ink-muted)]">
                      Moderuje <span className="font-semibold text-[var(--ink)]">{moderator}</span>
                    </span>
                  ) : null
                )
              ) : null
            }
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:gap-x-6">
              <ListenButton playing={playing} busy={playing && tuning} onToggle={toggle} />
              {/* Mobil a tablet (dotyk) mají hlasitost na tlačítkách — slider jen s myší. */}
              <div className="[@media(pointer:coarse)]:hidden">
                <VolumeControl
                  volume={volume}
                  onChange={setVolume}
                  onToggleMute={() => setVolume(volume > 0 ? 0 : readLastVolume())}
                />
              </div>
            </div>
            {error ? (
              <p className="mt-4 text-sm text-[var(--danger)]" role="alert">
                {error}{" "}
                <button
                  type="button"
                  onClick={reconnect}
                  className="underline underline-offset-2 hover:text-[var(--ink)]"
                >
                  Připojit znovu
                </button>
              </p>
            ) : statusLine ? (
              <p className="mt-4 text-sm text-[var(--ink-muted)]" aria-live="polite">
                {statusLine}
              </p>
            ) : null}
          </NowPlaying>
        </section>

        {/* Kvíz se odemkne, když ho moderátor vyhlásí; po odpovědi zase zmizí. */}
        <QuizPanel />

        {/* Nahoře co hrálo, pod tím přání. Na počítači vedle sebe (přání natáhne výšku podle „Hrálo“). */}
        <div className="animate-fade-up grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-stretch">
          <Card>
            <RecentlyPlayed tracks={history} />
          </Card>
          <Card fill>
            <ListenerTabs initialTab={initialTab} />
          </Card>
        </div>
      </main>

      <footer className="relative z-10 border-t border-[var(--line)] pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-5 text-xs text-[var(--ink-muted)] sm:px-6">
          <span>
            {station.name} · {station.tagline}
          </span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/privacy" className="transition-colors hover:text-[var(--ink)]">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-[var(--ink)]">
              Terms
            </Link>
            <button
              type="button"
              onClick={() => void copyShareUrl()}
              className="transition-colors hover:text-[var(--ink)]"
            >
              {copied ? "Odkaz zkopírován" : "Sdílet odkaz"}
            </button>
            {/* V aplikaci na ploše posluchač studio nepotřebuje. */}
            <Link href="/studio" className="transition-colors hover:text-[var(--ink)] [@media(display-mode:standalone)]:hidden">
              Studio
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Co hrálo: na mobilu 4 skladby a „Zobrazit víc“, na počítači 8. */
function RecentlyPlayed({ tracks }: { tracks: Parameters<typeof ProgramLog>[0]["tracks"] }) {
  const [more, setMore] = useState(false);
  if (!tracks.length)
    return (
      <>
        <h2 className="label mb-3">Hrálo</h2>
        <p className="py-6 text-center text-sm text-[var(--ink-muted)]">Zatím nic nehrálo.</p>
      </>
    );
  return (
    <>
      <h2 className="label mb-3">Hrálo</h2>
      <div className="lg:hidden">
        <ProgramLog tracks={tracks.slice(0, 4)} />
        {tracks.length > 4 ? (
          <>
            {/* Další skladby plynule vyjedou / zajedou (výška 0fr ↔ 1fr). */}
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                more ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
              aria-hidden={!more}
              inert={!more}
            >
              <div className="min-h-0 overflow-hidden">
                <ProgramLog tracks={tracks.slice(4, 10)} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMore(!more)}
              aria-expanded={more}
              className="mt-1 flex w-full items-center justify-center gap-2 border-t border-[var(--line)] pt-3 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
            >
              {more ? "Zobrazit méně" : "Zobrazit víc"}
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className={`h-4 w-4 transition-transform duration-500 ${more ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </>
        ) : null}
      </div>
      <div className="hidden lg:block">
        <ProgramLog tracks={tracks.slice(0, 8)} />
      </div>
    </>
  );
}

/** Všechno, co posluchač může poslat do studia — v jedné kartě se záložkami (každá má adresu). */
function ListenerTabs({ initialTab }: { initialTab: ListenerTab }) {
  const [tab, setTabState] = useState<ListenerTab>(initialTab);
  const setTab = useCallback((next: ListenerTab) => {
    setTabState(next);
    const path = playerPath(next);
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
  }, []);
  useEffect(() => {
    const onPop = () => setTabState(listenerTabFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return (
    <section className="flex min-h-0 flex-col lg:h-full">
      <div
        className="relative mb-5 grid shrink-0 border-b border-[var(--line)]"
        style={{ gridTemplateColumns: `repeat(${LISTENER_TABS.length}, minmax(0, 1fr))` }}
        role="tablist"
      >
        {/* Podtržení plynule přejede pod vybranou záložku. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-px left-0 h-0.5 bg-[var(--accent)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{
            width: `${100 / LISTENER_TABS.length}%`,
            transform: `translateX(${Math.max(0, LISTENER_TABS.findIndex((t) => t.tab === tab)) * 100}%)`,
          }}
        />
        {LISTENER_TABS.map(({ tab: value, label, short }) => (
          <a
            key={value}
            href={playerPath(value)}
            role="tab"
            aria-selected={tab === value}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              setTab(value);
            }}
            className={`whitespace-nowrap px-1 pb-3 pt-1 text-center text-sm font-bold uppercase tracking-wide transition-colors duration-300 ${
              tab === value ? "text-[var(--ink)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{short}</span>
          </a>
        ))}
      </div>
      {/* Panely zůstávají připojené — rozepsaný vzkaz ani hledání se přepnutím neztratí. */}
      <div className={tab === "request" ? "min-h-0 flex-1" : "hidden"}>
        <SongRequestPanel />
      </div>
      <div hidden={tab !== "suggest"}>
        <SuggestPanel />
      </div>
      <div hidden={tab !== "quiz"}>
        <ActivitiesPanel />
      </div>
    </section>
  );
}

function Card({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  if (!fill) return <div className="glass min-w-0 rounded-md p-4 sm:p-6">{children}</div>;
  // fill: obsah nepřidává výšku řádku (na lg) — kartu natáhne soused a obsah se do ní vejde.
  return (
    <div className="glass relative min-w-0 rounded-md lg:min-h-[32rem]">
      <div className="p-4 sm:p-6 lg:absolute lg:inset-0 lg:overflow-y-auto">{children}</div>
    </div>
  );
}

function readLastVolume(): number {
  if (typeof window === "undefined") return 0.85;
  const raw = localStorage.getItem("ai-radio-volume-last") ?? localStorage.getItem("ai-radio-volume");
  const n = raw ? Number(raw) : 0.85;
  return Number.isFinite(n) && n > 0 ? n : 0.85;
}
