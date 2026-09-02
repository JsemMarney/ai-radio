export const STUDIO_COOKIE = "studio_session";
const SESSION_VERSION = "v2";

export function getStudioPassword(): string | undefined {
  return process.env.STUDIO_PASSWORD?.trim() || undefined;
}

export function getSessionSecret(): string | undefined {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.STUDIO_PASSWORD?.trim() ||
    undefined
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/** Legacy token — zpětná kompatibilita starých cookies. */
function makeSessionTokenLegacy(password: string): string {
  let hash = 5381;
  const str = `studio:${password}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function makeSessionToken(password: string): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) return makeSessionTokenLegacy(password);

  const nonce = randomNonce();
  const mac = await hmacHex(secret, `${nonce}:studio:${password}`);
  return `${SESSION_VERSION}.${nonce}.${mac}`;
}

export async function verifySession(
  token: string | undefined,
  password: string | undefined,
): Promise<boolean> {
  if (!password) return true;
  if (!token) return false;

  if (!token.startsWith(`${SESSION_VERSION}.`)) {
    return timingSafeEqual(token, makeSessionTokenLegacy(password));
  }

  const secret = getSessionSecret();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [, nonce, mac] = parts;
  if (!nonce || !mac) return false;

  const expected = await hmacHex(secret, `${nonce}:studio:${password}`);
  return timingSafeEqual(mac, expected);
}

export function isStudioAuthEnabled(): boolean {
  return Boolean(getStudioPassword());
}
