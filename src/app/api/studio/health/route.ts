import { existsSync } from "node:fs";
import { brokerFetch } from "@/lib/radio-broker";
import { getJingleConfig, getMidsongConfig } from "@/lib/audio-process";
import { listTracks, listTracksWithAudio } from "@/lib/library";
import { getToolVersions } from "@/lib/remaster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [healthRes, statusRes, tracks, playable, tools] = await Promise.all([
    brokerFetch("/health"),
    brokerFetch("/status"),
    listTracks(),
    listTracksWithAudio({ readyOnly: true }),
    getToolVersions(),
  ]);

  const health = healthRes.ok
    ? ((await healthRes.json()) as { ok?: boolean; pid?: number })
    : null;
  const status = statusRes.ok
    ? ((await statusRes.json()) as Record<string, unknown>)
    : null;

  const jingle = getJingleConfig();
  const midsong = getMidsongConfig();

  return Response.json({
    broadcaster: {
      online: healthRes.ok && health?.ok === true,
      pid: health?.pid ?? null,
      broadcasting: status?.broadcasting ?? false,
      listeners: status?.listeners ?? 0,
      sessionId: status?.sessionId ?? null,
    },
    library: {
      total: tracks.length,
      ready: playable.length,
      failed: tracks.filter((t) => t.status === "failed").length,
      processed: playable.filter((t) => t.processedAt).length,
      needsRemaster: playable.filter((t) => !t.processedAt).length,
    },
    tools,
    jingle: {
      configured: Boolean(jingle.path && existsSync(jingle.path)),
      everyNTracks: jingle.everyNTracks,
      path: jingle.path,
    },
    midsong: {
      configured: midsong.paths.length > 0,
      count: midsong.paths.length,
      everyNTracks: midsong.everyNTracks,
      chance: midsong.chance,
      fadeSec: midsong.fadeSec,
    },
  });
}
