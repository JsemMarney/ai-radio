"use client";

import { useEffect, useMemo, useState } from "react";
import type { ListenerStatsSummary } from "@/lib/listener-stats";

const H = 260; // výška plochy grafu (px v SVG souřadnicích)
const W = 720;
const PAD_L = 34;
const PAD_B = 22;
const PAD_T = 10;

/** Pěkné kroky osy: 1, 2, 5, 10, 20… */
function niceMax(v: number): number {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  if (v <= 10) return Math.ceil(v / 2) * 2;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString("cs-CZ");
}

/** Graf posluchačů podle hodiny dne — průměr 7 dní (sloupce) a dnešek (čára). */
export function ListenerChart() {
  const [stats, setStats] = useState<ListenerStatsSummary | null>(null);
  const [showToday, setShowToday] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const [nowHour, setNowHour] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/radio/listener-stats", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ListenerStatsSummary;
        if (!stop && Array.isArray(data.week)) {
          setStats(data);
          setNowHour(new Date().getHours());
        }
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

  const derived = useMemo(() => {
    if (!stats) return null;
    const week = stats.week;
    const today = stats.today;
    const top = Math.max(1, ...week.map((r) => r.avg), ...(showToday ? today.map((r) => r.avg) : []));
    const yMax = niceMax(top);
    const totalAvg = week.reduce((s, r) => s + r.avg, 0);
    const active = week.filter((r) => r.avg > 0);
    // Nejsilnější souvislé okno 3 hodin — kdy se vyplatí moderovat.
    let bestWin = -1;
    let bestSum = -1;
    for (let h = 0; h < 24; h++) {
      const sum = [0, 1, 2].reduce((s, d) => s + (week[(h + d) % 24]?.avg ?? 0), 0);
      if (sum > bestSum) {
        bestSum = sum;
        bestWin = h;
      }
    }
    const todayPeak = Math.max(0, ...today.map((r) => r.peak));
    return { week, today, yMax, totalAvg, activeHours: active.length, bestWin, todayPeak };
  }, [stats, showToday]);

  if (!stats || !derived) return <p className="text-sm text-[var(--ink-muted)]">Načítám…</p>;

  const { week, today, yMax, totalAvg, activeHours, bestWin, todayPeak } = derived;
  const empty = week.every((r) => r.avg === 0 && r.peak === 0);
  const plotW = W - PAD_L;
  const plotH = H - PAD_B - PAD_T;
  const slot = plotW / 24;
  const x = (h: number) => PAD_L + h * slot;
  const y = (v: number) => PAD_T + plotH - (v / yMax) * plotH;
  const ticks = [0, yMax / 2, yMax];

  const todayPts = today
    .filter((r) => nowHour === null || r.hour <= nowHour)
    .map((r) => `${x(r.hour) + slot / 2},${y(r.avg)}`)
    .join(" ");

  const shown = hover !== null ? { w: week[hover]!, t: today[hover] } : null;

  return (
    <div>
      {/* Souhrn nahoře — hlavní čísla na první pohled */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Nejvíc lidí", stats.bestHour !== null && !empty ? `${stats.bestHour}:00` : "—"],
          ["Nejlepší 3 hodiny", bestWin >= 0 && !empty ? `${bestWin}–${(bestWin + 3) % 24} h` : "—"],
          ["Týdenní špička", String(stats.peakWeek || 0)],
          ["Dnes nejvíc", String(todayPeak)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[var(--line)] bg-[var(--bg-deep)]/50 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-[var(--ink-faint)]">{label}</p>
            <p className="mt-0.5 font-[family-name:var(--font-mono)] text-lg font-semibold tabular-nums text-[var(--ink)]">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4 text-[var(--ink-muted)]">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[var(--accent)]" aria-hidden />
            Průměr 7 dní
          </span>
          {showToday ? (
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-[var(--ink)]" aria-hidden />
              Dnes
            </span>
          ) : null}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[var(--ink-muted)]">
          <input
            type="checkbox"
            checked={showToday}
            onChange={(e) => setShowToday(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          Porovnat s dneškem
        </label>
      </div>

      {empty ? (
        <p className="py-10 text-center text-sm text-[var(--ink-faint)]">
          Data se sbírají — graf se naplní během pár hodin vysílání.
        </p>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full select-none"
            role="img"
            aria-label="Posluchači podle hodiny dne"
            onMouseLeave={() => setHover(null)}
          >
            {/* mřížka + osa Y */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text
                  x={PAD_L - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--ink-faint)"
                  className="tabular-nums"
                >
                  {fmt(t)}
                </text>
              </g>
            ))}
            {/* okno nejlepších 3 hodin */}
            {bestWin >= 0 && bestWin <= 21 ? (
              <rect x={x(bestWin)} y={PAD_T} width={slot * 3} height={plotH} fill="var(--accent)" opacity={0.06} rx={6} />
            ) : null}
            {/* sloupce: průměr 7 dní */}
            {week.map((r) => {
              const bh = Math.max(r.avg > 0 ? 3 : 0, (r.avg / yMax) * plotH);
              const isNow = r.hour === nowHour;
              const isHover = r.hour === hover;
              return (
                <rect
                  key={r.hour}
                  x={x(r.hour) + 2}
                  y={PAD_T + plotH - bh}
                  width={slot - 4}
                  height={bh}
                  rx={4}
                  fill="var(--accent)"
                  opacity={isHover ? 1 : isNow ? 0.9 : 0.55}
                />
              );
            })}
            {/* čára: dnešek */}
            {showToday && todayPts ? (
              <>
                <polyline
                  points={todayPts}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {today
                  .filter((r) => nowHour === null || r.hour <= nowHour)
                  .map((r) => (
                    <circle
                      key={r.hour}
                      cx={x(r.hour) + slot / 2}
                      cy={y(r.avg)}
                      r={r.hour === hover || r.hour === nowHour ? 4.5 : 0}
                      fill="var(--ink)"
                      stroke="var(--bg-panel)"
                      strokeWidth={2}
                    />
                  ))}
              </>
            ) : null}
            {/* teď */}
            {nowHour !== null ? (
              <line
                x1={x(nowHour) + slot / 2}
                x2={x(nowHour) + slot / 2}
                y1={PAD_T}
                y2={PAD_T + plotH}
                stroke="var(--ink)"
                strokeOpacity={0.35}
                strokeDasharray="3 4"
              />
            ) : null}
            {/* osa X */}
            {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
              <text key={h} x={x(h) + slot / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--ink-faint)">
                {h}:00
              </text>
            ))}
            {/* zásahové plochy pro hover (celý sloupec) */}
            {week.map((r) => (
              <rect
                key={`hit-${r.hour}`}
                x={x(r.hour)}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(r.hour)}
              />
            ))}
          </svg>

          {shown ? (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-[var(--line-strong)] bg-[var(--bg-panel)] px-3 py-2 text-xs shadow-lg"
              style={{ left: `${((x(hover!) + slot / 2) / W) * 100}%` }}
            >
              <p className="font-semibold text-[var(--ink)]">
                {hover}:00–{hover! + 1}:00
              </p>
              <p className="mt-0.5 whitespace-nowrap text-[var(--ink-muted)]">
                průměr <span className="font-semibold text-[var(--ink)]">{fmt(shown.w.avg)}</span> · špička {shown.w.peak}
              </p>
              {showToday && shown.t && (nowHour === null || hover! <= nowHour) ? (
                <p className="whitespace-nowrap text-[var(--ink-muted)]">
                  dnes <span className="font-semibold text-[var(--ink)]">{fmt(shown.t.avg)}</span> · špička {shown.t.peak}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
            Světlý pruh = nejlepší 3 hodiny (tam se vyplatí moderovat). Přerušovaná čára = teď.
            {activeHours ? ` Posloucháno ${activeHours} h denně, průměrně ${fmt(totalAvg / Math.max(1, activeHours))} lidí.` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
