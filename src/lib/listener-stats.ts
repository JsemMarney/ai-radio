import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDownloadsDir } from "@/lib/library";
import { stationClock } from "@/lib/station-time";

/** Jedna hodina vysílání: součet vzorků (1/min), jejich počet a maximum. */
type HourBucket = { sum: number; n: number; peak: number };

export type HourSummary = { hour: number; avg: number; peak: number };

export type ListenerStatsSummary = {
  /** Průměr a špička podle hodiny dne za posledních 7 dní. */
  week: HourSummary[];
  /** Dnešek po hodinách. */
  today: HourSummary[];
  /** Hodina s nejvyšším průměrem za týden (null = zatím bez dat). */
  bestHour: number | null;
  peakWeek: number;
  days: number;
};

const KEEP_DAYS = 35;

function filePath(): string {
  return path.join(getDownloadsDir(), "listener-stats.json");
}

/** Statistika posluchačů — vzorek každou minutu, ukládá se po hodinách (čas stanice). */
export class ListenerStats {
  private buckets: Record<string, HourBucket> = {};
  private dirty = false;
  private loaded = false;

  async load(): Promise<void> {
    try {
      this.buckets = JSON.parse(await readFile(filePath(), "utf8")) as Record<string, HourBucket>;
    } catch {
      this.buckets = {};
    }
    this.loaded = true;
  }

  record(listeners: number): void {
    if (!this.loaded) return;
    const c = stationClock();
    const key = `${c.date}T${String(c.hour).padStart(2, "0")}`;
    const b = (this.buckets[key] ??= { sum: 0, n: 0, peak: 0 });
    b.sum += listeners;
    b.n += 1;
    b.peak = Math.max(b.peak, listeners);
    this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const key of Object.keys(this.buckets)) {
      if (key.slice(0, 10) < cutoff) delete this.buckets[key];
    }
    await mkdir(path.dirname(filePath()), { recursive: true });
    const tmp = `${filePath()}.tmp`;
    await writeFile(tmp, JSON.stringify(this.buckets), "utf8");
    await rename(tmp, filePath());
  }

  summary(): ListenerStatsSummary {
    const today = stationClock().date;
    const weekAgo = stationClock(new Date(Date.now() - 7 * 86_400_000)).date;
    const week = Array.from({ length: 24 }, () => ({ sum: 0, n: 0, peak: 0 }));
    const todayHours = Array.from({ length: 24 }, () => ({ sum: 0, n: 0, peak: 0 }));
    const days = new Set<string>();

    for (const [key, b] of Object.entries(this.buckets)) {
      const date = key.slice(0, 10);
      const hour = Number(key.slice(11, 13));
      if (date > weekAgo) {
        days.add(date);
        week[hour]!.sum += b.sum;
        week[hour]!.n += b.n;
        week[hour]!.peak = Math.max(week[hour]!.peak, b.peak);
      }
      if (date === today) {
        todayHours[hour] = { ...b };
      }
    }

    const toSummary = (rows: HourBucket[]): HourSummary[] =>
      rows.map((b, hour) => ({ hour, avg: b.n ? Math.round((b.sum / b.n) * 10) / 10 : 0, peak: b.peak }));
    const weekSummary = toSummary(week);
    const best = weekSummary.reduce<HourSummary | null>((m, h) => (h.avg > (m?.avg ?? 0) ? h : m), null);
    return {
      week: weekSummary,
      today: toSummary(todayHours),
      bestHour: best?.hour ?? null,
      peakWeek: Math.max(0, ...weekSummary.map((h) => h.peak)),
      days: days.size,
    };
  }
}
