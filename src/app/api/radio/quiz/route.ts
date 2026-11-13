import { brokerFetch } from "@/lib/radio-broker";
import { createLimiter, listenerKeys } from "@/lib/listener-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hrubá brzda proti zahlcení — jeden tip na posluchače hlídá vysílač. */
const limited = createLimiter(8);

export async function POST(request: Request) {
  let body: { id?: unknown; name?: unknown; year?: unknown; answer?: unknown; client?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Neplatný JSON." }, { status: 400 });
  }
  const { net, voter } = listenerKeys(request, body.client);
  if (limited(net)) {
    return Response.json({ ok: false, error: "Moc pokusů, zkus to za chvíli." }, { status: 429 });
  }

  const res = await brokerFetch("/quiz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: body.id, name: body.name, year: body.year, answer: body.answer, voter, net }),
  });
  const data = (await res.json().catch(() => ({ ok: false, error: "Rádio je offline." }))) as {
    ok?: boolean;
    error?: string;
  };
  return Response.json(data, { status: res.ok ? 200 : res.status });
}
