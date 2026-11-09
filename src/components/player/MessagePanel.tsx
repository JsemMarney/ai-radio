"use client";

import { type FormEvent, useEffect, useState } from "react";
import { type RecordedVoice, VoiceRecorder } from "@/components/player/VoiceRecorder";

const FROM_KEY = "ai-radio-request-from";
const SENT_KEY = "ai-radio-sent-messages";

type Sent = { id: string; text: string; at: string };
type Reply = { id: string; reply: { from: string; text: string; at: string } };

function readSent(): Sent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]") as Sent[];
    return Array.isArray(raw) ? raw.slice(0, 10) : [];
  } catch {
    return [];
  }
}
const MAX = 300;

/** Vzkaz do studia — pozdrav, dotaz nebo tip pro moderátora (bez přání písničky). */
export function MessagePanel() {
  const [from, setFrom] = useState("");
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<RecordedVoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [replies, setReplies] = useState<Record<string, Reply["reply"]>>({});

  // Odpovědi moderátora k mým vzkazům — kontrola každých 30 s.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const mine = readSent();
      if (alive) setSent(mine);
      if (!mine.length) return;
      try {
        const res = await fetch(`/api/messages?ids=${mine.map((m) => m.id).join(",")}`, { cache: "no-store" });
        const data = (await res.json()) as { replies?: Reply[] };
        if (alive) setReplies(Object.fromEntries((data.replies ?? []).map((r) => [r.id, r.reply])));
      } catch {
        // stanice neodpovídá — zkusí se příště
      }
    };
    const t = setTimeout(() => void poll(), 0);
    const iv = setInterval(() => void poll(), 30_000);
    return () => {
      alive = false;
      clearTimeout(t);
      clearInterval(iv);
    };
  }, []);

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < 2 && !voice) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, text, voice: voice?.base64 }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; id?: string };
      if (data.ok) {
        if (data.id) {
          const next = [
            { id: data.id, text: text.trim() || "🎙 hlasovka", at: new Date().toISOString() },
            ...readSent(),
          ].slice(0, 10);
          try {
            localStorage.setItem(SENT_KEY, JSON.stringify(next));
          } catch {
            // storage nedostupný
          }
          setSent(next);
        }
        setText("");
        setVoice(null);
        setFeedback({ ok: true, text: "Odesláno — moderátor to uvidí ve studiu." });
        try {
          localStorage.setItem(FROM_KEY, from.trim());
        } catch {
          // storage nedostupný
        }
      } else {
        setFeedback({ ok: false, text: data.error ?? "Vzkaz se nepodařilo poslat." });
      }
    } catch {
      setFeedback({ ok: false, text: "Stanice teď neodpovídá." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p className="mb-3 text-sm text-[var(--ink-muted)]">Pozdrav, dotaz nebo tip — moderátor to uvidí ve studiu.</p>
      <form onSubmit={submit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          rows={4}
          placeholder="Pozdrav, dotaz nebo tip pro moderátora…"
          className="block w-full resize-none rounded-xl border border-[var(--line-strong)] bg-[var(--bg-deep)] p-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
        />
        <div className="mt-3">
          <VoiceRecorder value={voice} onChange={setVoice} />
        </div>
        <div className="mt-4 flex items-end gap-3">
          <label className="min-w-0 flex-1 text-xs text-[var(--ink-muted)]">
            Od koho <span className="text-[var(--ink-faint)]">(nepovinné)</span>
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              maxLength={40}
              className="mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="submit"
            disabled={busy || (text.trim().length < 2 && !voice)}
            className="shrink-0 rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            {busy ? "Posílám…" : "Poslat"}
          </button>
        </div>
      </form>
      {feedback ? (
        <p className={`mt-3 text-sm ${feedback.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`} role="status">
          {feedback.text}
        </p>
      ) : null}
      {sent.some((m) => replies[m.id]) ? (
        <ul className="mt-5 space-y-3" aria-label="Odpovědi moderátora">
          {sent
            .filter((m) => replies[m.id])
            .map((m) => (
              <li key={m.id} className="rounded-xl bg-[var(--bg-deep)]/60 p-3 text-sm">
                <p className="text-xs text-[var(--ink-faint)]">Tvůj vzkaz: {m.text}</p>
                <p className="mt-1 text-[var(--ink)]">
                  <span className="font-semibold text-[var(--accent)]">{replies[m.id]!.from}:</span> {replies[m.id]!.text}
                </p>
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}
