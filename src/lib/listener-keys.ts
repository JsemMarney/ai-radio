import { createHash } from "node:crypto";
import { getBestEffortIp } from "@/lib/login-rate-limit";

/**
 * Otisky posluchače pro hlasování / kvíz (do vysílače nejde IP samotná):
 * net = síť (IP), voter = zařízení na té síti (náhodné id z prohlížeče) —
 * celá rodina na jedné Wi-Fi může hrát, každý zvlášť.
 */
export function listenerKeys(request: Request, client: unknown): { net: string; voter: string } {
  const ip = getBestEffortIp(request);
  const net = createHash("sha256").update(`quiz:${ip}`).digest("hex").slice(0, 32);
  const id = typeof client === "string" ? client.slice(0, 64) : "";
  const voter = createHash("sha256").update(`${net}:${id}`).digest("hex").slice(0, 32);
  return { net, voter };
}

/** Hrubá brzda proti zahlcení (na síť, za minutu). */
export function createLimiter(maxPerMinute: number): (key: string) => boolean {
  const hits = new Map<string, number[]>();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
    }
    return recent.length > maxPerMinute;
  };
}
