"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { clientId, FROM_KEY, read, write } from "@/components/player/QuizPanel";
import { QuizNotify } from "@/components/player/QuizNotify";

const ANSWER_KEY = "ai-radio-day-answer";

type Board = { week: string; top: { name: string; points: number }[] };
type Question = { date: string; text: string; open: boolean; read: boolean; answers: number };

const inputClass =
  "mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]";

function pts(n: number): string {
  return `${n} ${n === 1 ? "bod" : n >= 2 && n <= 4 ? "body" : "bodů"}`;
}

function readMyAnswer(date: string): string | null {
  try {
    const raw = JSON.parse(read(ANSWER_KEY) ?? "null") as { date: string; text: string } | null;
    return raw && raw.date === date ? raw.text : null;
  } catch {
    return null;
  }
}

/** Záložka „Kvíz“: otázka dne (odpověď z webu) a týdenní žebříček kvízu. */
export function ActivitiesPanel() {
  const [board, setBoard] = useState<Board | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [mine, setMine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/activities", { cache: "no-store" });
      const data = (await res.json()) as { board?: Board; question?: Question | null };
      setBoard(data.board ?? null);
      setQuestion(data.question ?? null);
      if (data.question) setMine(readMyAnswer(data.question.date));
    } catch {
      // offline — zkusí to znovu
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => {
      setName(read(FROM_KEY) ?? "");
      void load();
    }, 0);
    // Otázka i body přibývají během vysílání → obnovit, když je stránka vidět.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!question || busy) return;
    const answer = text.trim();
    if (answer.length < 2) {
      setError("Napiš odpověď.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/radio/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), text: answer, client: clientId() }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Odpověď se nepodařilo odeslat.");
        return;
      }
      if (name.trim()) write(FROM_KEY, name.trim());
      write(ANSWER_KEY, JSON.stringify({ date: question.date, text: answer }));
      setMine(answer);
      setText("");
    } catch {
      setError("Odpověď se nepodařilo odeslat, zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <QuizNotify />
      <section>
        <h3 className="label mb-2">Otázka dne</h3>
        {!loaded ? (
          <p className="text-sm text-[var(--ink-muted)]">Načítám…</p>
        ) : !question ? (
          <p className="text-sm text-[var(--ink-muted)]">
            Dnešní otázka ještě nezazněla. Moderátoři ji položí ve vysílání, pak sem můžeš poslat odpověď.
          </p>
        ) : (
          <>
            <p className="text-base font-semibold leading-snug text-[var(--ink)]">{question.text}</p>
            {mine ? (
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                Tvoje odpověď: <span className="text-[var(--ink)]">{mine}</span>
                {question.read ? "" : " · nejlepší odpovědi přečteme ve vysílání."}
              </p>
            ) : question.read ? (
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                Odpovědi jsme už přečetli ve vysílání. Zítra je nová otázka.
              </p>
            ) : (
              <form onSubmit={submit} className="mt-2 space-y-3">
                <label className="block text-xs text-[var(--ink-muted)]">
                  Jméno <span className="text-[var(--ink-faint)]">(nepovinné, přečteme ho s odpovědí)</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={24}
                    placeholder="Martin"
                    autoComplete="given-name"
                    className={inputClass}
                  />
                </label>
                <label className="block text-xs text-[var(--ink-muted)]">
                  Odpověď <span className="text-[var(--ink-faint)]">({140 - text.length} znaků)</span>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, 140))}
                    rows={2}
                    required
                    className={`${inputClass} resize-none`}
                  />
                </label>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-[var(--ink-faint)]">
                    Jedna odpověď na posluchače{question.answers ? ` · zatím ${question.answers}` : ""}.
                  </p>
                  <button
                    type="submit"
                    disabled={busy || text.trim().length < 2}
                    className="shrink-0 rounded-md bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
                  >
                    {busy ? "Posílám…" : "Odeslat"}
                  </button>
                </div>
              </form>
            )}
            {error ? (
              <p className="mt-2 text-sm text-[var(--danger)]" role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section>
        <h3 className="label mb-2">Kvízový žebříček týdne</h3>
        {board?.top.length ? (
          <ol className="divide-y divide-[var(--line)]">
            {board.top.map((row, i) => (
              <li key={`${row.name}-${i}`} className="flex items-center gap-3 py-2 text-sm">
                <span
                  className={`w-6 shrink-0 text-right tabular-nums ${i < 3 ? "font-bold text-[var(--accent-soft)]" : "text-[var(--ink-faint)]"}`}
                >
                  {i + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--ink)]">{row.name}</span>
                <span className="shrink-0 tabular-nums text-[var(--ink-muted)]">{pts(row.points)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-[var(--ink-muted)]">
            Tenhle týden zatím nikdo nebodoval.
          </p>
        )}
        <p className="mt-3 text-xs text-[var(--ink-faint)]">
          Bod za každou trefu v kvízu (tip se jménem). Kvíz se objeví nahoře, když ho moderátor vyhlásí. Vítěze
          týdne vyhlásíme v neděli večer.
        </p>
      </section>
    </div>
  );
}
