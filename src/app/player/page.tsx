"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OnAirBadge, StationBranding } from "@/components/StationBranding";
import { useRadio } from "@/components/RadioProvider";

export default function PlayerPage() {
  const {
    playing,
    nowPlaying,
    recentlyPlayed,
    listeners,
    broadcasting,
    streamUrl,
    connection,
    error,
    toggle,
    reconnect,
    volume,
    setVolume,
    play,
  } = useRadio();
  const [copied, setCopied] = useState(false);

  const recentList = recentlyPlayed.filter((t) => t.uuid !== nowPlaying?.uuid);

  useEffect(() => {
    const timer = setTimeout(() => play(), 600);
    return () => clearTimeout(timer);
  }, [play]);

  async function copyStreamUrl() {
    try {
      await navigator.clipboard.writeText(streamUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(streamUrl)}`;

  const statusLine = (() => {
    if (connection === "connecting" || connection === "reconnecting") {
      return "Připojuji ke streamu…";
    }
    if (!nowPlaying && broadcasting) {
      return "Načítám skladbu…";
    }
    if (!nowPlaying && !broadcasting) {
      return "Rádio startuje — chvilku strpení";
    }
    if (nowPlaying) return nowPlaying.artist;
    return "Klikni Play pro poslech";
  })();

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center px-5 py-10">
      <Link
        href="/studio"
        className="absolute right-5 top-6 text-sm text-[var(--ink-muted)] transition hover:text-[var(--accent-soft)]"
      >
        Studio
      </Link>

      <div className="animate-fade-up w-full">
        <StationBranding size="lg" />
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <OnAirBadge live={broadcasting || playing} />
          <p className="text-xs text-[var(--ink-muted)]">
            {listeners}{" "}
            {listeners === 1
              ? "posluchač"
              : listeners < 5
                ? "posluchači"
                : "posluchačů"}
          </p>
          {connection === "connecting" || connection === "reconnecting" ? (
            <span className="text-xs text-[var(--accent-soft)]">● připojuji</span>
          ) : null}
        </div>
      </div>

      <div
        className="animate-fade-up relative my-10 aspect-square w-full max-w-[280px]"
        style={{ animationDelay: "80ms" }}
      >
        <div
          className={`absolute inset-0 rounded-full bg-[var(--bg-panel)] shadow-[0_0_60px_rgba(212,162,76,0.12)] ${playing ? "vinyl-spin" : ""}`}
        />
        <div className="absolute inset-[8%] overflow-hidden rounded-full border border-[var(--line)] bg-[var(--bg-deep)]">
          {nowPlaying?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={nowPlaying.uuid}
              src={nowPlaying.thumbnail}
              alt={nowPlaying.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-[var(--ink-muted)]">
              {broadcasting || connection !== "idle" ? (
                <>
                  <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" />
                  <span>Načítám…</span>
                </>
              ) : (
                "—"
              )}
            </div>
          )}
        </div>
        <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--line)] bg-[var(--bg-deep)]" />
      </div>

      <div
        className="animate-fade-up w-full text-center"
        style={{ animationDelay: "120ms" }}
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="truncate font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
          {nowPlaying?.title ?? "Čekám na skladbu…"}
        </p>
        <p className="mt-1 truncate text-[var(--accent-soft)]">{statusLine}</p>
        {nowPlaying?.album && (
          <p className="mt-2 truncate text-sm text-[var(--ink-muted)]">
            {nowPlaying.year ? `${nowPlaying.year} · ` : ""}
            {nowPlaying.album}
          </p>
        )}
      </div>

      <div
        className="animate-fade-up mt-10 flex flex-col items-center gap-5"
        style={{ animationDelay: "160ms" }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            className={`flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-lg font-bold text-[var(--bg-deep)] transition hover:bg-[var(--accent-soft)] ${playing ? "" : "animate-pulse-ring"}`}
            aria-label={playing ? "Pauza" : "Přehrát"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          {(error || connection === "reconnecting") && (
            <button
              type="button"
              onClick={reconnect}
              className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink)] hover:border-[var(--accent)]/40"
            >
              Znovu připojit
            </button>
          )}
        </div>

        <div className="flex w-full max-w-xs items-center gap-3">
          <button
            type="button"
            onClick={() => setVolume(volume > 0 ? 0 : readLastVolume())}
            className="text-xs text-[var(--ink-muted)] hover:text-[var(--accent-soft)]"
            aria-label={volume > 0 ? "Ztlumit" : "Zapnout zvuk"}
          >
            {volume === 0 ? "🔇" : volume < 0.35 ? "🔈" : volume < 0.7 ? "🔉" : "🔊"}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--line)] accent-[var(--accent)]"
            aria-label="Hlasitost"
          />
          <span className="w-9 text-right text-xs tabular-nums text-[var(--ink-muted)]">
            {Math.round(volume * 100)}%
          </span>
        </div>
      </div>

      {error && (
        <p
          className="animate-fade-up mt-6 w-full rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-center text-sm text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      )}

      {recentList.length > 0 && (
        <div className="mt-8 w-full">
          <p className="mb-2 text-xs font-semibold tracking-wider text-[var(--ink-muted)] uppercase">
            Nedávno hrálo
          </p>
          <ul className="space-y-2">
            {recentList.map((track) => (
              <li
                key={track.uuid}
                className="truncate rounded-xl border border-[var(--line)] bg-[var(--bg-panel)]/50 px-3 py-2 text-sm"
              >
                <span className="text-[var(--ink)]">{track.title}</span>
                <span className="text-[var(--ink-muted)]"> · {track.artist}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className="animate-fade-up mt-8 w-full rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/60 p-4"
        style={{ animationDelay: "200ms" }}
      >
        <p className="text-xs text-[var(--ink-muted)]">Sdílet stanici</p>
        <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrUrl}
            alt="QR kód streamu"
            className="h-28 w-28 rounded-lg border border-[var(--line)] bg-white p-1"
          />
          <div className="min-w-0 flex-1">
            <code className="block truncate text-sm text-[var(--accent-soft)]">
              {streamUrl}
            </code>
            <button
              type="button"
              onClick={() => void copyStreamUrl()}
              className="mt-3 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink)] hover:border-[var(--accent)]/40"
            >
              {copied ? "Zkopírováno!" : "Kopírovat URL"}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-[var(--ink-muted)]">
              Funguje v prohlížeči, VLC nebo na telefonu.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function readLastVolume(): number {
  if (typeof window === "undefined") return 0.85;
  const raw = localStorage.getItem("ai-radio-volume");
  const n = raw ? Number(raw) : 0.85;
  return Number.isFinite(n) && n > 0 ? n : 0.85;
}
