import type { StationConfig } from "@/lib/types";

export function StationHeader({
  config,
  size = "md",
}: {
  config: StationConfig;
  size?: "sm" | "md" | "lg";
}) {
  const logoSize =
    size === "lg" ? "h-14 w-14" : size === "sm" ? "h-8 w-8" : "h-11 w-11";
  const titleSize =
    size === "lg"
      ? "text-4xl tracking-[0.12em]"
      : size === "sm"
        ? "text-xl tracking-[0.08em]"
        : "text-3xl tracking-[0.1em]";

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={config.logoUrl}
        alt=""
        className={`${logoSize} drop-shadow-[0_0_12px_var(--glow-accent)]`}
      />
      <div>
        <h1
          className={`font-[family-name:var(--font-display)] ${titleSize} uppercase text-[var(--ink)]`}
        >
          {config.name}
        </h1>
        {config.tagline ? (
          <p className="mt-1.5 font-[family-name:var(--font-mono)] text-xs tracking-wide text-[var(--ink-muted)]">
            {config.tagline}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function OnAirLamp({ live }: { live: boolean }) {
  if (!live) {
    return (
      <span className="inline-flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] tracking-widest text-[var(--ink-muted)] uppercase">
        <span className="h-2.5 w-2.5 rounded-sm border border-[var(--line)] bg-[var(--bg-panel)]" />
        Off air
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2.5 font-[family-name:var(--font-mono)] text-[10px] font-medium tracking-widest text-[var(--danger)] uppercase">
      <span className="on-air-lamp h-3 w-3 rounded-sm bg-[var(--danger)]" />
      On air
    </span>
  );
}

export function VuMeter({ active }: { active: boolean }) {
  return (
    <div
      className={`flex h-full items-end justify-center gap-[3px] px-1 ${active ? "" : "vu-idle"}`}
      aria-hidden
    >
      {[0.6, 0.85, 1, 0.7, 0.5].map((h, i) => (
        <span
          key={i}
          className="vu-bar w-[4px] rounded-sm bg-[var(--accent)]"
          style={{ height: `${h * 100}%`, opacity: 0.5 + h * 0.4 }}
        />
      ))}
    </div>
  );
}

export function BroadcastMonitor({
  thumbnail,
  title,
  playing,
}: {
  thumbnail: string | null;
  title: string;
  playing: boolean;
}) {
  return (
    <div className="broadcast-monitor rounded-xl p-2">
      <div className="broadcast-monitor-bezel flex gap-2 rounded-lg p-2">
        <div className="hidden w-5 sm:block">
          <VuMeter active={playing} />
        </div>
        <div className="relative aspect-square min-w-0 flex-1 overflow-hidden rounded-md bg-[var(--bg-deep)]">
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnail}
              alt={title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--ink-muted)]">
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" />
              <span className="font-[family-name:var(--font-mono)] text-[10px]">
                SIGNAL
              </span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/50 to-transparent" />
        </div>
        <div className="hidden w-5 sm:block">
          <VuMeter active={playing} />
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between px-1 font-[family-name:var(--font-mono)] text-[9px] tracking-wider text-[var(--ink-muted)] uppercase">
        <span>Studio A</span>
        <span className={playing ? "text-[var(--ok)]" : ""}>
          {playing ? "● TX" : "○ STBY"}
        </span>
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
      className="btn-play flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full text-[var(--bg-deep)]"
      aria-label={playing ? "Pauza" : "Přehrát"}
    >
      {playing ? (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
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
    <div className="flex w-full max-w-xs items-center gap-3">
      <button
        type="button"
        onClick={onToggleMute}
        className="flex h-8 w-8 items-center justify-center text-[var(--ink-muted)] transition hover:text-[var(--accent-soft)]"
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
      <span className="w-9 text-right font-[family-name:var(--font-mono)] text-xs tabular-nums text-[var(--ink-muted)]">
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
      <h2 className="mb-2 font-[family-name:var(--font-mono)] text-[10px] tracking-[0.2em] text-[var(--ink-muted)] uppercase">
        {title}
      </h2>
      <ul className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-panel)]/40">
        {tracks.map((track, index) => (
          <li
            key={track.uuid}
            className={`program-log-row flex items-center gap-3 border-b border-[var(--line)] px-3 py-2.5 last:border-b-0 ${
              variant === "upcoming" && index === 0 ? "is-next" : ""
            } ${variant === "recent" ? "is-recent" : ""}`}
          >
            <span className="w-5 shrink-0 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-muted)]">
              {variant === "upcoming" ? String(index + 1).padStart(2, "0") : "–"}
            </span>
            {track.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={track.thumbnail}
                alt=""
                className="h-9 w-9 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[var(--bg-deep)] text-[10px] text-[var(--ink-muted)]">
                ♪
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-[var(--ink)]">{track.title}</p>
              <p className="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                {track.artist}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
