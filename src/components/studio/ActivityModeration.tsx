"use client";

import { useCallback, useEffect, useState } from "react";

type Answer = { id: string; name: string; text: string; flagged: boolean; hidden: boolean; at: number };
type QuizTip = { id: string; name: string; guess: string; correct: boolean; flagged: boolean; hidden: boolean };
type Data = {
  question: { text: string; askedAt: number | null; readAt: number | null; answers: Answer[] } | null;
  board: { id: string; name: string; points: number }[];
  quiz: {
    kind: "year" | "artist";
    artist: string;
    title: string;
    phase: string;
    answers: QuizTip[];
  } | null;
};

function time(at: number): string {
  return new Date(at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

/** Studio: kontrola toho, co posluchači poslali do kvízu a na otázku dne — skrytá věc nezazní. */
export function ActivityModeration() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/activities/moderation", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData((await res.json()) as Data);
      setError(null);
    } catch {
      setError("Rádio teď neodpovídá.");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function act(target: "answer" | "quiz" | "player", id: string, hidden: boolean) {
    try {
      const res = await fetch("/api/radio/activities/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, id, hidden }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!d.ok) setError(d.error ?? "Nepovedlo se.");
    } catch {
      setError("Nepovedlo se.");
    }
    void load();
  }

  const hideBtn = (hidden: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-full border border-[var(--line-strong)] px-3 py-0.5 text-xs text-[var(--ink-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--ink)]"
    >
      {hidden ? "Vrátit" : "Skrýt"}
    </button>
  );

  return (
    <section>
      <h2 className="label mb-3">Kvíz a otázka dne</h2>
      {error ? <p className="mb-2 text-sm text-[var(--danger)]">{error}</p> : null}
      {!data ? (
        <p className="text-sm text-[var(--ink-muted)]">Načítám…</p>
      ) : (
        <div className="space-y-5 text-sm">
          <div>
            <h3 className="mb-1 font-semibold text-[var(--ink)]">Kvíz</h3>
            {data.quiz ? (
              <>
                <p className="text-[var(--ink-muted)]">
                  {data.quiz.kind === "artist" ? "Kdo zpívá" : "Z kterého roku je"} {data.quiz.artist} — {data.quiz.title}
                  {" · "}
                  {data.quiz.phase === "open" ? "sbírají se tipy" : data.quiz.phase === "pending" ? "čeká na otázku" : "vyhodnoceno"}
                </p>
                {data.quiz.answers.length ? (
                  <ul className="mt-2 max-h-56 divide-y divide-[var(--line)] overflow-y-auto">
                    {data.quiz.answers.map((a) => (
                      <li key={a.id} className={`flex items-center gap-2 py-1.5 ${a.hidden ? "opacity-50" : ""}`}>
                        <span className={a.correct ? "text-[var(--ok)]" : "text-[var(--ink-faint)]"}>{a.correct ? "✓" : "✗"}</span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-[var(--ink)]">{a.name || "bez jména"}</span>
                          <span className="text-[var(--ink-muted)]"> · {a.guess}</span>
                          {a.flagged ? <span className="text-[var(--danger)]"> · sprosté</span> : null}
                        </span>
                        {data.quiz!.phase === "open" ? hideBtn(a.hidden, () => void act("quiz", a.id, !a.hidden)) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[var(--ink-faint)]">Zatím žádný tip.</p>
                )}
              </>
            ) : (
              <p className="text-[var(--ink-faint)]">Teď neběží. Spustíš ho tlačítkem „Kvíz“ u AI moderátora.</p>
            )}
          </div>

          <div>
            <h3 className="mb-1 font-semibold text-[var(--ink)]">Otázka dne</h3>
            {data.question ? (
              <>
                <p className="text-[var(--ink-muted)]">
                  {data.question.text}
                  {" · "}
                  {data.question.readAt
                    ? `přečteno v ${time(data.question.readAt)}`
                    : data.question.askedAt
                      ? `položena v ${time(data.question.askedAt)}, odpovědi se čtou nejdřív po 40 min`
                      : "ještě nezazněla"}
                </p>
                {data.question.answers.length ? (
                  <ul className="mt-2 max-h-64 divide-y divide-[var(--line)] overflow-y-auto">
                    {data.question.answers.map((a) => (
                      <li key={a.id} className={`flex items-start gap-2 py-1.5 ${a.hidden ? "opacity-50" : ""}`}>
                        <span className="min-w-0 flex-1">
                          <span className="text-[var(--ink)]">{a.name || "bez jména"}</span>
                          <span className="text-[var(--ink-faint)]"> · {time(a.at)}</span>
                          {a.flagged ? <span className="text-[var(--danger)]"> · sprosté, nezazní</span> : null}
                          <span className="block text-[var(--ink-muted)]">{a.text}</span>
                        </span>
                        {!data.question!.readAt ? hideBtn(a.hidden, () => void act("answer", a.id, !a.hidden)) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[var(--ink-faint)]">Zatím žádná odpověď.</p>
                )}
              </>
            ) : (
              <p className="text-[var(--ink-faint)]">Dnes ještě nebyla.</p>
            )}
          </div>

          <div>
            <h3 className="mb-1 font-semibold text-[var(--ink)]">Žebříček týdne</h3>
            {data.board.length ? (
              <ul className="max-h-56 divide-y divide-[var(--line)] overflow-y-auto">
                {data.board.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5">
                    <span className="w-6 text-right tabular-nums text-[var(--ink-faint)]">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--ink)]">{p.name}</span>
                    <span className="tabular-nums text-[var(--ink-muted)]">{p.points}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Vyřadit „${p.name}“ z žebříčku? Body se smažou.`)) void act("player", p.id, true);
                      }}
                      className="shrink-0 rounded-full border border-[var(--line-strong)] px-3 py-0.5 text-xs text-[var(--ink-muted)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)]"
                    >
                      Vyřadit
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[var(--ink-faint)]">Tenhle týden zatím nikdo nebodoval.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
