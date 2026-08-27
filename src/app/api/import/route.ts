import { NextResponse } from "next/server";
import { ensureDownloadsDir } from "@/lib/library";
import { createPlaylistJob, startPlaylistJob } from "@/lib/jobs";
import {
  fetchSpotifyPlaylist,
  fetchSpotifyTrackMeta,
  parseSpotifyUrl,
  PLAYLIST_IMPORT_LIMIT,
} from "@/lib/spotify";
import { importSpotifyTrack, publicTrackPayload } from "@/lib/ytdlp";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "Chybí Spotify odkaz." }, { status: 400 });
  }

  const parsed = parseSpotifyUrl(url);
  if (parsed.kind === "unknown") {
    return NextResponse.json(
      {
        error:
          "Vlož Spotify odkaz na track nebo playlist (open.spotify.com/track|playlist/...).",
      },
      { status: 400 },
    );
  }

  await ensureDownloadsDir();

  try {
    if (parsed.kind === "track") {
      const meta = await fetchSpotifyTrackMeta(url);
      const track = await importSpotifyTrack(meta);
      return NextResponse.json({
        type: "track",
        track: publicTrackPayload(track),
      });
    }

    const playlist = await fetchSpotifyPlaylist(url, PLAYLIST_IMPORT_LIMIT);
    if (!playlist.tracks.length) {
      return NextResponse.json(
        { error: "Playlist neobsahuje žádné skladby." },
        { status: 400 },
      );
    }

    const job = await createPlaylistJob({
      title: playlist.name,
      tracks: playlist.tracks,
    });
    startPlaylistJob(job.id, playlist.tracks);

    return NextResponse.json({
      type: "playlist",
      jobId: job.id,
      playlist: {
        id: playlist.id,
        name: playlist.name,
        truncated: playlist.truncated,
        limit: PLAYLIST_IMPORT_LIMIT,
        total: playlist.tracks.length,
      },
      job,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Import selhal.";
    console.error("[import]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
