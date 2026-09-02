import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";

export function getBrokerSecret(): string | undefined {
  return (
    process.env.BROKER_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    undefined
  );
}

export function isBrokerAuthEnabled(): boolean {
  return Boolean(getBrokerSecret());
}

export function brokerAuthHeaders(): Record<string, string> {
  const secret = getBrokerSecret();
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}

export function verifyBrokerRequest(req: IncomingMessage): boolean {
  const secret = getBrokerSecret();
  if (!secret) return true;

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return false;

  const token = auth.slice(7);
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
