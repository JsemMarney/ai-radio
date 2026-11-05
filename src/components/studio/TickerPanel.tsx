"use client";

import { useState } from "react";
import { useRadio } from "@/components/RadioProvider";

/** Vlastní texty do běžícího pruhu v přehrávači — jeden řádek = jedna zpráva. */
export function TickerPanel() {
  const { tickerMessages } = useRadio();
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? tickerMessages.join("\n");

  async function save(messages: string[]) {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/radio/ticker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setState("error");
        setError(data.error ?? "Nepodařilo se uložit.");
        return;
      }
      setDraft(null);
      setState("saved");
    } catch {
      setState("error");
      setError("Nepodařilo se uložit.");
    }
  }

  const lines = value.split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="label">Běžící pruh</h2>
        <span className="text-xs text-[var(--ink-faint)]">{lines.length}/5 zpráv</span>
      </div>
      <textarea
        value={value}
        rows={3}
        placeholder={"Každý řádek = jedna zpráva v pruhu\nnapř. Dnes od 20:00 živě se mnou!"}
        onChange={(e) => {
          setDraft(e.target.value);
          setState("idle");
        }}
        className="block w-full resize-y border border-[var(--line-strong)] bg-[var(--bg-panel)] p-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
      />
      <p className="mt-1 text-xs text-[var(--ink-faint)]">Max 5 řádků po 140 znacích. Zobrazí se na začátku pruhu.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={state === "saving" || draft === null}
          onClick={() => void save(lines)}
          className="inline-flex h-10 items-center rounded-full bg-[var(--accent)] px-5 font-[family-name:var(--font-display)] text-sm font-semibold uppercase tracking-wider text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
        >
          Uložit do pruhu
        </button>
        {tickerMessages.length > 0 ? (
          <button
            type="button"
            disabled={state === "saving"}
            onClick={() => void save([])}
            className="text-xs text-[var(--ink-muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline disabled:opacity-50"
          >
            Vymazat
          </button>
        ) : null}
        {state === "saved" ? <span className="text-xs text-[var(--ok)]">Uloženo</span> : null}
        {error ? <span className="text-xs text-[var(--danger)]">{error}</span> : null}
      </div>
    </section>
  );
}
