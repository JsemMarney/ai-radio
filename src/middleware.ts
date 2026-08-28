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
  "/api/radio/skip",
  "/api/radio/play",
];

function isProtected(pathname: string): boolean {
  if (pathname === "/studio/login") return false;
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isProtected(pathname)) return NextResponse.next();

  const password = getStudioPassword();
  if (!password) return NextResponse.next();

  const token = request.cookies.get(STUDIO_COOKIE)?.value;
  if (verifySession(token, password)) return NextResponse.next();

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
    "/api/radio/skip",
    "/api/radio/play",
  ],
};
