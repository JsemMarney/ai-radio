import { NextResponse } from "next/server";
import { listTracks, toPublicTrack } from "@/lib/library";

export const runtime = "nodejs";

export async function GET() {
  try {
    const tracks = await listTracks({ readyOnly: true });
    return NextResponse.json({
      tracks: tracks.map(toPublicTrack),
      count: tracks.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nelze načíst knihovnu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
