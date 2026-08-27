import { readRadioState } from "@/lib/radio-state";
import { getRadioStation } from "@/lib/radio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const station = getRadioStation();
  await station.start();
  const persisted = await readRadioState();

  return Response.json({
    nowPlaying: persisted?.nowPlaying ?? station.nowPlaying,
    trackStartedAt: persisted?.trackStartedAt ?? null,
    listeners: station.listenerCount,
    broadcasting: station.broadcasting,
    queueRemaining: station.queueRemaining,
    streamUrl: "/api/radio/stream",
  });
}
