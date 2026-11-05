import { findDuplicateTrack } from "@/lib/library";
import { getBestEffortIp, hitSearchLimit } from "@/lib/login-rate-limit";
import { searchSpotifyTracks } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Posluchač hledá písničku, která v rádiu chybí (Spotify). */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ tracks: [] });
  if (!hitSearchLimit(getBestEffortIp(request))) {
    return Response.json({ error: "Moc hledání najednou, chvilku počkej." }, { status: 429 });
  }
  try {
    const found = await searchSpotifyTracks(q, 8);
    const tracks = await Promise.all(
      found.map(async (t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        year: t.year,
        thumbnail: t.thumbnail,
        inLibrary: Boolean(await findDuplicateTrack(t)),
      })),
    );
    return Response.json({ tracks });
  } catch {
    return Response.json({ error: "Hledání teď nejde, zkus to později." }, { status: 502 });
  }
}
