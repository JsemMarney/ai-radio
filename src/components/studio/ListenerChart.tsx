"use client";

import { useEffect, useState } from "react";
import type { ListenerStatsSummary } from "@/lib/listener-stats";

/** Graf posluchačů podle hodiny dne — kdy má smysl moderovat. */
export function ListenerChart() {
  const [stats, setStats] = useState<ListenerStatsSummary | null>(null);
  const [mode, setMode] = useState<"week" | "today">("week");
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/radio/listener-stats", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ListenerStatsSummary;
        if (!stop && Array.isArray(data.week)) setStats(data);
      } catch {
        // offline
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  if (!stats) return <p className="text-sm text-[var(--ink-muted)]">Načítám…</p>;

  const rows = mode === "week" ? stats.week : stats.today;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.avg, mode === "today" ? r.peak : r.avg)));
  const nowHour = new Date().getHours();
  const empty = rows.every((r) => r.avg === 0 && r.peak === 0);
  const shown = hover !== null ? rows[hover]! : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--ink-muted)]">
          {stats.bestHour !== null && !empty ? (
            <>
              Nejvíc lidí poslouchá kolem{" "}
              <span className="font-semibold text-[var(--ink)]">{stats.bestHour}:00</span>
              {stats.peakWeek ? ` · týdenní špička ${stats.peakWeek}` : ""}
            </>
          ) : (
            "Data se sbírají — graf se naplní během pár hodin vysílání."
          )}
        </p>
        <div className="flex gap-1 rounded-full bg-[var(--bg-deep)] p-1 text-xs">
          {(
            [
              ["week", "Průměr 7 dní"],
              ["today", "Dnes"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-full px-3 py-1 font-semibold transition-colors ${
                mode === value ? "bg-[var(--accent)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <div className="flex h-40 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
          {rows.map((r) => {
            const h = (r.avg / max) * 100;
            const isNow = r.hour === nowHour;
            return (
              <div
                key={r.hour}
                className="group relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(r.hour)}
                title={`${r.hour}:00 — průměr ${r.avg}, špička ${r.peak}`}
              >
                <div
                  className={`w-full rounded-t-[3px] transition-colors ${
                    hover === r.hour
                      ? "bg-[var(--accent-soft)]"
                      : isNow
                        ? "bg-[var(--accent)]"
                        : "bg-[var(--accent)]/45"
                  }`}
                  style={{ height: `${Math.max(r.avg > 0 ? 3 : 1, h)}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-[var(--ink-faint)]">
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
            <span key={h}>{h}:00</span>
          ))}
        </div>
        {shown ? (
          <p className="mt-2 text-xs text-[var(--ink-muted)]">
            {shown.hour}:00–{shown.hour + 1}:00 · průměr{" "}
            <span className="font-semibold text-[var(--ink)]">{shown.avg}</span> · špička {shown.peak}
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--ink-faint)]">Najeď na sloupec pro detail. Zvýrazněná = teď.</p>
        )}
      </div>
    </div>
  );
}
