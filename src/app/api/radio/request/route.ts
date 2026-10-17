import { areSongRequestsEnabled } from "@/lib/song-requests";
import { brokerFetch } from "@/lib/radio-broker";
import {
  checkSongRequestLimit,
  getBestEffortIp,
  recordSongRequest,
} from "@/lib/login-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!areSongRequestsEnabled()) {
    return Response.json(
      { ok: false, error: "Song requesty jsou vypnuté." },
      { status: 403 },
    );
  }

  const ip = getBestEffortIp(request);
  const limit = checkSongRequestLimit(ip);
  if (!limit.allowed) {
    const min = Math.max(1, Math.ceil(limit.retryAfterSec / 60));
    return Response.json(
      { ok: false, error: `Díky za přání! Další můžeš poslat za ${min} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let body: { uuid?: string; from?: unknown; message?: unknown; voice?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Neplatný JSON." }, { status: 400 });
  }

  const res = await brokerFetch("/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uuid: body.uuid, from: body.from, message: body.message, voice: body.voice }),
  });

  const data = (await res.json().catch(() => ({ ok: false, error: "Broker offline." }))) as {
    ok?: boolean;
  };
  if (res.ok && data.ok) recordSongRequest(ip);
  return Response.json(data, { status: res.ok ? 200 : res.status });
}
