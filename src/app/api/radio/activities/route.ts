import { brokerFetch } from "@/lib/radio-broker";
import { createLimiter, listenerKeys } from "@/lib/listener-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limited = createLimiter(6);

/** Týdenní žebříček kvízu + otázka dne (když dnes zazněla). */
export async function GET() {
  const res = await brokerFetch("/activities");
  if (!res.ok) return Response.json({ board: { week: "", top: [] }, question: null });
  return Response.json(await res.json(), { headers: { "Cache-Control": "no-store" } });
}

/** Odpověď na otázku dne — jedna na posluchače. */
export async function POST(request: Request) {
  let body: { name?: unknown; text?: unknown; client?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Neplatný JSON." }, { status: 400 });
  }
  const { net, voter } = listenerKeys(request, body.client);
  if (limited(net)) {
    return Response.json({ ok: false, error: "Moc pokusů, zkus to za chvíli." }, { status: 429 });
  }
  const res = await brokerFetch("/activities/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: body.name, text: body.text, voter, net }),
  });
  const data = (await res.json().catch(() => ({ ok: false, error: "Rádio je offline." }))) as {
    ok?: boolean;
    error?: string;
  };
  return Response.json(data, { status: res.ok ? 200 : res.status });
}
