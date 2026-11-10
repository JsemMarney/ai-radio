import { brokerStream } from "@/lib/radio-broker";
import { verifySignedPath } from "@/lib/link-signing";
import { acquireStreamSlot, clientIp } from "@/lib/stream-guard";

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

  const slot = acquireStreamSlot(clientIp(request));
  if (!slot.ok) {
    return new Response(slot.reason, {
      status: 429,
      headers: { "Retry-After": "30", "Cache-Control": "no-store" },
    });
  }

  const format = url.searchParams.get("format") === "aac" ? "aac" : "mp3";
  const res = await brokerStream(format === "aac" ? "/stream.aac" : "/stream").catch(
    () => null,
  );
  if (!res || !res.ok || !res.body) {
    slot.release();
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

  // Když broadcaster spojení ukončí (restart, vypnutí), nenechat chybu propadnout
  // jako unhandledRejection — posluchač se prostě znovu připojí.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  // Místo se uvolní, až posluchač odejde (pipe skončí nebo se zruší).
  res.body
    .pipeTo(writable)
    .catch(() => {})
    .finally(slot.release);
  request.signal?.addEventListener("abort", slot.release, { once: true });

  return new Response(readable, { headers });
}
