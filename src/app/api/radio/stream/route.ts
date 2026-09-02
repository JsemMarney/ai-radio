import { brokerStream } from "@/lib/radio-broker";
import { verifySignedPath } from "@/lib/link-signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STREAM_PATH = "/api/radio/stream";

const ICY_HEADERS = [
  "icy-metaint",
  "icy-name",
  "icy-genre",
  "icy-br",
  "icy-url",
  "icy-pub",
] as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (
    !verifySignedPath(
      STREAM_PATH,
      url.searchParams.get("exp"),
      url.searchParams.get("sig"),
    )
  ) {
    return new Response("Neplatný nebo expirovaný stream odkaz.", {
      status: 403,
    });
  }

  const res = await brokerStream("/stream");
  if (!res.ok || !res.body) {
    return new Response("Rádio stream není dostupný. Spusť broadcaster.", {
      status: 503,
    });
  }

  const headers = new Headers({
    "Content-Type": res.headers.get("content-type") ?? "audio/mpeg",
    "Cache-Control": "no-cache, no-store, must-revalidate, private",
    Pragma: "no-cache",
    "Accept-Ranges": "none",
    Connection: "keep-alive",
  });

  for (const key of ICY_HEADERS) {
    const value = res.headers.get(key);
    if (value) headers.set(key, value);
  }

  return new Response(res.body, { headers });
}
