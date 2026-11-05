"use client";

import { useCallback, useEffect, useState } from "react";
import { Cover } from "@/components/player/BroadcastUi";
import type { SongSuggestion } from "@/lib/suggestions";

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "teď";
  if (min < 60) return `před ${min} min`;
  if (min < 1440) return `před ${Math.round(min / 60)} h`;
  return `před ${Math.round(min / 1440)} d`;
}

/** Návrhy posluchačů na nové písničky — zkopírovat odkaz nebo rovnou stáhnout. */
export function SuggestionsPanel() {
  const [items, setItems] = useState<SongSuggestion[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/studio/suggestions", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { suggestions?: SongSuggestion[] };
      setItems(data.suggestions ?? []);
    } catch {
      // offline
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function act(id: string, action: "download" | "dismiss") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/studio/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(data.error ?? "Nepovedlo se.");
    } catch {
      setError("Server neodpovídá.");
    } finally {
      setBusyId(null);
      void load();
    }
  }

  async function copy(s: SongSuggestion) {
    try {
      await navigator.clipboard.writeText(s.url);
      setCopiedId(s.id);
      setTimeout(() => setCopiedId((c) => (c === s.id ? null : c)), 2000);
    } catch {
      setError("Schránka nejde — odkaz: " + s.url);
    }
  }

  const fresh = items.filter((s) => s.status === "new");
  const downloading = items.filter((s) => s.status === "downloading");

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="label">Návrhy do knihovny</h2>
        {fresh.length ? (
          <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs font-semibold text-[var(--ink)]">
            {fresh.length} nové
          </span>
        ) : null}
      </div>

      {!fresh.length ? (
        <p className="text-sm text-[var(--ink-muted)]">Zatím nikdo nic nenavrhl.</p>
      ) : (
        <ul className="space-y-2">
          {fresh.map((s) => (
            <li key={s.id} className="rounded-xl bg-[var(--bg-deep)]/60 p-3">
              <div className="flex items-center gap-3">
                <Cover src={s.thumbnail} size="sm" className="rounded-[2px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{s.title}</p>
                  <p className="truncate text-xs text-[var(--ink-muted)]">
                    {s.artist}
                    <span className="text-[var(--ink-faint)]">
                      {" "}
                      · {s.from ? `od ${s.from}` : "anonym"}
                      {s.votes > 1 ? ` · ${s.votes}× navrženo` : ""} · {ago(s.createdAt)}
                    </span>
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copy(s)}
                  className="rounded-full border border-[var(--line-strong)] px-3 py-1 text-xs transition-colors hover:border-[var(--ink)]"
                >
                  {copiedId === s.id ? "Zkopírováno ✓" : "Kopírovat odkaz"}
                </button>
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => void act(s.id, "download")}
                  className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
                >
                  Stáhnout
                </button>
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => void act(s.id, "dismiss")}
                  className="ml-auto text-xs text-[var(--ink-muted)] hover:text-[var(--danger)] disabled:opacity-50"
                >
                  Zahodit
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {downloading.length ? (
        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          Stahuje se ({downloading.length}): {downloading.map((s) => s.title).join(", ")} — průběh v záložce Import.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
    </section>
  );
}
