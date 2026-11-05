"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { ScheduleAction, ScheduleEntry } from "@/lib/scheduler";
import type { LibraryTrack } from "@/lib/types";

const DAY_LABELS = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const ACTION_LABEL: Record<ScheduleAction, string> = {
  "break-arm": "Pauza po skladbě",
  "break-now": "Pauza hned",
  track: "Skladba jako další",
};

function daysText(days: number[]): string {
  if (!days.length || days.length === 7) return "každý den";
  if (days.join() === "1,2,3,4,5") return "Po–Pá";
  if (days.join() === "0,6") return "víkend";
  return DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAY_LABELS[d]).join(", ");
}

/** Plánovač: v daný čas pauza na slovo (tvůj blok) nebo konkrétní skladba. */
export function SchedulePanel({ library }: { library: LibraryTrack[] }) {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [time, setTime] = useState("20:00");
  const [days, setDays] = useState<number[]>([]);
  const [action, setAction] = useState<ScheduleAction>("break-arm");
  const [trackUuid, setTrackUuid] = useState("");
  const [label, setLabel] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/radio/schedule", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { entries?: ScheduleEntry[] };
      setEntries(data.entries ?? []);
    } catch {
      // offline
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function save(next: ScheduleEntry[]): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch("/api/radio/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { entries?: ScheduleEntry[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Plán se nepodařilo uložit.");
        return false;
      }
      setEntries(data.entries ?? next);
      return true;
    } catch {
      setError("Broadcaster neodpovídá.");
      return false;
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const entry = {
      id: "",
      time,
      days,
      action,
      ...(action === "track" ? { trackUuid } : {}),
      label: label || undefined,
      enabled: true,
    } as ScheduleEntry;
    if (await save([...entries, entry])) {
      setAdding(false);
      setLabel("");
    }
  }

  const playable = library.filter((t) => t.status === "ready" && t.audioFile);
  const trackName = (uuid?: string) => {
    const t = library.find((x) => x.uuid === uuid);
    return t ? `${t.artist} — ${t.title}` : "skladba";
  };

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="label">Plánovač</h2>
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-semibold text-[var(--accent-soft)] hover:text-[var(--ink)]"
          >
            + Přidat
          </button>
        ) : null}
      </div>

      {!entries.length && !adding ? (
        <p className="text-sm text-[var(--ink-muted)]">
          Nic naplánováno. Třeba „20:00 pauza po skladbě“ — rádio samo pustí podkres a ty můžeš mluvit.
        </p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li
              key={e.id}
              className={`flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0 ${e.enabled ? "" : "opacity-50"}`}
            >
              <span className="w-12 shrink-0 text-lg font-bold tabular-nums">{e.time}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {e.action === "track" ? trackName(e.trackUuid) : ACTION_LABEL[e.action]}
                  {e.label ? <span className="text-[var(--ink-muted)]"> · {e.label}</span> : null}
                </p>
                <p className="text-xs text-[var(--ink-faint)]">{daysText(e.days)}</p>
              </div>
              <button
                type="button"
                onClick={() => void save(entries.map((x) => (x.id === e.id ? { ...x, enabled: !x.enabled } : x)))}
                className="shrink-0 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                {e.enabled ? "Vypnout" : "Zapnout"}
              </button>
              <button
                type="button"
                onClick={() => void save(entries.filter((x) => x.id !== e.id))}
                className="shrink-0 text-xs text-[var(--ink-muted)] hover:text-[var(--danger)]"
              >
                Smazat
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={add} className="mt-3 space-y-3 rounded-xl bg-[var(--bg-deep)]/60 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[var(--ink-muted)]">
              Čas
              <input
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 block border-b border-[var(--line-strong)] bg-transparent py-1 text-lg font-bold tabular-nums text-[var(--ink)] outline-none [color-scheme:dark]"
              />
            </label>
            <label className="min-w-0 flex-1 text-xs text-[var(--ink-muted)]">
              Akce
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as ScheduleAction)}
                className="mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1.5 text-sm text-[var(--ink)] outline-none"
              >
                {(Object.keys(ACTION_LABEL) as ScheduleAction[]).map((a) => (
                  <option key={a} value={a} className="bg-[var(--bg-panel)]">
                    {ACTION_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {action === "track" ? (
            <select
              required
              value={trackUuid}
              onChange={(e) => setTrackUuid(e.target.value)}
              className="block w-full border-b border-[var(--line-strong)] bg-transparent py-1.5 text-sm text-[var(--ink)] outline-none"
            >
              <option value="" className="bg-[var(--bg-panel)]">
                Vyber skladbu…
              </option>
              {playable.map((t) => (
                <option key={t.uuid} value={t.uuid} className="bg-[var(--bg-panel)]">
                  {t.artist} — {t.title}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {DAY_ORDER.map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays((list) => (on ? list.filter((x) => x !== d) : [...list, d]))}
                  className={`h-8 w-9 rounded-full text-xs font-semibold transition-colors ${
                    on ? "bg-[var(--accent)] text-[var(--ink)]" : "border border-[var(--line-strong)] text-[var(--ink-muted)]"
                  }`}
                >
                  {DAY_LABELS[d]}
                </button>
              );
            })}
            <span className="self-center text-xs text-[var(--ink-faint)]">{days.length ? "" : "nic = každý den"}</span>
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            placeholder="Poznámka (např. Večerní show)"
            className="block w-full border-b border-[var(--line-strong)] bg-transparent py-1.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--accent-soft)]"
            >
              Uložit
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              Zrušit
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
      <p className="mt-3 text-xs text-[var(--ink-faint)]">Časy jsou podle Prahy. Pauzu ukončíš v kartě Pauza na slovo.</p>
    </section>
  );
}
