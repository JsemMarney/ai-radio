import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await brokerFetch("/requests/moderation");
  const data = await res.json().catch(() => ({ pending: [], recent: [] }));
  return Response.json(data, { status: res.status });
}
