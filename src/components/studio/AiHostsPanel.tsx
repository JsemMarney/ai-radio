"use client";

import { useCallback, useEffect, useState } from "react";
import type { AiDjState, AiHost } from "@/lib/ai-dj";
import { HostsWeekTimetable } from "@/components/studio/HostsWeekTimetable";

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

/** Studio → Moderátoři: AI moderátoři se směnami a vlastními hlasy ElevenLabs. */
export function AiHostsPanel() {
  const [state, setState] = useState<AiDjState | null>(null);
  const [hosts, setHosts] = useState<AiHost[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  /** Směna → moderátor (karta). Pevné, ať se karta při přepisování jména nerozpadne. */
  const [groupOf, setGroupOf] = useState<Record<string, string>>({});

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
  // Stejné jméno = stejná barva (jeden moderátor může mít víc směn).
  const names = [...new Set(hosts.map((h) => h.name.trim()).filter(Boolean))];
  // Jeden moderátor = jedna karta, v ní všechny jeho směny (v datech je každá směna zvlášť).
  const groups: AiHost[][] = [];
  const byName = new Map<string, AiHost[]>();
  for (const h of hosts) {
    const key = groupOf[h.id] ?? (h.name.trim().toLowerCase() || `id:${h.id}`);
    let g = byName.get(key);
    if (!g) {
      g = [];
      byName.set(key, g);
      groups.push(g);
    }
    g.push(h);
  }
  const colorOf = (name: string) => {
    const i = names.indexOf(name.trim());
    return HOST_COLORS[(i < 0 ? 0 : i) % HOST_COLORS.length]!;
  };

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

        <HostsWeekTimetable hosts={hosts} colorOf={colorOf} />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((g) => {
          const first = g[0]!;
          const ids = new Set(g.map((x) => x.id));
          const groupKey = groupOf[first.id] ?? (first.name.trim().toLowerCase() || `id:${first.id}`);
          const pin = (extra: string[] = []) =>
            setGroupOf((m) => {
              const next = { ...m };
              for (const id of [...ids, ...extra]) next[id] = groupKey;
              return next;
            });
          const patchAll = (change: Partial<AiHost>) => {
            if (change.name !== undefined) pin();
            setHosts((list) => list.map((x) => (ids.has(x.id) ? { ...x, ...change } : x)));
            setDirty(true);
            setMessage(null);
          };
          const enabled = g.some((x) => x.enabled);
          const weekly = Math.round(
            g.reduce((sum, x) => {
              if (!x.enabled) return sum;
              const len = x.from === x.to ? 1440 : (toMin(x.to) - toMin(x.from) + 1440) % 1440;
              return sum + len * x.days.length;
            }, 0) / 60,
          );
          return (
            <section
              key={first.id}
              className={`rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/60 p-4 ${enabled ? "" : "opacity-60"}`}
            >
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf(first.name) }} aria-hidden />
                <input
                  value={first.name}
                  onChange={(e) => patchAll({ name: e.target.value.slice(0, 40) })}
                  placeholder="Jméno moderátora"
                  aria-label="Jméno moderátora"
                  className="min-w-0 flex-1 border-b border-[var(--line-strong)] bg-transparent py-1 text-base font-semibold text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                />
                <span className="shrink-0 text-xs text-[var(--ink-faint)]">{weekly} h týdně</span>
                {active.includes(first.name) && state.settings.enabled ? (
                  <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                    teď
                  </span>
                ) : null}
              </div>

              <label className="mt-3 block text-xs text-[var(--ink-muted)]">
                ElevenLabs voice ID
                <input
                  value={first.voiceId}
                  onChange={(e) => patchAll({ voiceId: e.target.value.trim() })}
                  placeholder="např. 21m00Tcm4TlvDq8ikWAM"
                  spellCheck={false}
                  className="mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1 font-[family-name:var(--font-mono)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                />
              </label>

              <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">Směny</p>
              <ul className="mt-2 space-y-2">
                {g.map((h) => (
                  <li
                    key={h.id}
                    id={`host-${h.id}`}
                    className="rounded-xl border border-[var(--line)] bg-[var(--bg-deep)]/40 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                      <input
                        type="time"
                        value={h.from}
                        onChange={(e) => patch(h.id, { from: e.target.value })}
                        aria-label="Od"
                        className="border-b border-[var(--line-strong)] bg-transparent py-1 text-sm text-[var(--ink)] outline-none [color-scheme:dark]"
                      />
                      –
                      <input
                        type="time"
                        value={h.to}
                        onChange={(e) => patch(h.id, { to: e.target.value })}
                        aria-label="Do"
                        className="border-b border-[var(--line-strong)] bg-transparent py-1 text-sm text-[var(--ink)] outline-none [color-scheme:dark]"
                      />
                      {h.from === h.to ? <span className="text-[var(--ink-faint)]">(celý den)</span> : null}
                      {toMin(h.from) > toMin(h.to) ? <span className="text-[var(--ink-faint)]">(přes půlnoc)</span> : null}
                      <span className="flex-1" />
                      {g.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setHosts((list) => list.filter((x) => x.id !== h.id));
                            setDirty(true);
                          }}
                          className="text-[var(--ink-faint)] hover:text-[var(--danger)]"
                          aria-label="Smazat směnu"
                          title="Smazat směnu"
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {DAYS.map(([d, label]) => {
                        const on = h.days.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => patch(h.id, { days: on ? h.days.filter((x) => x !== d) : [...h.days, d] })}
                            className={`h-7 w-8 rounded-full text-[11px] font-semibold transition-colors ${
                              on ? "bg-[var(--accent)] text-[var(--ink)]" : "bg-[var(--line)] text-[var(--ink-muted)]"
                            }`}
                            aria-pressed={on}
                          >
                            {label}
                          </button>
                        );
                      })}
                      <span className="ml-1 flex gap-1 text-[10px] text-[var(--ink-faint)]">
                        {(
                          [
                            ["Po–Pá", [1, 2, 3, 4, 5]],
                            ["So–Ne", [0, 6]],
                            ["Denně", [0, 1, 2, 3, 4, 5, 6]],
                          ] as [string, number[]][]
                        ).map(([label, days]) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => patch(h.id, { days })}
                            className="rounded-full border border-[var(--line)] px-2 py-1 hover:border-[var(--accent)] hover:text-[var(--ink)]"
                          >
                            {label}
                          </button>
                        ))}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  const last = g[g.length - 1]!;
                  const added = newHost();
                  pin([added.id]);
                  setHosts((list) => [
                    ...list,
                    { ...added, name: first.name, voiceId: first.voiceId, enabled: first.enabled, from: last.to, to: last.to === "22:00" ? "23:00" : "22:00", days: [...last.days] },
                  ]);
                  setDirty(true);
                }}
                className="mt-2 w-full rounded-xl border border-dashed border-[var(--line-strong)] py-2 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--ink)]"
              >
                + Přidat směnu (jiný čas nebo jiné dny)
              </button>

              <div className="mt-4 flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => patchAll({ enabled: e.target.checked })}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  Aktivní
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setHosts((list) => list.filter((x) => !ids.has(x.id)));
                    setDirty(true);
                  }}
                  className="text-xs text-[var(--danger)] hover:underline"
                >
                  Odebrat moderátora
                </button>
              </div>
            </section>
          );
        })}

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
