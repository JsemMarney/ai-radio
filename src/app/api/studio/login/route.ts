import { cookies } from "next/headers";
import {
  STUDIO_COOKIE,
  getStudioPassword,
  makeSessionToken,
  verifySession,
} from "@/lib/studio-auth";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  getClientIp,
  recordLoginFailure,
} from "@/lib/login-rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const password = getStudioPassword();
  if (!password) {
    return Response.json({ ok: true });
  }

  const ip = getClientIp(request);
  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    return Response.json(
      {
        error: `Příliš mnoho pokusů. Zkus znovu za ${limit.retryAfterSec} s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  const body = (await request.json()) as { password?: string };
  if (body.password !== password) {
    recordLoginFailure(ip);
    return Response.json({ error: "Špatné heslo." }, { status: 401 });
  }

  clearLoginAttempts(ip);
  const jar = await cookies();
  jar.set(STUDIO_COOKIE, await makeSessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return Response.json({ ok: true });
}

export async function GET() {
  const password = getStudioPassword();
  const jar = await cookies();
  const token = jar.get(STUDIO_COOKIE)?.value;
  return Response.json({
    authenticated: await verifySession(token, password),
    authRequired: Boolean(password),
  });
}
