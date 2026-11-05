import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stav a nastavení AI moderátora. */
export async function GET() {
  const res = await brokerFetch("/ai-dj");
  const data = await res.json().catch(() => ({ error: "Broker nevrátil odpověď." }));
  return Response.json(data, { status: res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await brokerFetch("/ai-dj", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "Broker nevrátil odpověď." }));
  return Response.json(data, { status: res.status });
}
