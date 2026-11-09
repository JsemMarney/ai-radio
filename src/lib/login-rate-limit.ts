import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Bucket = { count: number; resetAt: number };

/**
 * IP klienta. `x-forwarded-for` si klient může vymyslet, takže mu věříme jen
 * za vlastní reverse proxy (TRUST_PROXY=1) — a bereme poslední záznam, ten
 * přidala naše proxy. Bez proxy IP neznáme a vrací se null.
 */
export function getClientIp(request: Request): string | null {
  if (process.env.TRUST_PROXY !== "1") return null;
  const xff = request.headers.get("x-forwarded-for");
  const last = xff
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1);
  return last || request.headers.get("x-real-ip")?.trim() || null;
}

/** IP pro méně citlivé limity (přání) — i nedůvěryhodná je lepší než nic. */
export function getBestEffortIp(request: Request): string {
  return (
    getClientIp(request) ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly file?: string,
  ) {
    this.load();
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Record<
        string,
        Bucket
      >;
      const now = Date.now();
      for (const [k, b] of Object.entries(raw)) {
        if (b.resetAt > now) this.buckets.set(k, b);
      }
    } catch {
      // poškozený soubor — začít načisto
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(
        this.file,
        JSON.stringify(Object.fromEntries(this.buckets)),
        "utf8",
      );
    } catch {
      // limit funguje dál v paměti
    }
  }

  check(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now >= b.resetAt) return { allowed: true, retryAfterSec: 0 };
    if (b.count >= this.max) {
      return {
        allowed: false,
        retryAfterSec: Math.ceil((b.resetAt - now) / 1000),
      };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  hit(key: string): void {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      b.count += 1;
    }
    for (const [k, v] of this.buckets)
      if (v.resetAt <= now) this.buckets.delete(k);
    this.save();
  }

  clear(key: string): void {
    if (this.buckets.delete(key)) this.save();
  }
}

const stateFile = (name: string) => path.join(process.cwd(), "downloads", name);

const WINDOW_MS = 15 * 60 * 1000;
/** Na jednu IP (jen za důvěryhodnou proxy). */
const perIp = new RateLimiter(5, WINDOW_MS, stateFile(".login-limits.json"));
/** Pro všechny dohromady — brzda, i když IP neznáme nebo ji útočník střídá. */
const global = new RateLimiter(
  20,
  WINDOW_MS,
  stateFile(".login-limits-global.json"),
);
const GLOBAL_KEY = "*";

export function checkLoginRateLimit(ip: string | null): {
  allowed: boolean;
  retryAfterSec: number;
} {
  const g = global.check(GLOBAL_KEY);
  if (!g.allowed) return g;
  return ip ? perIp.check(ip) : { allowed: true, retryAfterSec: 0 };
}

export function recordLoginFailure(ip: string | null): void {
  global.hit(GLOBAL_KEY);
  if (ip) perIp.hit(ip);
}

export function clearLoginAttempts(ip: string | null): void {
  if (ip) perIp.clear(ip);
}

// ───────── přání posluchačů ─────────

/** Přání na jednu IP za hodinu (RADIO_REQUESTS_PER_HOUR, výchozí 1). */
const requestLimiter = new RateLimiter(
  Math.max(1, Number(process.env.RADIO_REQUESTS_PER_HOUR ?? 1) || 1),
  60 * 60 * 1000,
);

export function checkSongRequestLimit(ip: string): {
  allowed: boolean;
  retryAfterSec: number;
} {
  return requestLimiter.check(ip);
}

export function recordSongRequest(ip: string): void {
  requestLimiter.hit(ip);
}

// ───────── návrhy písniček do knihovny ─────────

const suggestLimiter = new RateLimiter(
  Number(process.env.RADIO_SUGGESTIONS_PER_IP ?? 5) || 5,
  60 * 60 * 1000,
);
const searchLimiter = new RateLimiter(40, 60 * 1000);

export function checkSuggestLimit(ip: string): {
  allowed: boolean;
  retryAfterSec: number;
} {
  return suggestLimiter.check(ip);
}

export function recordSuggest(ip: string): void {
  suggestLimiter.hit(ip);
}

/** Hledání na Spotify — ochrana API klíče před spamem. */
export function hitSearchLimit(ip: string): boolean {
  const r = searchLimiter.check(ip);
  if (!r.allowed) return false;
  searchLimiter.hit(ip);
  return true;
}

// ───────── vzkazy moderátorovi ─────────

const messageLimiter = new RateLimiter(
  Number(process.env.RADIO_MESSAGES_PER_IP ?? 3) || 3,
  10 * 60 * 1000,
);

export function checkMessageLimit(ip: string): {
  allowed: boolean;
  retryAfterSec: number;
} {
  return messageLimiter.check(ip);
}

export function recordMessage(ip: string): void {
  messageLimiter.hit(ip);
}
