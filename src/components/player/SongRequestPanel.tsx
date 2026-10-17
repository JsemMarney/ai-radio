"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { RadioNowPlaying, RequestStatusView } from "@/lib/types";
import { Cover, LogRow } from "@/components/player/BroadcastUi";
import { type RecordedVoice, VoiceRecorder } from "@/components/player/VoiceRecorder";

const MY_REQUESTS_KEY = "ai-radio-my-requests";
const FROM_KEY = "ai-radio-request-from";

type Stored = { id: string; at: number };

function readMine(): Stored[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MY_REQUESTS_KEY) ?? "[]") as Stored[];
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    return raw.filter((r) => r && typeof r.id === "string" && r.at > dayAgo).slice(0, 10);
  } catch {
    return [];
  }
}

function saveMine(list: Stored[]): void {
  try {
    localStorage.setItem(MY_REQUESTS_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {
    // storage nedostupný
  }
}

function statusText(r: RequestStatusView): { text: string; tone: "wait" | "ok" | "no" } {
  switch (r.status) {
    case "pending":
      return { text: "čeká na moderátora", tone: "wait" };
    case "approved":
      return {
        text: r.position === 1 ? "schváleno — hraje jako další" : r.position ? `schváleno — ${r.position}. v pořadí` : "schváleno",
        tone: "ok",
      };
    case "played":
      return { text: "zaznělo", tone: "ok" };
    case "rejected":
      return { text: "tentokrát ne", tone: "no" };
    default:
      return { text: "moderátor nestihl", tone: "no" };
  }
}

export function SongRequestPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<RadioNowPlaying[]>([]);
  const [selected, setSelected] = useState<RadioNowPlaying | null>(null);
  const [from, setFrom] = useState("");
  const [note, setNote] = useState("");
  const [voice, setVoice] = useState<RecordedVoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [mine, setMine] = useState<Stored[]>([]);
  const [statuses, setStatuses] = useState<RequestStatusView[]>([]);

  const load = useCallback(async (search: string) => {
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/radio/requests?${params}`, { cache: "no-store" });
      const data = (await res.json()) as { enabled?: boolean; tracks?: RadioNowPlaying[] };
      setEnabled(Boolean(data.enabled));
      setTracks(data.tracks ?? []);
    } catch {
      setEnabled(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(query), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setMine(readMine());
      try {
        setFrom(localStorage.getItem(FROM_KEY) ?? "");
      } catch {
        // storage nedostupný
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Stav vlastních přání — dokud nějaké čeká nebo jde na řadu.
  useEffect(() => {
    if (!mine.length) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/radio/requests/status?ids=${mine.map((m) => m.id).join(",")}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as { requests?: RequestStatusView[] };
        if (!stop) setStatuses(data.requests ?? []);
      } catch {
        // offline
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 10_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [mine]);

  if (enabled === false) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/radio/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: selected.uuid, from, message: note, voice: voice?.base64 }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; id?: string; status?: string };
      if (data.ok && data.id) {
        const next = [{ id: data.id, at: Date.now() }, ...mine];
        saveMine(next);
        setMine(next);
        try {
          localStorage.setItem(FROM_KEY, from.trim());
        } catch {
          // storage nedostupný
        }
        setFeedback({
          ok: true,
          text:
            data.status === "pending"
              ? "Díky! Přání čeká, až ho moderátor schválí."
              : "Díky! Přání je ve frontě.",
        });
        setSelected(null);
        setNote("");
        setVoice(null);
        void load(query);
      } else {
        setFeedback({ ok: false, text: data.error ?? "Přání se nepodařilo odeslat." });
      }
    } catch {
      setFeedback({ ok: false, text: "Stanice teď neodpovídá." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="label mb-3">Přání</h2>

      {statuses.length ? (
        <div className="mb-6">
          <p className="mb-1 text-xs text-[var(--ink-muted)]">Tvoje přání</p>
          <ul>
            {statuses.map((r) => {
              const s = statusText(r);
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 border-t border-[var(--line)] py-2 text-sm first:border-t-0"
                >
                  <span className="min-w-0 truncate">
                    {r.title} <span className="text-[var(--ink-muted)]">— {r.artist}</span>
                  </span>
                  <span
                    className={`shrink-0 text-xs ${
                      s.tone === "ok"
                        ? "text-[var(--ok)]"
                        : s.tone === "no"
                          ? "text-[var(--ink-faint)]"
                          : "text-[var(--accent)]"
                    }`}
                  >
                    {s.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {selected ? (
        <form onSubmit={submit} className="border border-[var(--line-strong)] p-4">
          <div className="flex items-center gap-3">
            <Cover src={selected.thumbnail} size="sm" className="rounded-[2px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{selected.title}</p>
              <p className="truncate text-xs text-[var(--ink-muted)]">{selected.artist}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              Zpět
            </button>
          </div>
          <label className="mt-4 block text-xs text-[var(--ink-muted)]">
            Od koho <span className="text-[var(--ink-faint)]">(nepovinné)</span>
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              maxLength={40}
              placeholder="Martin"
              className="mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
            />
          </label>
          <label className="mt-4 block text-xs text-[var(--ink-muted)]">
            Vzkaz do éteru <span className="text-[var(--ink-faint)]">(nepovinné, {200 - note.length} znaků)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              rows={3}
              placeholder="Pro Petru, ať se jí daří na zkoušce!"
              className="mt-1 block w-full resize-none border-b border-[var(--line-strong)] bg-transparent py-1.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
            />
          </label>
          <div className="mt-4">
            <VoiceRecorder value={voice} onChange={setVoice} />
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--ink-faint)]">Přání nejdřív uvidí moderátor.</p>
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
            >
              {busy ? "Posílám…" : "Poslat přání"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Interpret nebo název skladby"
            className="w-full border-b border-[var(--line-strong)] bg-transparent py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
          />
          <ul className="mt-2 max-h-72 overflow-y-auto pr-1">
            {tracks.length ? (
              tracks.map((track) => (
                <LogRow
                  key={track.uuid}
                  track={track}
                  aside={
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(track);
                        setFeedback(null);
                      }}
                      className="shrink-0 rounded-full border border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      Přát si
                    </button>
                  }
                />
              ))
            ) : (
              <li className="py-6 text-center text-sm text-[var(--ink-muted)]">
                {enabled === null ? "Načítám…" : "Nic jsme nenašli."}
              </li>
            )}
          </ul>
        </>
      )}

      {feedback ? (
        <p
          className={`mt-3 text-sm ${feedback.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}
          role="status"
        >
          {feedback.text}
        </p>
      ) : null}
    </section>
  );
}
