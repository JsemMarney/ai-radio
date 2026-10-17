import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await brokerFetch("/break/beds");
  const data = await res.json().catch(() => ({ beds: [] }));
  return Response.json(data, { status: res.status });
}
