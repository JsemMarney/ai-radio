import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  STUDIO_COOKIE,
  getStudioPassword,
  verifySession,
} from "@/lib/studio-auth";

const PROTECTED_PREFIXES = [
  "/studio",
  "/api/import",
  "/api/library",
  "/api/jobs",
  "/api/audio",
  "/api/studio/health",
  "/api/radio/skip",
  "/api/radio/play",
  "/api/radio/queue/remove",
  "/api/radio/test-transition",
  "/api/radio/test-midsong",
  "/api/radio/transition-preview",
];

function isProtected(pathname: string): boolean {
  if (pathname === "/studio/login") return false;
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isProtected(pathname)) return NextResponse.next();

  const password = getStudioPassword();
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Studio není zabezpečeno — nastav STUDIO_PASSWORD." },
          { status: 503 },
        );
      }
      const loginUrl = new URL("/studio/login", request.url);
      loginUrl.searchParams.set("error", "config");
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(STUDIO_COOKIE)?.value;
  if (await verifySession(token, password)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Neautorizováno." }, { status: 401 });
  }

  const loginUrl = new URL("/studio/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/studio/:path*",
    "/api/import",
    "/api/library/:path*",
    "/api/jobs/:path*",
    "/api/audio/:path*",
    "/api/studio/health",
    "/api/radio/skip",
    "/api/radio/play",
    "/api/radio/queue/remove",
    "/api/radio/test-transition",
    "/api/radio/test-midsong",
    "/api/radio/transition-preview",
  ],
};
