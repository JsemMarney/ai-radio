import { buildNowPlayingResponse } from "@/lib/nowplaying-api";
import { getPublicStreamUrl } from "@/lib/icecast-config";
import { areSongRequestsEnabled } from "@/lib/song-requests";
import { brokerFetch } from "@/lib/radio-broker";
import { getStreamBitrate } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const res = await brokerFetch("/status");
  const bitrateKbps = Math.floor(getStreamBitrate() / 1000);

  if (!res.ok) {
    const offline = buildNowPlayingResponse(
      {
        nowPlaying: null,
        trackStartedAt: null,
        recentlyPlayed: [],
        listeners: 0,
        broadcasting: false,
        queueRemaining: 0,
        sessionId: null,
        upcoming: [],
        schedule: [],
        nextUp: null,
        segment: "song",
        crossfadeSec: 6,
        streamEpoch: 0,
        songsUntilMidsong: 0,
        midsongDurationSec: 0,
        midsongConfigured: false,
        midsongMinTracks: 3,
        midsongMaxTracks: 6,
        requestsEnabled: areSongRequestsEnabled(),
        requestsPending: 0,
        streamUrl: getPublicStreamUrl(origin),
      },
      origin,
      bitrateKbps,
    );
    return Response.json(offline, {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const data = (await res.json()) as Record<string, unknown>;
  const payload = buildNowPlayingResponse(
    {
      ...(data as Parameters<typeof buildNowPlayingResponse>[0]),
      requestsEnabled: areSongRequestsEnabled(),
      streamUrl:
        typeof data.streamUrl === "string"
          ? data.streamUrl
          : getPublicStreamUrl(origin),
    },
    origin,
    bitrateKbps,
  );

  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
