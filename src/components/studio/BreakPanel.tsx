"use client";

import { useEffect, useState } from "react";
import { useRadio } from "@/components/RadioProvider";
import type { LibraryTrack } from "@/lib/types";

type BedOption = { id: string; label: string };

async function control(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/radio/break", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? null : data.error ?? "Nepovedlo se.";
  } catch {
    return "Broadcaster neodpovídá.";
  }
}

/**
 * Pauza na mluvené slovo: po skladbě (nebo hned) naběhne podkres,
 * moderátor mluví, „Pokračovat“ pustí další skladbu.
 */
export function BreakPanel({
  library,
  nextTitle,
}: {
  library: LibraryTrack[];
  nextTitle: string | null;
}) {
  const { breakState, bed, bedLevelDb, micLive } = useRadio();
  const [beds, setBeds] = useState<BedOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(bedLevelDb);

  useEffect(() => {
    void fetch("/api/radio/break/beds", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { beds?: BedOption[] }) => setBeds(d.beds ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setLevel(bedLevelDb), 0);
    return () => clearTimeout(t);
  }, [bedLevelDb]);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(await control({ action, ...extra }));
    setBusy(false);
  }

  const playable = library.filter((t) => t.status === "ready" && t.audioFile);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="label">Pauza na slovo</h2>
        {breakState === "on" ? (
          <span className="live-mic text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
            hraje podkres
          </span>
        ) : breakState === "armed" ? (
          <span className="text-xs text-[var(--accent)]">po této skladbě</span>
        ) : null}
      </div>

      {breakState === "on" ? (
        <div className="bg-[var(--bg-panel)] p-4">
          <p className="text-sm">
            Jsi ve vysílání s podkresem.
            {!micLive ? (
              <span className="text-[var(--accent)]"> Zapni mikrofon níž.</span>
            ) : null}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("resume")}
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-5 font-[family-name:var(--font-display)] text-sm font-semibold uppercase tracking-wider text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5.5v13l11-6.5L8 5.5z" />
            </svg>
            Pokračovat
          </button>
          {nextTitle ? (
            <p className="mt-2 truncate text-xs text-[var(--ink-muted)]">Pustí se: {nextTitle}</p>
          ) : null}
        </div>
      ) : breakState === "armed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-[var(--ink-muted)]">Skladba dohraje a naběhne podkres.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("now")}
            className="rounded-full border border-[var(--line-strong)] px-4 py-1.5 text-sm hover:border-[var(--ink)]"
          >
            Hned
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("cancel")}
            className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            Zrušit
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("arm")}
            className="rounded-full border border-[var(--accent)] px-4 py-1.5 text-sm text-[var(--ink)] transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
          >
            Pauza po této skladbě
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("now")}
            className="rounded-full border border-[var(--line-strong)] px-4 py-1.5 text-sm transition-colors hover:border-[var(--ink)] disabled:opacity-50"
          >
            Hned
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-[var(--ink-muted)]">
          Podkres
          <select
            value={bed}
            onChange={(e) => void run("settings", { bed: e.target.value })}
            className="mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1 text-sm text-[var(--ink)] outline-none"
          >
            {beds.map((b) => (
              <option key={b.id} value={b.id} className="bg-[var(--bg-panel)]">
                {b.label}
              </option>
            ))}
            {playable.length ? (
              <optgroup label="Skladba z knihovny (potichu)" className="bg-[var(--bg-panel)]">
                {playable.map((t) => (
                  <option key={t.uuid} value={`track:${t.uuid}`} className="bg-[var(--bg-panel)]">
                    {t.artist} — {t.title}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <label className="text-xs text-[var(--ink-muted)]">
          Hlasitost podkresu {level} dB
          <input
            type="range"
            min={-30}
            max={0}
            step={1}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            onPointerUp={() => void run("settings", { bedLevelDb: level })}
            onKeyUp={() => void run("settings", { bedLevelDb: level })}
            className="broadcast-range mt-3 block w-full"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{error}</p>
      ) : (
        <p className="mt-3 text-xs text-[var(--ink-faint)]">
          Vlastní podkresy dej do složky public/beds. „Další skladba“ během pauzy taky pokračuje.
        </p>
      )}
    </section>
  );
}
