import { cookies } from "next/headers";
import {
  SESSION_TTL_SEC,
  STUDIO_COOKIE,
  getStudioPassword,
  getStudioPasswordProblem,
  makeSessionToken,
  safeEqual,
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
    if (process.env.NODE_ENV === "production") {
      return Response.json(
        { error: "Studio není zabezpečené — nastav STUDIO_PASSWORD." },
        { status: 503 },
      );
    }
    return Response.json({ ok: true });
  }

  const problem = getStudioPasswordProblem();
  if (problem && process.env.NODE_ENV === "production") {
    return Response.json(
      { error: `Přihlášení vypnuto: ${problem} Nastav silné heslo a restartuj.` },
      { status: 503 },
    );
  }

  const ip = getClientIp(request);
  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    return Response.json(
      { error: `Příliš mnoho pokusů. Zkus znovu za ${limit.retryAfterSec} s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  const attempt = typeof body.password === "string" ? body.password : "";
  if (!safeEqual(attempt, password)) {
    recordLoginFailure(ip);
    // Zpomalit hádání.
    await new Promise((r) => setTimeout(r, 400));
    return Response.json({ error: "Špatné heslo." }, { status: 401 });
  }

  clearLoginAttempts(ip);
  const jar = await cookies();
  jar.set(STUDIO_COOKIE, makeSessionToken(password), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });

  return Response.json({ ok: true, warning: problem });
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
