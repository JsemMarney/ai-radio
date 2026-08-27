import { getRadioStation } from "@/lib/radio";
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

  getRadioStation().playNow(uuid);
  return Response.json({ ok: true });
}
