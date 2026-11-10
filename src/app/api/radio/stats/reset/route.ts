import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Studio: vynulovat statistiky přehrání (chráněno heslem studia v proxy). */
export async function POST() {
  const res = await brokerFetch("/stats/reset", { method: "POST" });
  const data = await res.json().catch(() => ({ error: "Broker nevrátil odpověď." }));
  return Response.json(data, { status: res.status });
}
