"use client";

import { useEffect, useMemo, useState } from "react";
import type { AiHost } from "@/lib/ai-dj";

/** Pondělí první (hodnoty: 0 = neděle … 6 = sobota). */
const WEEK: [number, string][] = [
  [1, "Po"],
  [2, "Út"],
  [3, "St"],
  [4, "Čt"],
  [5, "Pá"],
  [6, "So"],
  [0, "Ne"],
];

type Block = { host: AiHost; from: number; to: number; lane: number };

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function hm(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return m ? `${h}:${String(m).padStart(2, "0")}` : String(min === 1440 ? 24 : h);
}

/** Úseky směn pro každý den v týdnu (směna přes půlnoc pokračuje dalším dnem). */
function dayBlocks(hosts: AiHost[]): Map<number, Block[]> {
  const raw = new Map<number, Omit<Block, "lane">[]>();
  const add = (day: number, host: AiHost, from: number, to: number) => {
    if (to <= from) return;
    raw.set(day, [...(raw.get(day) ?? []), { host, from, to }]);
  };
  for (const h of hosts) {
    if (!h.enabled || !h.name.trim()) continue;
    const from = toMin(h.from);
    const to = toMin(h.to);
    for (const d of h.days) {
      if (from === to) add(d, h, 0, 1440);
      else if (from < to) add(d, h, from, to);
      else {
        add(d, h, from, 1440);
        add((d + 1) % 7, h, 0, to);
      }
    }
  }
  const out = new Map<number, Block[]>();
  for (const [day, list] of raw) {
    // Překryvy pod sebe (každý souběh = rozhovor dvou moderátorů).
    const lanes: number[] = [];
    const placed: Block[] = [];
    for (const b of [...list].sort((x, y) => x.from - y.from || y.to - x.to)) {
      let lane = lanes.findIndex((end) => end <= b.from);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = b.to;
      placed.push({ ...b, lane });
    }
    out.set(day, placed);
  }
  return out;
}

/** Týdenní rozvrh AI moderátorů: dny pod sebou, hodiny vodorovně, souběh = rozhovor. */
export function HostsWeekTimetable({
  hosts,
  colorOf,
}: {
  hosts: AiHost[];
  colorOf: (name: string) => string;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const blocks = useMemo(() => dayBlocks(hosts), [hosts]);

  // Zobrazený rozsah hodin: od první do poslední směny (zaokrouhleno na sudé hodiny).
  const [start, end] = useMemo(() => {
    let lo = 1440;
    let hi = 0;
    for (const list of blocks.values())
      for (const b of list) {
        lo = Math.min(lo, b.from);
        hi = Math.max(hi, b.to);
      }
    if (lo >= hi) return [0, 1440];
    return [Math.floor(lo / 120) * 120, Math.min(1440, Math.ceil(hi / 120) * 120)];
  }, [blocks]);
  const span = end - start;
  const pct = (min: number) => `${((Math.min(end, Math.max(start, min)) - start) / span) * 100}%`;
  const ticks: number[] = [];
  for (let t = start; t <= end; t += span > 720 ? 120 : 60) ticks.push(t);

  // Týdenní součty hodin podle jména.
  const totals = useMemo(() => {
    const sum = new Map<string, number>();
    for (const list of blocks.values())
      for (const b of list) sum.set(b.host.name, (sum.get(b.host.name) ?? 0) + (b.to - b.from));
    return [...sum.entries()];
  }, [blocks]);

  const today = now?.getDay();

  // Stejné dny po sobě sloučit do jednoho řádku („Po–Pá“, „Každý den“).
  const rows = useMemo(() => {
    const sig = (d: number) =>
      (blocks.get(d) ?? [])
        .map((b) => `${b.host.name}@${b.from}-${b.to}#${b.lane}`)
        .join("|");
    const out: { days: number[]; label: string }[] = [];
    for (const [day, label] of WEEK) {
      const last = out[out.length - 1];
      if (last && sig(last.days[0]!) === sig(day)) {
        last.days.push(day);
        last.label = `${last.label.split("–")[0]}–${label}`;
      } else out.push({ days: [day], label });
    }
    if (out.length === 1) out[0]!.label = "Každý den";
    return out;
  }, [blocks]);
  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : null;

  if (!totals.length) {
    return <p className="mt-5 text-sm text-[var(--ink-faint)]">Zatím žádné směny — přidej moderátora níže.</p>;
  }

  return (
    <div className="mt-5">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {totals.map(([name, min]) => (
          <span key={name} className="flex items-center gap-1.5 text-[var(--ink-muted)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(name) }} aria-hidden />
            <span className="font-semibold text-[var(--ink)]">{name}</span>
            {Math.round(min / 60)} h týdně
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[var(--ink-faint)]">
          <span className="h-2.5 w-4 rounded-sm bg-[var(--line)]/60" aria-hidden />
          mimo směny hraje AutoDJ
        </span>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-[600px]">
          {/* Osa hodin */}
          <div className="relative ml-[4.5rem] h-5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-faint)]">
            {ticks.map((t) => (
              <span
                key={t}
                className={`absolute ${t === start ? "" : t === end ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: pct(t) }}
              >
                {hm(t)}
              </span>
            ))}
          </div>

          <div className="space-y-1.5">
            {rows.map(({ days, label }) => {
              const day = days[0]!;
              const list = blocks.get(day) ?? [];
              const lanes = Math.max(1, ...list.map((b) => b.lane + 1));
              const isToday = today !== undefined && days.includes(today);
              return (
                <div key={day} className="flex items-stretch gap-2">
                  <div
                    className={`flex w-16 shrink-0 flex-col justify-center rounded-lg px-1 text-center text-xs font-semibold ${
                      isToday ? "bg-[var(--accent)] text-[var(--ink)]" : "text-[var(--ink-muted)]"
                    }`}
                  >
                    {label}
                    {isToday ? <span className="text-[9px] font-normal uppercase tracking-wider">dnes</span> : null}
                  </div>
                  <div
                    className={`relative flex-1 rounded-lg border ${
                      isToday ? "border-[var(--line-strong)] bg-[var(--line)]/40" : "border-transparent bg-[var(--line)]/25"
                    }`}
                    style={{ height: `${lanes * 26 + 8}px` }}
                  >
                    {ticks.map((t) => (
                      <span
                        key={t}
                        className="absolute inset-y-0 w-px bg-[var(--line)]"
                        style={{ left: pct(t) }}
                        aria-hidden
                      />
                    ))}
                    {list.map((b) => (
                      <button
                        key={`${b.host.id}-${b.from}`}
                        type="button"
                        onClick={() =>
                          document
                            .getElementById(`host-${b.host.id}`)
                            ?.scrollIntoView({ behavior: "smooth", block: "center" })
                        }
                        title={`${b.host.name} · ${hm(b.from)}–${hm(b.to)}`}
                        className="absolute flex items-center gap-1 overflow-hidden rounded-md px-2 text-left text-[11px] font-semibold text-[#14101a] shadow-sm transition-[filter] hover:brightness-110"
                        style={{
                          left: pct(b.from),
                          width: `calc(${pct(b.to)} - ${pct(b.from)} - 2px)`,
                          top: `${4 + b.lane * 26}px`,
                          height: "22px",
                          background: colorOf(b.host.name),
                        }}
                      >
                        <span className="truncate">{b.host.name}</span>
                        <span className="shrink-0 font-normal opacity-70">
                          {hm(b.from)}–{hm(b.to)}
                        </span>
                      </button>
                    ))}
                    {isToday && nowMin !== null && nowMin >= start && nowMin <= end ? (
                      <span
                        className="pointer-events-none absolute -inset-y-1 w-0.5 rounded bg-[var(--ink)]"
                        style={{ left: pct(nowMin) }}
                        title="Teď"
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
        Pod sebou = mají směnu naráz a mluví spolu rozhovorem. Klik na směnu skočí na nastavení moderátora.
      </p>
    </div>
  );
}
