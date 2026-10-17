import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const STUDIO_COOKIE = "studio_session";
const SESSION_VERSION = "v3";
/** Jak dlouho platí přihlášení. */
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

const WEAK_PASSWORDS = new Set([
  "change-me",
  "changeme",
  "password",
  "heslo",
  "admin",
  "studio",
  "radio",
  "123456",
  "12345678",
]);

export function getStudioPassword(): string | undefined {
  return process.env.STUDIO_PASSWORD?.trim() || undefined;
}

/** Popis problému s heslem do studia, nebo null když je v pořádku. */
export function getStudioPasswordProblem(): string | null {
  const password = getStudioPassword();
  if (!password) return "STUDIO_PASSWORD není nastavené.";
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return "STUDIO_PASSWORD je výchozí / běžné heslo.";
  }
  if (password.length < 12) return "STUDIO_PASSWORD má méně než 12 znaků.";
  return null;
}

function getSessionSecret(): string | undefined {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.STUDIO_PASSWORD?.trim() ||
    undefined
  );
}

/** Změna hesla zneplatní všechna přihlášení (otisk hesla je součástí podpisu). */
function passwordFingerprint(password: string): string {
  return createHash("sha256").update(`studio:${password}`).digest("hex").slice(0, 16);
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Porovnat aspoň se sebou, ať délka neprozradí víc než nutno.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

// ───────── odvolané session (odhlášení) ─────────

function revokedPath(): string {
  return path.join(process.cwd(), "downloads", ".revoked-sessions.json");
}

let revokedCache: { mtimeMs: number; ids: Record<string, number> } | null = null;

function readRevoked(): Record<string, number> {
  const file = revokedPath();
  if (!existsSync(file)) return {};
  try {
    const mtimeMs = statSync(file).mtimeMs;
    if (revokedCache && revokedCache.mtimeMs === mtimeMs) return revokedCache.ids;
    const ids = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
    revokedCache = { mtimeMs, ids };
    return ids;
  } catch {
    return {};
  }
}

function revokeSessionId(id: string, exp: number): void {
  const now = Math.floor(Date.now() / 1000);
  const ids = { ...readRevoked(), [id]: exp };
  for (const [k, e] of Object.entries(ids)) if (e < now) delete ids[k];
  mkdirSync(path.dirname(revokedPath()), { recursive: true });
  writeFileSync(revokedPath(), JSON.stringify(ids), "utf8");
  revokedCache = null;
}

// ───────── tokeny ─────────

type ParsedToken = { exp: number; id: string; mac: string };

function parseToken(token: string): ParsedToken | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== SESSION_VERSION) return null;
  const exp = Number(parts[1]);
  if (!Number.isInteger(exp) || !parts[2] || !parts[3]) return null;
  return { exp, id: parts[2], mac: parts[3] };
}

export function makeSessionToken(password: string): string {
  const secret = getSessionSecret();
  if (!secret) throw new Error("Chybí SESSION_SECRET / STUDIO_PASSWORD.");
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const id = randomBytes(16).toString("base64url");
  const mac = sign(secret, `${SESSION_VERSION}:${exp}:${id}:${passwordFingerprint(password)}`);
  return `${SESSION_VERSION}.${exp}.${id}.${mac}`;
}

export async function verifySession(
  token: string | undefined,
  password: string | undefined,
): Promise<boolean> {
  if (!password) return true;
  if (!token) return false;
  const secret = getSessionSecret();
  if (!secret) return false;

  const parsed = parseToken(token);
  if (!parsed) return false;
  if (parsed.exp <= Math.floor(Date.now() / 1000)) return false;

  const expected = sign(
    secret,
    `${SESSION_VERSION}:${parsed.exp}:${parsed.id}:${passwordFingerprint(password)}`,
  );
  if (!safeEqual(parsed.mac, expected)) return false;
  return !(parsed.id in readRevoked());
}

/** Odhlášení — token přestane platit i kdyby ho někdo zkopíroval. */
export function revokeSession(token: string | undefined): void {
  if (!token) return;
  const parsed = parseToken(token);
  if (parsed) revokeSessionId(parsed.id, parsed.exp);
}

export function isStudioAuthEnabled(): boolean {
  return Boolean(getStudioPassword());
}
