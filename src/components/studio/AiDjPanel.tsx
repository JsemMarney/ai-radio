"use client";

import { useCallback, useEffect, useState } from "react";
import type { AiDjSettings, AiDjState } from "@/lib/ai-dj";

const GAP_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];

/** AI moderátor — mluví mezi písničkami tvým naklonovaným hlasem. */
export function AiDjPanel() {
  const [state, setState] = useState<AiDjState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/ai-dj", { cache: "no-store" });
      if (!res.ok) return;
      setState((await res.json()) as AiDjState);
    } catch {
      // offline
    }
  }, []);

  /**
   * Čeká se na vstup z tlačítka: hodnota = lastAt ze serveru před kliknutím
   * (hotovo, až se změní — nezávisí na hodinách prohlížeče). undefined = nečeká se.
   */
  const [awaitingFrom, setAwaitingFrom] = useState<string | null | undefined>(undefined);
  const lastAtBefore = awaitingFrom === undefined ? null : awaitingFrom;
  const awaiting = awaitingFrom !== undefined;
  const generating = Boolean(state?.generating);
  const fastPoll = generating || awaiting;
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    // Během přípravy vstupu častěji, ať je hned vidět výsledek.
    const timer = setInterval(() => void load(), fastPoll ? 3_000 : 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, fastPoll]);

  // Vstup z tlačítka dokončen (lastAt se změnil) → hláška podle výsledku.
  if (awaiting && state && !state.generating && state.lastAt !== lastAtBefore) {
    setAwaitingFrom(undefined);
    setMessage(
      state.lastError
        ? { ok: false, text: state.lastError }
        : { ok: true, text: "Hraje do éteru (posluchači uslyší za pár sekund)." },
    );
  }

  async function save(patch: Partial<AiDjSettings>) {
    if (!state) return;
    setState({ ...state, settings: { ...state.settings, ...patch } });
    try {
      const res = await fetch("/api/radio/ai-dj", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) setState((await res.json()) as AiDjState);
    } catch {
      setMessage({ ok: false, text: "Nastavení se nepodařilo uložit." });
    }
  }

  async function speakNow() {
    setBusy(true);
    const before = state?.lastAt ?? null;
    setMessage({ ok: true, text: "Píšu a namlouvám vstup…" });
    try {
      const res = await fetch("/api/radio/ai-dj/now", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (data.ok) setAwaitingFrom(before);
      setMessage(
        data.ok
          ? { ok: true, text: "Píšu a namlouvám vstup — pustí se sám, jakmile bude hotový (do ~1 min)." }
          : { ok: false, text: data.error ?? "Vstup se nepovedl." },
      );
    } catch {
      setMessage({ ok: false, text: "Server neodpovídá." });
    } finally {
      setBusy(false);
      void load();
    }
  }

  if (!state) {
    return (
      <section>
        <h2 className="label mb-3">AI moderátor</h2>
        <p className="text-sm text-[var(--ink-muted)]">Načítám…</p>
      </section>
    );
  }

  const s = state.settings;
  const gapMax = Math.max(s.everyTracks, s.everyTracksMax ?? s.everyTracks);
  const gapLabel =
    gapMax === s.everyTracks ? `jednou za ${s.everyTracks} skladeb` : `náhodně po ${s.everyTracks}–${gapMax} skladbách`;
  const ready = state.configured.claude && state.configured.voice;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="label">AI moderátor</h2>
        {ready ? (
          <button
            type="button"
            role="switch"
            aria-checked={s.enabled}
            onClick={() => void save({ enabled: !s.enabled })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              s.enabled ? "bg-[var(--accent)]" : "bg-[var(--line-strong)]"
            }`}
            title={s.enabled ? "Vypnout" : "Zapnout"}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-[var(--ink)] transition-transform ${
                s.enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
        ) : null}
      </div>

      {!ready ? (
        <div className="space-y-1 text-sm text-[var(--ink-muted)]">
          <p>Chybí nastavení v <code className="text-[var(--ink)]">.env.local</code> na serveru:</p>
          {!state.configured.claude ? (
            <p>• NVIDIA_API_KEY (build.nvidia.com, zdarma) nebo ANTHROPIC_API_KEY</p>
          ) : null}
          {!state.configured.voice ? <p>• ELEVENLABS_API_KEY a ELEVENLABS_VOICE_ID (elevenlabs.io)</p> : null}
          <p className="pt-1 text-xs text-[var(--ink-faint)]">Pak restartuj rádio.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--ink-muted)]">
            {s.enabled
              ? `Mluví přes začátek písničky ${gapLabel}. Když jsi v éteru ty, mlčí.`
              : "Vypnutý — zapni přepínačem, nebo pusť jeden vstup ručně."}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-[var(--ink-muted)]">
            <label className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              Mluvit náhodně po
              <select
                value={s.everyTracks}
                onChange={(e) => void save({ everyTracks: Number(e.target.value), everyTracksMax: gapMax })}
                className="border-b border-[var(--line-strong)] bg-transparent py-1 text-sm text-[var(--ink)] outline-none"
                aria-label="Nejméně skladeb"
              >
                {GAP_OPTIONS.map((n) => (
                  <option key={n} value={n} className="bg-[var(--bg-panel)]">
                    {n}
                  </option>
                ))}
              </select>
              až
              <select
                value={gapMax}
                onChange={(e) => void save({ everyTracksMax: Number(e.target.value) })}
                className="border-b border-[var(--line-strong)] bg-transparent py-1 text-sm text-[var(--ink)] outline-none"
                aria-label="Nejvíc skladeb"
              >
                {GAP_OPTIONS.filter((n) => n >= s.everyTracks).map((n) => (
                  <option key={n} value={n} className="bg-[var(--bg-panel)]">
                    {n}
                  </option>
                ))}
              </select>
              skladbách
            </label>
            {(
              [
                ["weather", "Počasí"],
                ["news", "Zprávy"],
                ["onlyWithListeners", "Jen když někdo poslouchá"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={s[key]}
                  onChange={(e) => void save({ [key]: e.target.checked })}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                {label}
              </label>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || state.generating || awaiting}
              onClick={() => void speakNow()}
              className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
            >
              {busy || state.generating || awaiting ? "Připravuji…" : "Pustit vstup teď"}
            </button>
            <span className="text-xs text-[var(--ink-faint)]">
              dnes {state.budget.usedToday.toLocaleString("cs-CZ")} / {state.budget.todayAllowance.toLocaleString("cs-CZ")}
              {" · "}měsíc {state.budget.usedThisMonth.toLocaleString("cs-CZ")} /{" "}
              {state.budget.monthlyLimit.toLocaleString("cs-CZ")} kreditů
              {!state.budget.canSpeak ? " · dnes už nemluví" : ""}
            </span>
          </div>

          {message ? (
            <p className={`mt-3 text-sm ${message.ok ? "text-[var(--ink-muted)]" : "text-[var(--danger)]"}`}>
              {message.text}
            </p>
          ) : null}
          {state.lastText ? (
            <blockquote className="mt-4 rounded-xl bg-[var(--bg-deep)]/60 p-3 text-sm leading-snug text-[var(--ink-muted)]">
              „{state.lastText}“
            </blockquote>
          ) : null}
          {state.lastError && !message ? (
            <p className="mt-2 text-xs text-[var(--danger)]">Poslední chyba: {state.lastError}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
