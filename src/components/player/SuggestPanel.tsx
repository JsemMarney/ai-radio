"use client";

import { useEffect, useState } from "react";
import { Cover } from "@/components/player/BroadcastUi";

type Found = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  thumbnail: string | null;
  inLibrary: boolean;
};

const FROM_KEY = "ai-radio-request-from";

/** „Chybí ti tu písnička?“ — posluchač ji najde na Spotify a navrhne do knihovny. */
export function SuggestPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [from, setFrom] = useState("");
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setFrom(localStorage.getItem(FROM_KEY) ?? "");
      } catch {
        // storage nedostupný
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      const clear = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(clear);
    }
    let stop = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/suggest/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const data = (await res.json()) as { tracks?: Found[]; error?: string };
        if (stop) return;
        setResults(data.tracks ?? []);
        if (data.error) setFeedback({ ok: false, text: data.error });
      } catch {
        if (!stop) setFeedback({ ok: false, text: "Hledání teď nejde." });
      } finally {
        if (!stop) setSearching(false);
      }
    }, 450);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function suggest(track: Found) {
    setBusyId(track.id);
    setFeedback(null);
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyId: track.id, from }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; votes?: number };
      if (data.ok) {
        setSentIds((s) => new Set(s).add(track.id));
        try {
          localStorage.setItem(FROM_KEY, from.trim());
        } catch {
          // storage nedostupný
        }
        setFeedback({
          ok: true,
          text:
            (data.votes ?? 1) > 1
              ? `Díky! „${track.title}“ už navrhlo ${data.votes} lidí — moderátor ji přidá.`
              : `Díky! Moderátor „${track.title}“ přidá do rádia.`,
        });
      } else {
        setFeedback({ ok: false, text: data.error ?? "Návrh se nepodařilo poslat." });
      }
    } catch {
      setFeedback({ ok: false, text: "Stanice teď neodpovídá." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <p className="mb-3 text-sm text-[var(--ink-muted)]">Chybí ti tu písnička? Najdi ji a moderátor ji přidá do rádia.</p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Hledej na Spotify…"
        className="w-full rounded-full border border-[var(--line-strong)] bg-[var(--bg-deep)] px-4 py-2.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
      />
      {results.length ? (
        <>
          <ul className="mt-3 max-h-72 overflow-y-auto pr-3">
            {results.map((t) => {
              const sent = sentIds.has(t.id);
              return (
                <li key={t.id} className="flex items-center gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0">
                  <Cover src={t.thumbnail} size="sm" className="rounded-[2px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{t.title}</p>
                    <p className="truncate text-xs text-[var(--ink-muted)]">
                      {t.artist}
                      {t.year ? <span className="text-[var(--ink-faint)]"> · {t.year}</span> : null}
                    </p>
                  </div>
                  {t.inLibrary ? (
                    <span className="shrink-0 text-xs text-[var(--ink-faint)]">už v rádiu</span>
                  ) : (
                    <button
                      type="button"
                      disabled={sent || busyId === t.id}
                      onClick={() => void suggest(t)}
                      className="shrink-0 rounded-full border border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                    >
                      {sent ? "Odesláno" : busyId === t.id ? "Posílám…" : "Navrhnout"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="mt-3 block text-xs text-[var(--ink-muted)]">
            Od koho <span className="text-[var(--ink-faint)]">(nepovinné)</span>
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              maxLength={40}
              className="mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        </>
      ) : query.trim().length >= 2 ? (
        <p className="py-6 text-center text-sm text-[var(--ink-muted)]">{searching ? "Hledám…" : "Nic jsme nenašli."}</p>
      ) : null}
      {feedback ? (
        <p className={`mt-3 text-sm ${feedback.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`} role="status">
          {feedback.text}
        </p>
      ) : null}
    </section>
  );
}
