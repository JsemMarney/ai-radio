import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = await brokerFetch("/skip", { method: "POST" });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
