import type { StationConfig } from "@/lib/types";

export function StationHeader({
  config,
  compact = false,
}: {
  config: StationConfig;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${compact ? "" : "flex-col text-center sm:flex-row sm:text-left"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={config.logoUrl}
        alt=""
        className={`${compact ? "h-9 w-9" : "h-11 w-11"} shrink-0 rounded-full ring-1 ring-[var(--line-strong)]`}
      />
      <div className="min-w-0">
        <h1
          className={`truncate font-[family-name:var(--font-display)] font-semibold tracking-tight text-[var(--ink)] ${
            compact ? "text-lg" : "text-2xl sm:text-3xl"
          }`}
        >
          {config.name}
        </h1>
        {config.tagline && !compact ? (
          <p className="mt-0.5 truncate text-sm text-[var(--ink-muted)]">
            {config.tagline}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function LiveBadge({
  live,
  listeners,
}: {
  live: boolean;
  listeners: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          live
            ? "bg-[var(--danger)]/12 text-[var(--danger)]"
            : "bg-[var(--bg-elevated)] text-[var(--ink-muted)]"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${live ? "live-dot bg-[var(--danger)]" : "bg-[var(--ink-muted)]/40"}`}
        />
        {live ? "Živě" : "Offline"}
      </span>
      {live ? (
        <span className="text-xs text-[var(--ink-muted)]">
          {listeners}{" "}
          {listeners === 1 ? "posluchač" : listeners < 5 ? "posluchači" : "posluchačů"}
        </span>
      ) : null}
    </div>
  );
}

export function WaveBars({ active }: { active: boolean }) {
  return (
    <div
      className={`flex h-8 items-end justify-center gap-[3px] ${active ? "" : "wave-idle"}`}
      aria-hidden
    >
      {[0.45, 0.75, 1, 0.65, 0.55, 0.85, 0.4].map((h, i) => (
        <span
          key={i}
          className="wave-bar w-[3px] rounded-full bg-[var(--accent)]"
          style={{ height: `${h * 100}%` }}
        />
      ))}
    </div>
  );
}

export function NowPlayingHero({
  thumbnail,
  title,
  artist,
  album,
  year,
  playing,
}: {
  thumbnail: string | null;
  title: string;
  artist: string;
  album?: string | null;
  year?: string | null;
  playing: boolean;
}) {
  return (
    <div className="now-playing-hero relative overflow-hidden rounded-2xl">
      {thumbnail ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnail}
            alt=""
            className="hero-bg absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-[0.35] saturate-150"
            aria-hidden
          />
          <div className="hero-overlay absolute inset-0 bg-gradient-to-t from-[var(--bg-deep)] via-[var(--bg-deep)]/70 to-[var(--bg-deep)]/30" />
        </>
      ) : (
        <div className="hero-overlay absolute inset-0 bg-[var(--bg-panel)]" />
      )}

      <div className="relative flex flex-col items-center gap-5 px-6 py-8 sm:flex-row sm:items-end sm:gap-6 sm:py-10">
        <div className="relative shrink-0">
          <div className="album-art-shadow overflow-hidden rounded-xl ring-1 ring-white/10">
            {thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnail}
                alt={title}
                className="h-44 w-44 object-cover sm:h-48 sm:w-48"
              />
            ) : (
              <div className="flex h-44 w-44 items-center justify-center bg-[var(--bg-elevated)] sm:h-48 sm:w-48">
                <span className="text-4xl text-[var(--ink-muted)]/30">♪</span>
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 text-center sm:pb-1 sm:text-left">
          <div className="mb-3 flex justify-center sm:justify-start">
            <WaveBars active={playing} />
          </div>
          <p className="text-xs font-medium text-[var(--accent-soft)]">Právě hraje</p>
          <h2 className="mt-1 line-clamp-2 font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight text-[var(--ink)] sm:text-3xl">
            {title}
          </h2>
          <p className="mt-1 truncate text-base text-[var(--ink-muted)]">{artist}</p>
          {album ? (
            <p className="mt-1 truncate text-sm text-[var(--ink-muted)]/80">
              {year ? `${year} · ` : ""}
              {album}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PlayControl({
  playing,
  onToggle,
}: {
  playing: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="btn-play flex h-16 w-16 items-center justify-center rounded-full text-[var(--bg-deep)] shadow-lg"
      aria-label={playing ? "Pauza" : "Přehrát"}
    >
      {playing ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M8 5.5v13l11-6.5L8 5.5z" />
        </svg>
      )}
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
    <div className="flex w-full max-w-sm items-center gap-3">
      <button
        type="button"
        onClick={onToggleMute}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--ink-muted)] transition hover:bg-[var(--bg-elevated)] hover:text-[var(--ink)]"
        aria-label={volume > 0 ? "Ztlumit" : "Zapnout zvuk"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
          {volume === 0 ? (
            <>
              <path d="M11 5L6 9H3v6h3l5 4V5z" />
              <path d="M16 9l5 5M21 9l-5 5" />
            </>
          ) : (
            <>
              <path d="M11 5L6 9H3v6h3l5 4V5z" />
              {volume > 0.35 ? <path d="M15.5 8.5a5 5 0 010 7" /> : null}
              {volume > 0.65 ? <path d="M18 6a8 8 0 010 12" /> : null}
            </>
          )}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => onChange(Number(e.target.value))}
        className="broadcast-range flex-1"
        aria-label="Hlasitost"
      />
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-[var(--ink-muted)]">
        {Math.round(volume * 100)}
      </span>
    </div>
  );
}

export function ProgramLog({
  title,
  tracks,
  variant,
}: {
  title: string;
  tracks: { uuid: string; title: string; artist: string; thumbnail: string | null }[];
  variant: "upcoming" | "recent";
}) {
  if (!tracks.length) return null;

  return (
    <section className="w-full">
      <h2 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">{title}</h2>
      <ul className="space-y-1">
        {tracks.map((track, index) => (
          <li
            key={track.uuid}
            className={`program-log-row flex items-center gap-3 rounded-xl px-3 py-2.5 ${
              variant === "upcoming" && index === 0 ? "is-next" : ""
            } ${variant === "recent" ? "is-recent" : ""}`}
          >
            {track.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={track.thumbnail}
                alt=""
                className="h-10 w-10 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-sm text-[var(--ink-muted)]">
                ♪
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--ink)]">{track.title}</p>
              <p className="truncate text-xs text-[var(--ink-muted)]">{track.artist}</p>
            </div>
            {variant === "upcoming" && index === 0 ? (
              <span className="shrink-0 rounded-md bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-soft)]">
                Další
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
