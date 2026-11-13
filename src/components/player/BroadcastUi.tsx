import type { CSSProperties, ReactNode } from "react";
import type { RadioNowPlaying, StationConfig } from "@/lib/types";

export function StationHeader({
  config,
  compact = false,
}: {
  config: StationConfig;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={config.logoUrl}
        alt=""
        className={`${compact ? "h-8 w-8 sm:h-9 sm:w-9" : "h-11 w-11"} shrink-0`}
      />
      <div className="min-w-0">
        <p
          className={`truncate font-[family-name:var(--font-display)] font-extrabold uppercase leading-none tracking-tight text-[var(--ink)] ${
            compact ? "text-lg sm:text-xl" : "text-2xl sm:text-3xl"
          }`}
        >
          {config.name}
        </p>
        {config.tagline ? (
          <p className="mt-1 truncate font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-[var(--ink-muted)] sm:text-[11px]">
            {config.tagline}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function OnAirLamp({ live }: { live: boolean }) {
  return (
    <span
      className={`on-air inline-flex h-7 items-center rounded-[3px] px-2.5 text-xs font-semibold uppercase ${
        live ? "is-live" : ""
      }`}
      title={live ? "Vysíláme" : "Stanice nevysílá"}
    >
      {live ? "On air" : "Off air"}
    </span>
  );
}

function listenersLabel(n: number): string {
  if (n === 1) return "1 posluchač";
  if (n >= 2 && n <= 4) return `${n} posluchači`;
  return `${n} posluchačů`;
}

export function LiveBadge({
  live,
  listeners,
  lamp = true,
}: {
  live: boolean;
  listeners: number;
  /** Ukázat ON AIR lampu (přehrávač ji nemá). */
  lamp?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      {lamp ? <OnAirLamp live={live} /> : null}
      {live ? (
        <span className="hidden text-xs text-[var(--ink-muted)] sm:inline">
          {listenersLabel(listeners)}
        </span>
      ) : null}
    </div>
  );
}

export function LevelMeter({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex h-3 items-end gap-[2px] ${active ? "is-playing" : ""}`}
      aria-hidden
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className="level-bar h-full w-[3px] bg-[var(--accent)]" />
      ))}
    </span>
  );
}

export function Cover({
  src,
  size,
  className = "",
}: {
  src: string | null | undefined;
  size: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims =
    size === "lg" ? "w-full aspect-square" : size === "md" ? "h-20 w-20" : "h-10 w-10";
  if (!src) {
    return (
      <div
        className={`${dims} ${className} shrink-0 bg-[var(--bg-panel)]`}
        aria-hidden
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`${dims} ${className} shrink-0 bg-[var(--bg-panel)] object-cover`}
    />
  );
}

/** Hlavní karta: obal vlevo, skladba + ovládání vpravo. */
export function NowPlaying({
  track,
  placeholder,
  aside,
  children,
}: {
  track: RadioNowPlaying | null;
  placeholder: string;
  /** Malá poznámka vpravo nahoře (kdo moderuje). */
  aside?: ReactNode;
  /** Průběh, tlačítko a hlasitost pod názvem. */
  children?: ReactNode;
}) {
  const title = track?.title ?? placeholder;
  return (
    <div className="glass relative overflow-hidden rounded-md">
      {/* Mobil: malý obal vedle názvu, tlačítka pod tím na celou šířku. Počítač: velký obal vlevo. */}
      <div className="relative grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-4 p-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-x-8 sm:gap-y-6 sm:p-8 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <Cover
          src={track?.thumbnail}
          size="lg"
          className="w-full rounded-sm sm:row-span-2"
        />
        <div className="flex min-w-0 flex-col justify-center sm:self-end">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              {track?.requested ? (
                <span className="border border-[var(--accent)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-wider text-[var(--accent-soft)]">
                  na přání
                </span>
              ) : null}
            </div>
            {aside}
          </div>
          <h1
            className={`mt-1 line-clamp-3 font-extrabold leading-[1.05] tracking-tight text-[var(--ink)] sm:mt-3 ${
              title.length > 34 ? "text-lg sm:text-3xl" : "text-xl sm:text-4xl"
            }`}
          >
            {title}
          </h1>
          {track ? (
            <p className="mt-0.5 truncate text-sm font-medium text-[var(--ink)]/85 sm:mt-1 sm:text-lg">{track.artist}</p>
          ) : null}
        </div>
        {children ? <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:self-start">{children}</div> : null}
      </div>
      {track?.dedication ? (
        <div className="relative border-t border-[var(--line)] px-5 pb-5 sm:px-8 sm:pb-6">
          <DedicationNote dedication={track.dedication} />
        </div>
      ) : null}
    </div>
  );
}

/** Věnování ze schváleného přání — karta s velkými uvozovkami. */
export function DedicationNote({
  dedication,
  large = false,
  title,
}: {
  dedication: { from: string | null; message: string | null };
  large?: boolean;
  /** Nadpis karty (studio: „Přečti do éteru“). */
  title?: string;
}) {
  return (
    <figure className="mt-6 rounded-md border-l-2 border-[var(--accent)] bg-[var(--bg-panel)] px-[18px] py-4">
      {title ? (
        <p className="mb-2 font-[family-name:var(--font-display)] text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-soft)]">
          {title}
        </p>
      ) : (
        <div
          className="h-[27px] font-[family-name:var(--font-display)] text-[40px] font-bold leading-[0.6] text-[var(--accent)]"
          aria-hidden
        >
          „
        </div>
      )}
      {dedication.message ? (
        <blockquote className={`mt-1 leading-snug ${large ? "text-xl" : "text-base"}`}>
          {title ? `„${dedication.message}“` : dedication.message}
        </blockquote>
      ) : null}
      <figcaption className={`mt-2 text-[var(--ink-muted)] ${large ? "text-sm" : "text-xs"}`}>
        Přání{dedication.from ? ` od ${dedication.from}` : " posluchače"}
      </figcaption>
    </figure>
  );
}

export function ListenButton({
  playing,
  busy,
  onToggle,
}: {
  playing: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="btn-glow inline-flex h-12 items-center gap-3 rounded-md pl-4 pr-6 font-[family-name:var(--font-display)] text-sm font-bold uppercase tracking-wider text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] w-full justify-center sm:w-auto sm:justify-start"
      aria-label={playing ? "Zastavit" : "Poslouchat živě"}
    >
      {playing ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M8 5.5v13l11-6.5L8 5.5z" />
        </svg>
      )}
      {busy ? "Ladím…" : playing ? "Zastavit" : "Poslouchat živě"}
    </button>
  );
}

export function VolumeControl({
  volume,
  onChange,
  onToggleMute,
}: {
  volume: number;
  onChange: (v: number) => void;
  onToggleMute: () => void;
}) {
  return (
    <div className="group/vol flex items-center">
      <button
        type="button"
        onClick={onToggleMute}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[var(--ink)] transition-colors hover:bg-[var(--ink)]/10"
        aria-label={volume > 0 ? "Ztlumit" : "Zapnout zvuk"}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 5L6 9H3v6h3l5 4V5z" />
          {volume === 0 ? (
            <path d="M16 9l5 5M21 9l-5 5" />
          ) : (
            <>
              {volume > 0.05 ? <path d="M15.5 8.5a5 5 0 010 7" /> : null}
              {volume > 0.6 ? <path d="M18 6a8 8 0 010 12" /> : null}
            </>
          )}
        </svg>
      </button>
      {/* Posuvník vyjede, až na reproduktor najedeš myší (nebo na něj skočíš klávesnicí). */}
      <div className="flex w-0 items-center overflow-hidden opacity-0 transition-[width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/vol:w-36 group-hover/vol:opacity-100 group-focus-within/vol:w-36 group-focus-within/vol:opacity-100 motion-reduce:transition-none">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onChange(Number(e.target.value))}
          className="broadcast-range mx-2 my-3 w-32 shrink-0"
          style={{ "--fill": `${Math.round(volume * 100)}%` } as CSSProperties}
          aria-label="Hlasitost"
          aria-valuetext={`${Math.round(volume * 100)} %`}
        />
      </div>
    </div>
  );
}

export function formatTime(iso: string | number | null | undefined): string {
  if (iso == null) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

export function formatLength(sec: number | null | undefined): string {
  if (!sec || !Number.isFinite(sec)) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

/** Řádek playlistu: čas · obal · skladba · délka. */
export function LogRow({
  time,
  track,
  highlight = false,
  muted = false,
  aside,
}: {
  time?: ReactNode;
  track: Pick<RadioNowPlaying, "title" | "artist" | "thumbnail" | "requested">;
  highlight?: boolean;
  muted?: boolean;
  aside?: ReactNode;
}) {
  return (
    <li
      className={`flex items-center gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0 ${
        muted ? "opacity-60" : ""
      }`}
    >
      {time !== undefined ? (
        <span
          className={`w-11 shrink-0 font-[family-name:var(--font-mono)] text-xs tabular-nums ${
            highlight ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
          }`}
        >
          {time}
        </span>
      ) : null}
      <Cover src={track.thumbnail} size="sm" className="rounded-[2px]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-[var(--ink)]">{track.title}</p>
        <p className="truncate text-xs text-[var(--ink-muted)]">
          {track.artist}
          {track.requested ? (
            <span className="text-[var(--accent)]"> · na přání</span>
          ) : null}
        </p>
      </div>
      {aside}
    </li>
  );
}

function LogTime({ iso }: { iso: string | undefined }) {
  if (!iso) return <>—</>;
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = sameDay(d, today)
    ? null
    : sameDay(d, yesterday)
      ? "včera"
      : d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
  return (
    <span className="flex flex-col leading-tight">
      {formatTime(iso)}
      {day ? <span className="text-[10px] text-[var(--ink-faint)]">{day}</span> : null}
    </span>
  );
}

export function ProgramLog({
  title,
  tracks,
}: {
  title?: string;
  tracks: RadioNowPlaying[];
  variant?: "upcoming" | "recent";
}) {
  if (!tracks.length) return null;
  return (
    <section>
      {title ? <h2 className="label mb-2">{title}</h2> : null}
      <ul>
        {tracks.map((track) => (
          <LogRow
            key={`${track.uuid}-${track.startedAt ?? ""}`}
            time={<LogTime iso={track.startedAt} />}
            track={track}
          />
        ))}
      </ul>
    </section>
  );
}
