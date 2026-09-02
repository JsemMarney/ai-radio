import { areSongRequestsEnabled } from "@/lib/song-requests";
import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!areSongRequestsEnabled()) {
    return Response.json(
      { ok: false, error: "Song requesty jsou vypnuté." },
      { status: 403 },
    );
  }

  let body: { uuid?: string };
  try {
    body = (await request.json()) as { uuid?: string };
  } catch {
    return Response.json({ ok: false, error: "Neplatný JSON." }, { status: 400 });
  }

  const res = await brokerFetch("/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uuid: body.uuid }),
  });

  const data = await res.json().catch(() => ({ ok: false, error: "Broker offline." }));
  return Response.json(data, { status: res.ok ? 200 : res.status });
}
