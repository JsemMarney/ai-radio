/**
 * Ochrana streamu: limit souběžných poslechů na jednu IP a celkem.
 * Brání tomu, aby jeden klient (bot, restreamer) otevřel stovky spojení
 * a vyžral linku serveru. Limity jde změnit přes env:
 *   RADIO_STREAM_MAX_PER_IP (výchozí 4), RADIO_STREAM_MAX (výchozí 500).
 */

const perIp = new Map<string, number>();
let total = 0;

function limit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** IP posluchače — za reverzní proxy (Cloudflare, nginx) z hlaviček. */
export function clientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

/** Zabere místo pro spojení. Vrací uvolňovací funkci, nebo důvod odmítnutí. */
export function acquireStreamSlot(
  ip: string,
): { ok: true; release: () => void } | { ok: false; reason: string } {
  if (total >= limit("RADIO_STREAM_MAX", 500)) {
    return { ok: false, reason: "Rádio je teď plné — zkus to za chvíli." };
  }
  const mine = perIp.get(ip) ?? 0;
  if (mine >= limit("RADIO_STREAM_MAX_PER_IP", 4)) {
    return { ok: false, reason: "Z tvé adresy už hraje moc přehrávačů najednou." };
  }
  perIp.set(ip, mine + 1);
  total++;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      total = Math.max(0, total - 1);
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
    },
  };
}

export function streamGuardStats(): { total: number; ips: number } {
  return { total, ips: perIp.size };
}
