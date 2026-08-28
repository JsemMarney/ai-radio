import { cookies } from "next/headers";
import {
  STUDIO_COOKIE,
  getStudioPassword,
  makeSessionToken,
  verifySession,
} from "@/lib/studio-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const password = getStudioPassword();
  if (!password) {
    return Response.json({ ok: true });
  }

  const body = (await request.json()) as { password?: string };
  if (body.password !== password) {
    return Response.json({ error: "Špatné heslo." }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(STUDIO_COOKIE, makeSessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return Response.json({ ok: true });
}

export async function GET() {
  const password = getStudioPassword();
  const jar = await cookies();
  const token = jar.get(STUDIO_COOKIE)?.value;
  return Response.json({
    authenticated: verifySession(token, password),
    authRequired: Boolean(password),
  });
}
