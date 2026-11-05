import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Posluchači podle hodiny dne (pro studio). */
export async function GET() {
  const res = await brokerFetch("/listener-stats");
  const data = await res.json().catch(() => ({ error: "Broker nevrátil odpověď." }));
  return Response.json(data, { status: res.status });
}
