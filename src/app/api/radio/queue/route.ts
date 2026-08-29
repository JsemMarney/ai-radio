import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") ?? "5";
  const res = await brokerFetch(`/queue?limit=${limit}`);
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
