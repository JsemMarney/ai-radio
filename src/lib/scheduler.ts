import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDownloadsDir } from "@/lib/library";
import { stationClock } from "@/lib/station-time";

/**
 * Plánovač vysílání: v daný čas (čas stanice) udělá akci.
 *  - break-arm: pauza na slovo po dohrání skladby
 *  - break-now: pauza hned
 *  - track: skladba z knihovny jako další
 */
export type ScheduleAction = "break-arm" | "break-now" | "track";

export type ScheduleEntry = {
  id: string;
  /** HH:MM */
  time: string;
  /** 0 = neděle … 6 = sobota; prázdné = každý den. */
  days: number[];
  action: ScheduleAction;
  trackUuid?: string;
  label?: string;
  enabled: boolean;
  /** YYYY-MM-DD posledního spuštění — každý den nejvýš jednou. */
  lastFired?: string;
};

/** Když server zrovna neběžel, akci dohnat nejvýš takhle pozdě. */
const CATCH_UP_MIN = 5;
const MAX_ENTRIES = 50;

function filePath(): string {
  return path.join(getDownloadsDir(), "schedule.json");
}

export async function loadSchedule(): Promise<ScheduleEntry[]> {
  try {
    return JSON.parse(await readFile(filePath(), "utf8")) as ScheduleEntry[];
  } catch {
    return [];
  }
}

export async function saveSchedule(entries: ScheduleEntry[]): Promise<void> {
  await mkdir(path.dirname(filePath()), { recursive: true });
  const tmp = `${filePath()}.tmp`;
  await writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
  await rename(tmp, filePath());
}

/** Ověří a vyčistí seznam ze studia (zachová lastFired u existujících položek). */
export function sanitizeSchedule(input: unknown, previous: ScheduleEntry[]): ScheduleEntry[] | string {
  if (!Array.isArray(input)) return "Neplatný plán.";
  const out: ScheduleEntry[] = [];
  for (const raw of input.slice(0, MAX_ENTRIES)) {
    if (!raw || typeof raw !== "object") return "Neplatná položka plánu.";
    const r = raw as Record<string, unknown>;
    const time = typeof r.time === "string" ? r.time.trim() : "";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return `Neplatný čas „${time}“ (HH:MM).`;
    const action = r.action;
    if (action !== "break-arm" && action !== "break-now" && action !== "track") return "Neznámá akce.";
    const trackUuid = typeof r.trackUuid === "string" ? r.trackUuid : undefined;
    if (action === "track" && !trackUuid) return "Vyber skladbu.";
    const days = Array.isArray(r.days)
      ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [];
    const id = typeof r.id === "string" && r.id ? r.id.slice(0, 40) : randomUUID();
    const prev = previous.find((p) => p.id === id);
    out.push({
      id,
      time,
      days,
      action,
      ...(action === "track" ? { trackUuid } : {}),
      label: typeof r.label === "string" ? r.label.trim().slice(0, 60) || undefined : undefined,
      enabled: r.enabled !== false,
      // Upravený čas = smí se spustit znovu ještě dnes.
      lastFired: prev && prev.time === time ? prev.lastFired : undefined,
    });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** Položky, které mají právě teď proběhnout (a označí je jako spuštěné). */
export function dueEntries(entries: ScheduleEntry[], at = new Date()): ScheduleEntry[] {
  const c = stationClock(at);
  const nowMin = c.hour * 60 + c.minute;
  const due: ScheduleEntry[] = [];
  for (const e of entries) {
    if (!e.enabled || e.lastFired === c.date) continue;
    if (e.days.length && !e.days.includes(c.weekday)) continue;
    const [h, m] = e.time.split(":").map(Number);
    const diff = nowMin - (h! * 60 + m!);
    if (diff >= 0 && diff <= CATCH_UP_MIN) {
      e.lastFired = c.date;
      due.push(e);
    }
  }
  return due;
}
