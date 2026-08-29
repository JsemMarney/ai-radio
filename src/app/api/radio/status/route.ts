import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await brokerFetch("/status");
  if (!res.ok) {
    return Response.json({
      broadcasting: false,
      offline: true,
      nowPlaying: null,
      trackStartedAt: null,
      recentlyPlayed: [],
      listeners: 0,
      queueRemaining: 0,
      streamUrl: "/api/radio/stream",
    });
  }

  const data = await res.json();
  return Response.json({
    ...data,
    streamUrl: "/api/radio/stream",
  });
}
