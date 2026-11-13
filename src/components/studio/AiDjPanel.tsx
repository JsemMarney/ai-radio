"use client";

import { useCallback, useEffect, useState } from "react";
import type { AiDjSettings, AiDjState } from "@/lib/ai-dj";

/** Počet skladeb (1–100) — uloží se po opuštění pole nebo Enteru. */
function GapInput({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n) || n < 1) {
      setText(String(value));
      return;
    }
    const v = Math.min(100, n);
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={100}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      aria-label={label}
      className="w-14 border-b border-[var(--line-strong)] bg-transparent py-1 text-center text-sm text-[var(--ink)] outline-none"
    />
  );
}

/** AI moderátor — mluví mezi písničkami tvým naklonovaným hlasem. */
const FOCUS_LABEL: Record<string, string> = {
  "time-weather": "čas a počasí",
  listeners: "vzkazy",
  news: "zprávy",
  music: "hudba",
  vibe: "nálada",
  invite: "pozvánka",
  quiz: "kvíz",
  "quiz-answer": "odpověď na kvíz",
  "quiz-winners": "vítězové kvízu",
  question: "otázka dne",
  "question-read": "odpovědi na otázku dne",
  "hourly-news": "zprávy v celou",
  "voice-reply": "odpověď na hlasovku",
  request: "přání",
  handover: "předávka směny",
  "daily-summary": "denní shrnutí",
};

export function AiDjPanel() {
  const [state, setState] = useState<AiDjState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

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
  const [awaitingFrom, setAwaitingFrom] = useState<string | null | undefined>(
    undefined,
  );
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
        : {
            ok: true,
            text: "Vstup je připravený — zazní na začátku další písničky.",
          },
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

  async function rate(id: string, value: 1 | -1 | 0) {
    setState((s) =>
      s
        ? {
            ...s,
            log: s.log.map((e) =>
              e.id === id ? { ...e, rating: value || undefined } : e,
            ),
          }
        : s,
    );
    try {
      const res = await fetch("/api/radio/ai-dj", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate: { id, value } }),
      });
      if (res.ok) setState((await res.json()) as AiDjState);
    } catch {
      setMessage({ ok: false, text: "Hodnocení se nepodařilo uložit." });
    }
  }

  async function speakNow(quiz?: "year" | "artist") {
    setBusy(true);
    const before = state?.lastAt ?? null;
    setMessage({ ok: true, text: quiz ? "Chystám kvíz…" : "Píšu a namlouvám vstup…" });
    try {
      const res = await fetch("/api/radio/ai-dj/now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quiz ? { quiz } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (data.ok) setAwaitingFrom(before);
      setMessage(
        data.ok
          ? {
              ok: true,
              text: quiz
                ? `Kvíz na ${quiz === "artist" ? "interpreta" : "rok"} — otázka zazní na začátku další písničky, posluchačům se na webu otevře kvíz.`
                : "Píšu a namlouvám vstup — zazní na začátku další písničky.",
            }
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
    gapMax === s.everyTracks
      ? `jednou za ${s.everyTracks} skladeb`
      : `náhodně po ${s.everyTracks}–${gapMax} skladbách`;
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
          <p>
            Chybí nastavení v{" "}
            <code className="text-[var(--ink)]">.env.local</code> na serveru:
          </p>
          {!state.configured.claude ? (
            <p>
              • NVIDIA_API_KEY (build.nvidia.com, zdarma) nebo ANTHROPIC_API_KEY
            </p>
          ) : null}
          {!state.configured.voice ? (
            <p>• ELEVENLABS_API_KEY a ELEVENLABS_VOICE_ID (elevenlabs.io)</p>
          ) : null}
          <p className="pt-1 text-xs text-[var(--ink-faint)]">
            Pak restartuj rádio.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--ink-muted)]">
            {s.enabled
              ? `Mluví přes začátek písničky ${gapLabel}. Když jsi v éteru ty, mlčí.`
              : "Vypnutý — zapni přepínačem, nebo pusť jeden vstup ručně."}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-faint)]">
            {state.activeHosts?.length
              ? `Směna: ${state.activeHosts.join(" & ")}${state.activeHosts.length > 1 ? " (rozhovor)" : ""}`
              : "Teď nikdo nemá směnu — hraje AutoDJ."}{" "}
            · moderátory a časy nastavíš v záložce Moderátoři · ve Frontě vidíš,
            u které skladby promluví
          </p>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-[var(--ink-muted)]">
            <label className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              Mluvit náhodně po
              <GapInput
                key={`min-${s.everyTracks}`}
                value={s.everyTracks}
                label="Nejméně skladeb"
                onCommit={(n) =>
                  void save({
                    everyTracks: n,
                    everyTracksMax: Math.max(n, gapMax),
                  })
                }
              />
              až
              <GapInput
                key={`max-${gapMax}`}
                value={gapMax}
                label="Nejvíc skladeb"
                onCommit={(n) =>
                  void save(
                    n < s.everyTracks
                      ? { everyTracks: n, everyTracksMax: n }
                      : { everyTracksMax: n },
                  )
                }
              />
              skladbách
            </label>
            {(
              [
                ["weather", "Počasí"],
                ["news", "Zprávy"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2 text-sm text-[var(--ink)]"
              >
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

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
              Slovník výslovnosti
            </summary>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              Jeden řádek = „jak se píše = jak se čte“, třeba{" "}
              <code>CA$HANOVA = kešanova</code>. Hlas čte přepis, text zůstává.
            </p>
            <textarea
              defaultValue={s.pronunciations ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (s.pronunciations ?? ""))
                  void save({ pronunciations: e.target.value });
              }}
              rows={5}
              spellCheck={false}
              placeholder={
                "CA$HANOVA = kešanova\nΛTLΛS = atlas\nImagine Dragons = imedžin dragons"
              }
              aria-label="Slovník výslovnosti"
              className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--bg-deep)]/60 p-2 font-mono text-sm text-[var(--ink)]"
            />
          </details>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || state.generating || awaiting}
              onClick={() => void speakNow()}
              className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
            >
              {busy || state.generating || awaiting
                ? "Připravuji…"
                : "Vstup na další písničku"}
            </button>
            {(["year", "artist"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={busy || state.generating || awaiting}
                onClick={() => void speakNow(kind)}
                title={
                  kind === "artist"
                    ? "Interpret další písničky bude na webu schovaný jako ????, posluchači ho hádají."
                    : "Posluchači hádají, z kterého roku je další písnička."
                }
                className="rounded-full border border-[var(--line-strong)] px-4 py-1.5 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
              >
                {kind === "artist" ? "Kvíz: kdo zpívá" : "Kvíz: rok"}
              </button>
            ))}
            <span className="text-xs text-[var(--ink-faint)]">
              dnes {state.budget.usedToday.toLocaleString("cs-CZ")} /{" "}
              {state.budget.todayAllowance.toLocaleString("cs-CZ")}
              {" · "}
              {state.budget.credits ? "předplatné" : "měsíc"}{" "}
              {state.budget.usedThisMonth.toLocaleString("cs-CZ")} /{" "}
              {state.budget.monthlyLimit.toLocaleString("cs-CZ")} kreditů
              {!state.budget.canSpeak ? " · dnes už nemluví" : ""}
            </span>
          </div>

          {state.budget.credits || state.budget.advice ? (
            <div className="mt-4 rounded-xl bg-[var(--bg-deep)]/60 p-3 text-sm">
              {state.budget.credits ? (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-[var(--ink)]">
                      ElevenLabs kredity
                    </span>
                    <span className="text-xs text-[var(--ink-faint)]">
                      {state.budget.credits.tier
                        ? `${state.budget.credits.tier} · `
                        : ""}
                      {state.budget.credits.resetAt
                        ? `obnova ${new Date(state.budget.credits.resetAt).toLocaleDateString("cs-CZ")}`
                        : ""}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                    <div
                      className="h-full bg-[var(--accent)]"
                      style={{
                        width: `${Math.min(100, (state.budget.credits.remaining / Math.max(1, state.budget.credits.total)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-[var(--ink-muted)]">
                    Zbývá{" "}
                    <strong className="text-[var(--ink)]">
                      {state.budget.credits.remaining.toLocaleString("cs-CZ")}
                    </strong>{" "}
                    z {state.budget.credits.total.toLocaleString("cs-CZ")}{" "}
                    (celkem)
                  </p>
                </>
              ) : (
                <p className="text-xs text-[var(--ink-faint)]">
                  Skutečné kredity se nenačetly — u ElevenLabs API klíče zapni
                  oprávnění „User: Read“. Zatím se počítá s AI_DJ_MONTHLY_CHARS.
                </p>
              )}
              {state.budget.advice ? (
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  Vstup stojí průměrně ~{state.budget.advice.avgCost} kreditů,{" "}
                  {state.budget.advice.listenersOnly
                    ? "reálně se moderuje"
                    : "směny"}{" "}
                  ~{state.budget.advice.shiftHours} h denně
                  {state.budget.advice.listenersOnly
                    ? " (jen když někdo poslouchá)"
                    : ""}{" "}
                  → vyjde ~{state.budget.advice.perDay} vstupů denně. Doporučený
                  rozestup:{" "}
                  <strong className="text-[var(--ink)]">
                    {state.budget.advice.gapMin}–{state.budget.advice.gapMax}{" "}
                    skladeb
                  </strong>
                  {s.everyTracks !== state.budget.advice.gapMin ||
                  s.everyTracksMax !== state.budget.advice.gapMax ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={() =>
                          void save({
                            everyTracks: state.budget.advice!.gapMin,
                            everyTracksMax: state.budget.advice!.gapMax,
                          })
                        }
                        className="ml-1 rounded-full bg-[var(--accent)] px-2 py-0.5 font-semibold text-[var(--ink)]"
                      >
                        Nastavit
                      </button>
                    </>
                  ) : (
                    " ✓"
                  )}
                </p>
              ) : null}
            </div>
          ) : null}

          {message ? (
            <p
              className={`mt-3 text-sm ${message.ok ? "text-[var(--ink-muted)]" : "text-[var(--danger)]"}`}
            >
              {message.text}
            </p>
          ) : null}
          {state.lastText ? (
            <blockquote className="mt-4 whitespace-pre-line rounded-xl bg-[var(--bg-deep)]/60 p-3 text-sm leading-snug text-[var(--ink-muted)]">
              „{state.lastText}“
            </blockquote>
          ) : null}
          {state.log?.length ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
                Historie vstupů ({state.log.length})
              </summary>
              <p className="mt-1 text-xs text-[var(--ink-faint)]">
                Palcem ohodnoť vstupy — AI dostane povedené jako vzor a
                nepovedené jako „takhle ne“.
              </p>
              <ul className="mt-2 space-y-2">
                {state.log.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-xl bg-[var(--bg-deep)]/60 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-faint)]">
                      <span>
                        {new Date(e.at).toLocaleString("cs-CZ", {
                          day: "numeric",
                          month: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {e.airAt ? (
                        <span>
                          zazní ~
                          {new Date(e.airAt).toLocaleTimeString("cs-CZ", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      ) : null}
                      <span>{e.hosts.join(" & ")}</span>
                      <span>· {FOCUS_LABEL[e.focus] ?? e.focus}</span>
                      {e.cost ? <span>· {e.cost} kreditů</span> : null}
                      <span className="ml-auto flex gap-1">
                        {([1, -1] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            aria-label={
                              v === 1 ? "Povedený vstup" : "Nepovedený vstup"
                            }
                            aria-pressed={e.rating === v}
                            onClick={() =>
                              void rate(e.id, e.rating === v ? 0 : v)
                            }
                            className={`rounded-full px-2 py-0.5 transition-colors ${
                              e.rating === v
                                ? "bg-[var(--accent)] text-[var(--ink)]"
                                : "bg-[var(--bg-deep)] hover:bg-[var(--accent-soft)]"
                            }`}
                          >
                            {v === 1 ? "👍" : "👎"}
                          </button>
                        ))}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-[var(--ink-muted)]">
                      {e.text}
                    </p>
                    <audio
                      controls
                      preload="none"
                      src={`/api/radio/requests/voice?id=${e.id}`}
                      className="mt-2 h-8 w-full"
                    />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {state.lastError && !message ? (
            <p className="mt-2 text-xs text-[var(--danger)]">
              Poslední chyba: {state.lastError}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
