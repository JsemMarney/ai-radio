import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIcecastListenUrl, isIcecastEnabled } from "@/lib/icecast-config";
import { getMicWsUrl, isMicSameOrigin } from "@/lib/mic-input";
import {
  STUDIO_COOKIE,
  getStudioPassword,
  getStudioPasswordProblem,
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
  "/api/radio/queue/next",
  "/api/radio/queue/move",
  "/api/radio/queue/full",
  "/api/radio/stats",
  "/api/radio/mic-ticket",
  "/api/radio/requests/moderation",
  "/api/radio/requests/decide",
  "/api/radio/break",
  "/api/radio/requests/voice",
  "/api/radio/requests/play-voice",
  "/api/radio/moderator",
  "/api/radio/test-transition",
  "/api/radio/test-midsong",
  "/api/radio/transition-preview",
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isProtected(pathname: string): boolean {
  if (pathname === "/studio/login") return false;
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * CSRF: měnící požadavek musí přijít z naší stránky. Prohlížeč posílá
 * `Origin` (a `Sec-Fetch-Site`) u každého cross-site POST — ty odmítneme.
 */
function isCrossSite(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host !== request.headers.get("host");
    } catch {
      return true;
    }
  }
  return request.headers.get("sec-fetch-site") === "cross-site";
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function buildCsp(nonce: string, host: string | null): string {
  const dev = process.env.NODE_ENV !== "production";
  const media = ["'self'", "blob:"];
  if (isIcecastEnabled()) {
    const icecast = originOf(getIcecastListenUrl());
    if (icecast) media.push(icecast);
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Styly nejsou spustitelný kód; Next/React je vkládá i inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `media-src ${media.join(" ")}`,
    // WebSocket mikrofonu ve studiu míří na port broadcasteru.
    `connect-src 'self' ${
      isMicSameOrigin() && host
        ? `ws://${host} wss://${host}`
        : (originOf(getMicWsUrl(host).replace(/^ws/, "http"))?.replace(/^http/, "ws") ?? "")
    }${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

async function authorize(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  if (!isProtected(pathname)) return null;

  const isApi = pathname.startsWith("/api/");
  const password = getStudioPassword();
  const problem = getStudioPasswordProblem();

  if (process.env.NODE_ENV === "production" && problem) {
    if (isApi) {
      return NextResponse.json(
        { error: `Studio je zamčené: ${problem}` },
        { status: 503 },
      );
    }
    const loginUrl = new URL("/studio/login", request.url);
    loginUrl.searchParams.set("error", "config");
    return NextResponse.redirect(loginUrl);
  }
  if (!password) return null; // vývoj bez hesla

  const token = request.cookies.get(STUDIO_COOKIE)?.value;
  if (await verifySession(token, password)) return null;

  if (isApi) {
    return NextResponse.json({ error: "Neautorizováno." }, { status: 401 });
  }
  const loginUrl = new URL("/studio/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi && isCrossSite(request)) {
    return NextResponse.json(
      { error: "Požadavek z cizí stránky byl zablokován." },
      { status: 403 },
    );
  }

  const denied = await authorize(request);
  if (denied) return denied;

  if (isApi) return NextResponse.next();

  // Stránky: CSP s nonce — Next ho sám doplní ke svým skriptům.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, request.headers.get("host"));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|mp3|wav)$).*)",
  ],
};
