import { rm } from "node:fs/promises";
import { getTrack, getTrackDir } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await context.params;
  const track = await getTrack(uuid);
  if (!track) {
    return Response.json({ error: "Skladba nenalezena." }, { status: 404 });
  }

  await rm(getTrackDir(uuid), { recursive: true, force: true });
  return Response.json({ ok: true });
}
