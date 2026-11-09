"use client";

import { useCallback, useEffect, useState } from "react";
import type { AiDjState, AiHost } from "@/lib/ai-dj";

/** Pondělí první, jak je zvykem v Česku (hodnoty: 0 = neděle … 6 = sobota). */
const DAYS: [number, string][] = [
  [1, "Po"],
  [2, "Út"],
  [3, "St"],
  [4, "Čt"],
  [5, "Pá"],
  [6, "So"],
  [0, "Ne"],
];

const HOST_COLORS = ["#ff3d6e", "#ffb347", "#5cc8ff", "#8be28b", "#c69cff", "#ff8fb1"];

function newHost(): AiHost {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
    name: "",
    voiceId: "",
    from: "06:00",
    to: "12:00",
    days: [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
  };
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Úseky směny během dne v minutách (přes půlnoc = dva úseky). */
function segments(h: AiHost): [number, number][] {
  const from = toMin(h.from);
  const to = toMin(h.to);
  if (from === to) return [[0, 1440]];
  if (from < to) return [[from, to]];
  return [
    [from, 1440],
    [0, to],
  ];
}

/** Studio → Moderátoři: AI moderátoři se směnami a vlastními hlasy ElevenLabs. */
export function AiHostsPanel() {
  const [state, setState] = useState<AiDjState | null>(null);
  const [hosts, setHosts] = useState<AiHost[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (resetForm: boolean) => {
    try {
      const res = await fetch("/api/radio/ai-dj", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as AiDjState;
      setState(data);
      if (resetForm) setHosts(data.settings.hosts ?? []);
    } catch {
      // offline
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(true), 0);
    // Jen stav („kdo má teď směnu“) — rozepsaný formulář se nepřepisuje.
    const timer = setInterval(() => void load(false), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  function patch(id: string, change: Partial<AiHost>) {
    setHosts((list) => list.map((h) => (h.id === id ? { ...h, ...change } : h)));
    setDirty(true);
    setMessage(null);
  }

  async function save() {
    const bad = hosts.find((h) => h.enabled && (!h.name.trim() || !/^[A-Za-z0-9]{8,64}$/.test(h.voiceId.trim())));
    if (bad) {
      setMessage({ ok: false, text: `Moderátor „${bad.name || "bez jména"}“ potřebuje jméno a platné ElevenLabs voice ID.` });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/radio/ai-dj", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hosts: hosts.map((h) => ({ ...h, voiceId: h.voiceId.trim(), name: h.name.trim() })) }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as AiDjState;
      setState(data);
      setHosts(data.settings.hosts ?? []);
      setDirty(false);
      setMessage({ ok: true, text: "Uloženo — platí hned." });
    } catch {
      setMessage({ ok: false, text: "Uložení se nepovedlo (běží broadcaster?)." });
    } finally {
      setSaving(false);
    }
  }

  if (!state) return <p className="text-sm text-[var(--ink-muted)]">Načítám…</p>;

  const active = state.activeHosts ?? [];
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/60 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="label">AI moderátoři</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {!state.settings.enabled ? (
              "AI moderátor je vypnutý (zapni ho na záložce Vysílání)."
            ) : active.length ? (
              <>
                Teď moderuje{active.length > 1 ? "jí" : ""}{" "}
                <span className="font-semibold text-[var(--ink)]">{active.join(" & ")}</span>
                {active.length > 1 ? " — spolu, rozhovorem" : ""}
              </>
            ) : (
              "Teď nikdo nemá směnu — hraje AutoDJ."
            )}
          </p>
        </div>
        <p className="mt-2 text-xs text-[var(--ink-faint)]">
          Každý moderátor má svůj hlas (ElevenLabs voice ID) a směnu. Když mají směnu dva naráz, mluví spolu jako
          rozhovor (stojí asi dvojnásobek kreditů). Když mají směnu tři a víc, losují se dva.
          {hosts.length === 0
            ? state.envVoice
              ? " Bez moderátorů se mluví hlasem z .env (ELEVENLABS_VOICE_ID) pořád."
              : " Přidej aspoň jednoho moderátora, jinak AI mlčí."
            : " Mimo směny AI mlčí a hraje AutoDJ."}
        </p>

        {/* Dnešní rozpis: kdo kdy mluví (překryv = rozhovor). */}
        {hosts.length ? (
          <div className="mt-5">
            <div className="relative h-2 rounded-full bg-[var(--line)]">
              <span
                className="absolute -top-1 h-4 w-0.5 bg-[var(--ink)]"
                style={{ left: `${(nowMin / 1440) * 100}%` }}
                title="Teď"
              />
            </div>
            <div className="mt-2 space-y-1.5">
              {hosts.map((h, i) =>
                h.days.includes(now.getDay()) && h.enabled ? (
                  <div key={h.id} className="flex items-center gap-3 text-xs">
                    <span className="w-24 shrink-0 truncate text-[var(--ink-muted)]">{h.name || "bez jména"}</span>
                    <div className="relative h-3 flex-1 rounded-full bg-[var(--line)]/50">
                      {segments(h).map(([a, b]) => (
                        <span
                          key={a}
                          className="absolute inset-y-0 rounded-full"
                          style={{
                            left: `${(a / 1440) * 100}%`,
                            width: `${((b - a) / 1440) * 100}%`,
                            background: HOST_COLORS[i % HOST_COLORS.length],
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
            <div className="mt-1 flex justify-between pl-[6.75rem] font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-faint)]">
              <span>0</span>
              <span>6</span>
              <span>12</span>
              <span>18</span>
              <span>24</span>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {hosts.map((h, i) => (
          <section
            key={h.id}
            className={`rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/60 p-4 ${h.enabled ? "" : "opacity-60"}`}
          >
            <div className="flex items-center gap-3">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: HOST_COLORS[i % HOST_COLORS.length] }}
                aria-hidden
              />
              <input
                value={h.name}
                onChange={(e) => patch(h.id, { name: e.target.value.slice(0, 40) })}
                placeholder="Jméno moderátora"
                aria-label="Jméno moderátora"
                className="min-w-0 flex-1 border-b border-[var(--line-strong)] bg-transparent py-1 text-base font-semibold text-[var(--ink)] outline-none focus:border-[var(--accent)]"
              />
              {active.includes(h.name) && state.settings.enabled ? (
                <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                  teď
                </span>
              ) : null}
            </div>

            <label className="mt-3 block text-xs text-[var(--ink-muted)]">
              ElevenLabs voice ID
              <input
                value={h.voiceId}
                onChange={(e) => patch(h.id, { voiceId: e.target.value.trim() })}
                placeholder="např. 21m00Tcm4TlvDq8ikWAM"
                spellCheck={false}
                className="mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1 font-[family-name:var(--font-mono)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
              />
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
              Mluví od
              <input
                type="time"
                value={h.from}
                onChange={(e) => patch(h.id, { from: e.target.value })}
                className="border-b border-[var(--line-strong)] bg-transparent py-1 text-sm text-[var(--ink)] outline-none [color-scheme:dark]"
              />
              do
              <input
                type="time"
                value={h.to}
                onChange={(e) => patch(h.id, { to: e.target.value })}
                className="border-b border-[var(--line-strong)] bg-transparent py-1 text-sm text-[var(--ink)] outline-none [color-scheme:dark]"
              />
              {h.from === h.to ? <span className="text-[var(--ink-faint)]">(celý den)</span> : null}
              {toMin(h.from) > toMin(h.to) ? <span className="text-[var(--ink-faint)]">(přes půlnoc)</span> : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {DAYS.map(([d, label]) => {
                const on = h.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => patch(h.id, { days: on ? h.days.filter((x) => x !== d) : [...h.days, d] })}
                    className={`h-8 w-9 rounded-full text-xs font-semibold transition-colors ${
                      on ? "bg-[var(--accent)] text-[var(--ink)]" : "bg-[var(--line)] text-[var(--ink-muted)]"
                    }`}
                    aria-pressed={on}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={(e) => patch(h.id, { enabled: e.target.checked })}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Aktivní
              </label>
              <button
                type="button"
                onClick={() => {
                  setHosts((list) => list.filter((x) => x.id !== h.id));
                  setDirty(true);
                }}
                className="text-xs text-[var(--danger)] hover:underline"
              >
                Odebrat
              </button>
            </div>
          </section>
        ))}

        <button
          type="button"
          onClick={() => {
            setHosts((list) => [...list, newHost()]);
            setDirty(true);
          }}
          className="min-h-40 rounded-2xl border border-dashed border-[var(--line-strong)] text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--ink)]"
        >
          + Přidat moderátora
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-40"
        >
          {saving ? "Ukládám…" : "Uložit moderátory"}
        </button>
        {dirty ? <span className="text-xs text-[var(--ink-faint)]">Neuložené změny</span> : null}
        {message ? (
          <span className={`text-sm ${message.ok ? "text-[var(--ink-muted)]" : "text-[var(--danger)]"}`}>
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
