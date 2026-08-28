import { cleanupStaleBroadcastLock, readRadioState, type RadioNowPlaying } from "@/lib/radio-state";
import { getRadioStation } from "@/lib/radio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function filterRecent(
  recent: RadioNowPlaying[],
  nowPlaying: RadioNowPlaying | null,
): RadioNowPlaying[] {
  if (!nowPlaying) return recent;
  return recent.filter((t) => t.uuid !== nowPlaying.uuid);
}

export async function GET() {
  await cleanupStaleBroadcastLock();
  const station = getRadioStation();
  await station.start();
  const state = await readRadioState();

  const nowPlaying = state.nowPlaying ?? station.nowPlaying;
  const trackStartedAt = state.trackStartedAt ?? station.trackStartedAt;
  const broadcasting = state.broadcasting || station.broadcasting;

  return Response.json({
    nowPlaying,
    trackStartedAt,
    recentlyPlayed: filterRecent(state.recentlyPlayed ?? [], nowPlaying),
    listeners: Math.max(state.listenerCount ?? 0, station.listenerCount),
    broadcasting,
    queueRemaining: station.queueRemaining,
    streamUrl: "/api/radio/stream",
  });
}
