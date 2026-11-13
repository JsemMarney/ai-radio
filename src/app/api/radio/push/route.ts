import { brokerFetch } from "@/lib/radio-broker";
import { createLimiter, listenerKeys } from "@/lib/listener-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limited = createLimiter(10);

function siteOrigin(request: Request): string | undefined {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
    .split(",")[0]!
    .trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) && !/^(localhost|127\.)/.test(host) ? `https://${host}` : undefined;
}

/** Veřejný klíč pro přihlášení k upozorněním (VAPID). */
export async function GET() {
  const res = await brokerFetch("/push");
  const data = await res.json().catch(() => ({ error: "Rádio je offline." }));
  return Response.json(data, { status: res.status });
}

/** Přihlásit / odhlásit upozornění na kvíz: {endpoint, off?}. */
export async function POST(request: Request) {
  let body: { endpoint?: unknown; off?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Neplatný JSON." }, { status: 400 });
  }
  const { net } = listenerKeys(request, "");
  if (limited(net)) {
    return Response.json({ ok: false, error: "Moc pokusů, zkus to za chvíli." }, { status: 429 });
  }
  const res = await brokerFetch("/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: body.endpoint,
      off: body.off === true,
      // Kontakt pro push služby (VAPID „sub“) — veřejná adresa webu (za nginx proxy z hlaviček).
      site: siteOrigin(request),
    }),
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Rádio je offline." }));
  return Response.json(data, { status: res.status });
}
