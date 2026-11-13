import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Vygenerovat AI vstup a pustit ho hned. */
export async function POST(request: Request) {
  // Volitelně {"quiz":"year"|"artist"} — kvíz ze studia.
  const body = await request.text().catch(() => "");
  const res = await brokerFetch("/ai-dj/now", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body || "{}",
    timeoutMs: 110_000,
  });
  const data = await res.json().catch(() => ({ error: "Broker nevrátil odpověď." }));
  return Response.json(data, { status: res.status });
}
