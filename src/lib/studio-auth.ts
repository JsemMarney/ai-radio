export const STUDIO_COOKIE = "studio_session";

export function getStudioPassword(): string | undefined {
  return process.env.STUDIO_PASSWORD?.trim() || undefined;
}

/** Edge + Node compatible session token (no node:crypto). */
export function makeSessionToken(password: string): string {
  let hash = 5381;
  const str = `studio:${password}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function verifySession(
  token: string | undefined,
  password: string | undefined,
): boolean {
  if (!password) return true;
  if (!token) return false;
  return token === makeSessionToken(password);
}

export function isStudioAuthEnabled(): boolean {
  return Boolean(getStudioPassword());
}
