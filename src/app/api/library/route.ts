import { NextResponse } from "next/server";
import { listTracks, toPublicTrack } from "@/lib/library";

export const runtime = "nodejs";

export async function GET() {
  try {
    const tracks = await listTracks();
    return NextResponse.json({
      tracks: tracks.map(toPublicTrack),
      count: tracks.length,
      ready: tracks.filter((t) => t.status === "ready").length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nelze načíst knihovnu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
