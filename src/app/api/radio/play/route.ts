import { brokerFetch } from "@/lib/radio-broker";
import { getTrack } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { uuid?: string };
  const uuid = body.uuid?.trim();

  if (!uuid) {
    return Response.json({ error: "Chybí uuid." }, { status: 400 });
  }

  const track = await getTrack(uuid);
  if (!track || track.status !== "ready") {
    return Response.json({ error: "Skladba není připravená." }, { status: 404 });
  }

  const res = await brokerFetch("/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uuid }),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
