"use client";

import { useCallback, useEffect, useState } from "react";
import { Cover } from "@/components/player/BroadcastUi";
import { VoiceNoteControls } from "@/components/studio/VoiceNoteControls";
import { useRadio } from "@/components/RadioProvider";
import type { ListenerRequest } from "@/lib/types";

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "teď";
  if (min < 60) return `před ${min} min`;
  return `před ${Math.round(min / 60)} h`;
}

const STATUS_LABEL: Record<ListenerRequest["status"], string> = {
  pending: "čeká",
  approved: "ve frontě",
  played: "zaznělo",
  rejected: "zamítnuto",
  expired: "propadlo",
};

/** Přání posluchačů ke schválení — moderátor rozhodne, co zazní. */
export function RequestModeration() {
  const { moderationPending } = useRadio();
  const [pending, setPending] = useState<ListenerRequest[]>([]);
  const [recent, setRecent] = useState<ListenerRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/requests/moderation", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { pending?: ListenerRequest[]; recent?: ListenerRequest[] };
      setPending(data.pending ?? []);
      setRecent(data.recent ?? []);
    } catch {
      // offline
    }
  }, []);

  // Obnovit hned, když SSE ohlásí nové přání; jinak jednou za chvíli.
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, moderationPending]);

  async function decide(id: string, approve: boolean) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/radio/requests/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, approve }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(data.error ?? "Nepovedlo se.");
    } catch {
      setError("Broadcaster neodpovídá.");
    } finally {
      setBusyId(null);
      void load();
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="label">Přání posluchačů</h2>
        {pending.length ? (
          <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs font-semibold text-[var(--ink)]">
            {pending.length} ke schválení
          </span>
        ) : null}
      </div>

      {!pending.length ? (
        <p className="text-sm text-[var(--ink-muted)]">Žádné nové přání. Neschválená propadnou po 30 min.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((r) => (
            <li key={r.id} className="border border-[var(--line-strong)] p-3">
              <div className="flex items-center gap-3">
                <Cover src={r.thumbnail} size="sm" className="rounded-[2px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{r.title}</p>
                  <p className="truncate text-xs text-[var(--ink-muted)]">{r.artist}</p>
                </div>
                <span className="shrink-0 text-xs text-[var(--ink-faint)]">{ago(r.createdAt)}</span>
              </div>
              {r.from || r.message ? (
                <div className="mt-3 border-l-2 border-[var(--accent)] pl-3">
                  {r.message ? <p className="text-sm leading-snug">„{r.message}“</p> : null}
                  <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                    {r.from ? `od ${r.from}` : "bez podpisu"}
                  </p>
                </div>
              ) : null}
              {r.flagged ? (
                <p className="mt-2 text-xs text-[var(--danger)]">
                  Obsahovalo sprosté slovo — je vyhvězdičkované.
                </p>
              ) : null}
              {r.hasVoice ? <VoiceNoteControls id={r.id} sec={r.voiceSec} /> : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void decide(r.id, true)}
                  className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
                >
                  Schválit
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void decide(r.id, false)}
                  className="rounded-full border border-[var(--line-strong)] px-4 py-1.5 text-sm transition-colors hover:border-[var(--ink)] disabled:opacity-50"
                >
                  Zamítnout
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}

      {recent.length ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]">
            Vyřízená přání ({recent.length})
          </summary>
          <ul className="mt-2">
            {recent.map((r) => (
              <li key={r.id} className="border-t border-[var(--line)] py-1.5 text-xs first:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {r.title}
                    {r.from ? <span className="text-[var(--ink-muted)]"> · od {r.from}</span> : null}
                    {r.hasVoice ? <span className="text-[var(--accent-soft)]"> · hlasovka</span> : null}
                  </span>
                  <span className="shrink-0 text-[var(--ink-faint)]">{STATUS_LABEL[r.status]}</span>
                </div>
                {r.hasVoice && (r.status === "approved" || r.status === "played") ? (
                  <VoiceNoteControls id={r.id} sec={r.voiceSec} />
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
