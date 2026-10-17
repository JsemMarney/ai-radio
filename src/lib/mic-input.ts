import { createHmac, timingSafeEqual } from "node:crypto";
import { getBrokerSecret } from "@/lib/broker-auth";
import { SAMPLE_RATE } from "@/lib/pcm-deck";

/** Prohlížeč posílá mono s16le v 44.1 kHz (převzorkuje si sám). */
const PREBUFFER_SEC = 0.15;
/** Víc v bufferu = klient posílá rychleji než mixer čte → zahodit staré. */
const MAX_BUFFER_SEC = 0.6;
const STALE_MS = 1500;

/**
 * Mikrofon moderátora — malý jitter buffer mezi WebSocketem a mixerem.
 */
export class MicInput {
  private chunks: Int16Array[] = [];
  private head = 0;
  private buffered = 0;
  private started = false;
  private lastDataAt = 0;
  connected = true;

  push(data: Buffer): void {
    const samples = Math.floor(data.length / 2);
    if (!samples) return;
    const copy = new Int16Array(samples);
    for (let i = 0; i < samples; i++) copy[i] = data.readInt16LE(i * 2);
    this.chunks.push(copy);
    this.buffered += samples;
    this.lastDataAt = Date.now();

    const max = SAMPLE_RATE * MAX_BUFFER_SEC;
    while (this.buffered > max && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      this.buffered -= dropped.length - this.head;
      this.head = 0;
    }
  }

  /** Mikrofon je připojený a posílá data. */
  get active(): boolean {
    return this.connected && Date.now() - this.lastDataAt < STALE_MS;
  }

  /** Vrátí `n` vzorků (-1…1). Při podtečení doplní ticho. */
  read(n: number): Float32Array {
    const out = new Float32Array(n);
    if (!this.started) {
      if (this.buffered < SAMPLE_RATE * PREBUFFER_SEC) return out;
      this.started = true;
    }
    let i = 0;
    while (i < n && this.chunks.length) {
      const chunk = this.chunks[0]!;
      while (i < n && this.head < chunk.length) {
        out[i++] = chunk[this.head++]! / 32768;
      }
      if (this.head >= chunk.length) {
        this.chunks.shift();
        this.head = 0;
      }
    }
    this.buffered = Math.max(0, this.buffered - i);
    // Buffer došel — znovu nabrat zásobu, ať hlas necuká.
    if (i < n) this.started = false;
    return out;
  }
}

// ───────── vstupenka pro WebSocket (prohlížeč neumí poslat Authorization) ─────────

const TICKET_TTL_SEC = 60;

function ticketSecret(): string | null {
  return getBrokerSecret() ?? null;
}

export function makeMicTicket(): string {
  const secret = ticketSecret();
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;
  if (!secret) return `${exp}.dev`;
  const sig = createHmac("sha256", secret).update(`mic:${exp}`).digest("base64url");
  return `${exp}.${sig}`;
}

export function verifyMicTicket(ticket: string | null): boolean {
  const secret = ticketSecret();
  if (!secret) return true; // vývoj bez BROKER_SECRET — stejně jako zbytek API brokeru
  if (!ticket) return false;
  const [expRaw, sig] = ticket.split(".");
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000) || !sig) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(`mic:${exp}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getMicPort(): number {
  const raw = Number(process.env.RADIO_STREAM_PORT ?? 8788);
  return Number.isFinite(raw) && raw > 0 ? raw : 8788;
}

/** Kam se prohlížeč ve studiu připojí. Za proxy nastav RADIO_MIC_WS_URL. */
/**
 * Mikrofon jde přes stejný port jako web (startér index.js přeposílá /mic
 * na broadcaster) — typicky hosting s jedním portem (Pterodactyl).
 */
export function isMicSameOrigin(): boolean {
  return process.env.RADIO_MIC_PROXY === "1" && !process.env.RADIO_MIC_WS_URL?.trim();
}

export function getMicWsUrl(requestHost?: string | null): string {
  const explicit = process.env.RADIO_MIC_WS_URL?.trim();
  if (explicit) return explicit;
  if (isMicSameOrigin() && requestHost) return `ws://${requestHost}/mic`;
  const raw = (requestHost ?? "127.0.0.1").replace(/:\d+$/, "");
  // Broadcaster poslouchá na 127.0.0.1 — "localhost" by mohl vést na ::1.
  const hostname = raw === "localhost" ? "127.0.0.1" : raw;
  return `ws://${hostname}:${getMicPort()}/mic`;
}
