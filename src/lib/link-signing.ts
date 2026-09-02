import { createHmac, timingSafeEqual } from "node:crypto";

const STREAM_TTL_SEC = 60 * 60;

export function getLinkSigningSecret(): string | undefined {
  return (
    process.env.LINK_SIGNING_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    undefined
  );
}

/** Podpis streamu — defaultně vypnuto (i když existuje secret). Zapni: RADIO_STREAM_SIGNING=1 */
export function isLinkSigningEnabled(): boolean {
  const flag = process.env.RADIO_STREAM_SIGNING?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") {
    return Boolean(getLinkSigningSecret());
  }
  return false;
}

function signPayload(path: string, exp: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${path}:${exp}`)
    .digest("base64url");
}

export function signPath(
  path: string,
  ttlSec = STREAM_TTL_SEC,
): { exp: number; sig: string; url: string } {
  const secret = getLinkSigningSecret();
  if (!secret) {
    return { exp: 0, sig: "", url: path };
  }

  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = signPayload(path, exp, secret);
  const qs = new URLSearchParams({ exp: String(exp), sig });
  return { exp, sig, url: `${path}?${qs.toString()}` };
}

export function verifySignedPath(
  path: string,
  expRaw: string | null,
  sigRaw: string | null,
): boolean {
  if (!isLinkSigningEnabled()) return true;
  const secret = getLinkSigningSecret();
  if (!secret) return true;
  if (!expRaw || !sigRaw) return false;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = signPayload(path, exp, secret);
  try {
    const a = Buffer.from(sigRaw);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
