import { areSongRequestsEnabled } from "@/lib/song-requests";
import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!areSongRequestsEnabled()) {
    return Response.json({ enabled: false, tracks: [], pending: 0 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? "";
  const limit = url.searchParams.get("limit") ?? "40";
  const res = await brokerFetch(
    `/requests?search=${encodeURIComponent(search)}&limit=${limit}`,
  );

  if (!res.ok) {
    return Response.json({ enabled: true, tracks: [], pending: 0, offline: true });
  }

  return Response.json(await res.json());
}
