import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";

/** Pauza na mluvené slovo (arm / now / cancel / resume / settings). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await brokerFetch("/break", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "Broker nevrátil odpověď." }));
  return Response.json(data, { status: res.status });
}
