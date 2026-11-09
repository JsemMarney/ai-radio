"use client";

import Link from "next/link";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import {
  ListenButton,
  LiveBadge,
  NowPlaying,
  ProgramLog,
  StationHeader,
  VolumeControl,
} from "@/components/player/BroadcastUi";
import { AudioVisualizer } from "@/components/player/AudioVisualizer";
import { FavoriteAlert, FavoriteButton } from "@/components/player/Favorites";
import { SongRequestPanel } from "@/components/player/SongRequestPanel";
import { MessagePanel } from "@/components/player/MessagePanel";
import { SuggestPanel } from "@/components/player/SuggestPanel";
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
    <span className="hidden font-[family-name:var(--font-mono)] text-sm tabular-nums text-[var(--ink-muted)] sm:inline">
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
          <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-[var(--ink)]/60" />
        </span>
      ))}
    </span>
  );
  return (
    <div className="ticker flex h-8 items-center overflow-hidden bg-[linear-gradient(90deg,var(--accent),color-mix(in_srgb,var(--accent)_60%,var(--accent-2)))] text-[var(--ink)]">
      <div className="min-w-0 flex-1 overflow-hidden" aria-live="off">
        <div
          className="ticker-track text-xs font-semibold uppercase tracking-wide sm:text-[13px]"
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

export function PlayerClient({ station }: { station: StationConfig }) {
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
    visualizer,
    setVisualizer,
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
    micLive ? `Ve studiu mluví ${moderator ?? "moderátor"}` : moderator ? `Moderuje ${moderator}` : "Hraje AutoDJ",
    onBreak ? "Krátká přestávka — za chvíli zase hudba" : null,
    nowPlaying ? `Právě hraje: ${nowPlaying.artist} — ${nowPlaying.title}` : null,
    `${station.name} · ${station.tagline}`,
    "Přej si písničku dole na stránce",
  ].filter((t): t is string => Boolean(t));

  return (
    <div className="ambient flex min-h-screen flex-col" style={{ "--tint": tint } as CSSProperties}>
      <AudioVisualizer />
      <FavoriteAlert track={onBreak ? null : nowPlaying} stationName={station.name} />
      <Ticker items={tickerItems} />
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg-deep)]/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <StationHeader config={station} compact />
          <div className="flex shrink-0 items-center gap-4">
            <StationClock />
            <LiveBadge live={onAir} listeners={listeners} lamp={false} />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="animate-fade-up">
          <NowPlaying
            track={onBreak ? null : nowPlaying}
            placeholder={onBreak ? "Mluvené slovo" : placeholder}
            aside={
              stationOnline ? (
                micLive ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-soft)]">
                    <span className="live-mic h-2 w-2 rounded-full bg-[var(--accent)]" />
                    {moderator ? `${moderator} mluví živě` : "Moderátor mluví živě"}
                  </span>
                ) : (
                  <span className="text-xs text-[var(--ink-muted)]">
                    {moderator ? (
                      <>
                        Moderuje <span className="font-semibold text-[var(--ink)]">{moderator}</span>
                      </>
                    ) : (
                      <>
                        Hraje <span className="font-semibold text-[var(--ink)]">AutoDJ</span>
                      </>
                    )}
                  </span>
                )
              ) : null
            }
          >
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4">
              <ListenButton playing={playing} busy={playing && tuning} onToggle={toggle} />
              {!onBreak ? <FavoriteButton track={nowPlaying} /> : null}
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

        {/* Na počítači má karta s přáními stejnou výšku jako „Hrálo“ — seznam se roztáhne, zbytek se posouvá. */}
        <div className="animate-fade-up grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-stretch">
          <Card fill>
            <ListenerTabs />
          </Card>
          <Card>
            <h2 className="mb-4 text-xl font-bold tracking-tight">Hrálo</h2>
            {history.length ? (
              <ProgramLog tracks={history.slice(0, 8)} />
            ) : (
              <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Zatím nic nehrálo.</p>
            )}
          </Card>
        </div>
      </main>

      <footer className="relative z-10 border-t border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-[var(--ink-muted)] sm:px-6">
          <span>
            {station.name} · {station.tagline}
          </span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setVisualizer(!visualizer)}
              aria-pressed={visualizer}
              className="transition-colors hover:text-[var(--ink)]"
            >
              Vizualizér: {visualizer ? "zap" : "vyp"}
            </button>
            <button
              type="button"
              onClick={() => void copyShareUrl()}
              className="transition-colors hover:text-[var(--ink)]"
            >
              {copied ? "Odkaz zkopírován" : "Sdílet odkaz"}
            </button>
            <Link href="/studio" className="transition-colors hover:text-[var(--ink)]">
              Studio
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

type ListenerTab = "request" | "suggest" | "message";

const LISTENER_TABS: [ListenerTab, string, string][] = [
  ["request", "Přej si písničku", "Přání"],
  ["suggest", "Navrhni novou", "Navrhnout"],
  ["message", "Vzkaz do studia", "Vzkaz"],
];

/** Všechno, co posluchač může poslat do studia — v jedné kartě se záložkami. */
function ListenerTabs() {
  const [tab, setTab] = useState<ListenerTab>("request");
  return (
    <section className="flex min-h-0 flex-col lg:h-full">
      <div className="mb-5 flex shrink-0 gap-1 overflow-x-auto rounded-full border border-[var(--line)] bg-[var(--bg-deep)]/60 p-1" role="tablist">
        {LISTENER_TABS.map(([value, label, short]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`flex-1 whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
              tab === value ? "btn-glow text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]"
            }`}
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{short}</span>
          </button>
        ))}
      </div>
      {/* Panely zůstávají připojené — rozepsaný vzkaz ani hledání se přepnutím neztratí. */}
      <div className={tab === "request" ? "min-h-0 flex-1" : "hidden"}>
        <SongRequestPanel />
      </div>
      <div hidden={tab !== "suggest"}>
        <SuggestPanel />
      </div>
      <div hidden={tab !== "message"}>
        <MessagePanel />
      </div>
    </section>
  );
}

function Card({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  if (!fill) return <div className="glass min-w-0 rounded-3xl p-5 sm:p-6">{children}</div>;
  // fill: obsah nepřidává výšku řádku (na lg) — kartu natáhne soused a obsah se do ní vejde.
  return (
    <div className="glass relative min-w-0 rounded-3xl lg:min-h-[32rem]">
      <div className="p-5 sm:p-6 lg:absolute lg:inset-0 lg:overflow-y-auto">{children}</div>
    </div>
  );
}

function readLastVolume(): number {
  if (typeof window === "undefined") return 0.85;
  const raw = localStorage.getItem("ai-radio-volume");
  const n = raw ? Number(raw) : 0.85;
  return Number.isFinite(n) && n > 0 ? n : 0.85;
}
