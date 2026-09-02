import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_QUEUE = {
  upcoming: [],
  schedule: [],
  nextUp: null,
  reserved: null,
  queueRemaining: 0,
  offline: true,
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") ?? "5";
  const res = await brokerFetch(`/queue?limit=${limit}`);

  if (!res.ok) {
    return Response.json(EMPTY_QUEUE);
  }

  try {
    const data = await res.json();
    return Response.json(data);
  } catch {
    return Response.json(EMPTY_QUEUE);
  }
}
