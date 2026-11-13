"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRadio } from "@/components/RadioProvider";
import { artistGuessMatches } from "@/lib/quiz-match";

export const FROM_KEY = "ai-radio-request-from";
const CLIENT_KEY = "ai-radio-client";
const TIP_KEY = "ai-radio-quiz-tip";

export function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage nedostupný
  }
}

/** Náhodné id zařízení — ať na jedné Wi-Fi může tipovat každý zvlášť. */
export function clientId(): string {
  let id = read(CLIENT_KEY);
  if (!id) {
    id = crypto.randomUUID();
    write(CLIENT_KEY, id);
  }
  return id;
}

/** Můj tip k danému kvízu (přežije obnovení stránky). */
function readTip(quizId: string): string | null {
  try {
    const raw = JSON.parse(read(TIP_KEY) ?? "null") as { id: string; tip: string } | null;
    return raw && raw.id === quizId && typeof raw.tip === "string" ? raw.tip : null;
  } catch {
    return null;
  }
}

const inputClass =
  "mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]";

/**
 * Kvíz: objeví se, když moderátor vyhlásí otázku (rok, nebo interpret — ten je pak
 * všude schovaný jako „????“). Jeden tip na posluchače, odpověď a kdo trefil
 * zazní hned po písničce — a ukáže se i tady.
 */
export function QuizPanel() {
  const { quiz } = useRadio();
  const [name, setName] = useState("");
  const [answer, setAnswer] = useState("");
  const [tip, setTip] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quizId = quiz?.id ?? null;

  useEffect(() => {
    const t = setTimeout(() => {
      setName(read(FROM_KEY) ?? "");
      setTip(quizId ? readTip(quizId) : null);
      setAnswer("");
      setError(null);
    }, 0);
    return () => clearTimeout(t);
  }, [quizId]);

  if (!quiz) return null;
  const artistQuiz = quiz.kind === "artist";
  const maxYear = new Date().getFullYear();
  const result = quiz.phase === "revealed" ? quiz.result : null;
  const ready = artistQuiz ? answer.trim().length >= 2 : answer.length === 4;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!quiz || busy) return;
    const guess = answer.trim();
    if (!artistQuiz) {
      const y = Number(guess);
      if (!Number.isInteger(y) || y < 1900 || y > maxYear) {
        setError(`Napiš rok mezi 1900 a ${maxYear}.`);
        return;
      }
    } else if (guess.length < 2) {
      setError("Napiš, kdo podle tebe zpívá.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/radio/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: quiz.id,
          name: name.trim(),
          ...(artistQuiz ? { answer: guess } : { year: Number(guess) }),
          client: clientId(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Tip se nepodařilo odeslat.");
        return;
      }
      if (name.trim()) write(FROM_KEY, name.trim());
      write(TIP_KEY, JSON.stringify({ id: quiz.id, tip: guess }));
      setTip(guess);
    } catch {
      setError("Tip se nepodařilo odeslat, zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  const hit =
    result && tip !== null
      ? artistQuiz
        ? artistGuessMatches(tip, result.answer)
        : tip === result.answer
      : false;

  return (
    <section
      className="glass animate-fade-up relative overflow-hidden rounded-md border border-[var(--accent)]/40 p-4 sm:p-6"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="label text-[var(--accent-soft)]">Hudební kvíz</h2>
        {quiz.phase === "open" ? (
          <span className="text-xs text-[var(--ink-muted)]">
            tipy do konce písničky
            {quiz.answers
              ? ` · ${quiz.answers} ${quiz.answers === 1 ? "tip" : quiz.answers <= 4 ? "tipy" : "tipů"}`
              : ""}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-lg font-semibold leading-snug text-[var(--ink)] sm:text-xl">
        {artistQuiz
          ? `Kdo zpívá písničku ${quiz.title}?`
          : `Z kterého roku je písnička ${quiz.artist}, ${quiz.title}?`}
      </p>

      {result ? (
        <div className="mt-3 space-y-1 text-sm">
          <p className="text-[var(--ink)]">
            Správně: <span className="font-semibold tabular-nums">{result.answer}</span>
            {tip !== null ? (
              <span className={hit ? "text-[var(--ok)]" : "text-[var(--ink-muted)]"}>
                {" "}· {hit ? "trefil(a) jsi!" : `tvůj tip: ${tip}`}
              </span>
            ) : null}
          </p>
          <p className="text-[var(--ink-muted)]">
            {result.right
              ? result.winners.length
                ? `Trefili: ${result.winners.join(", ")}${result.right > result.winners.length ? " a další" : ""}`
                : `Správných tipů: ${result.right}`
              : result.closest
                ? `Nikdo netrefil. Nejblíž: ${result.closest.name ? `${result.closest.name}, ` : ""}tip ${result.closest.year}.`
                : result.total
                  ? "Tentokrát to nikdo neuhodl."
                  : "Tentokrát nepřišel žádný tip."}
          </p>
        </div>
      ) : tip !== null ? (
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          Tvůj tip: <span className="font-semibold text-[var(--ink)]">{tip}</span>. Odpověď uslyšíš hned
          po písničce.
        </p>
      ) : quiz.phase !== "open" ? (
        <p className="mt-3 text-sm text-[var(--ink-muted)]">Tipy jsou uzavřené, odpověď uslyšíš za chvíli.</p>
      ) : (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 basis-40 text-xs text-[var(--ink-muted)]">
            Jméno <span className="text-[var(--ink-faint)]">(se jménem sbíráš body do žebříčku)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              placeholder="Martin"
              autoComplete="given-name"
              className={inputClass}
            />
          </label>
          {artistQuiz ? (
            <label className="min-w-0 flex-1 basis-48 text-xs text-[var(--ink-muted)]">
              Interpret
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value.slice(0, 60))}
                placeholder="Kdo to zpívá?"
                autoComplete="off"
                required
                className={inputClass}
              />
            </label>
          ) : (
            <label className="w-24 text-xs text-[var(--ink-muted)]">
              Rok
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                pattern="[0-9]{4}"
                placeholder="2009"
                required
                className={`${inputClass} tabular-nums`}
              />
            </label>
          )}
          <button
            type="submit"
            disabled={busy || !ready}
            className="shrink-0 rounded-md bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            {busy ? "Posílám…" : "Tipnout"}
          </button>
          <p className="basis-full text-xs text-[var(--ink-faint)]">Jen jeden tip, tak dobře rozmysli.</p>
        </form>
      )}
      {error ? (
        <p className="mt-2 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
