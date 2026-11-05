/** Čas stanice (výchozí Europe/Prague) — server v kontejneru běží v UTC. */
export function getStationTimeZone(): string {
  return process.env.RADIO_TZ?.trim() || "Europe/Prague";
}

export type StationClock = {
  /** YYYY-MM-DD */
  date: string;
  hour: number;
  minute: number;
  /** 0 = neděle … 6 = sobota */
  weekday: number;
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function stationClock(at = new Date()): StationClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: getStationTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}
