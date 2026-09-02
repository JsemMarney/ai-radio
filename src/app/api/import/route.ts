import { NextResponse } from "next/server";
import { ensureDownloadsDir } from "@/lib/library";
import { createPlaylistJob, startPlaylistJob } from "@/lib/jobs";
import {
  fetchSpotifyAlbum,
  fetchSpotifyPlaylist,
  fetchSpotifyTrackMeta,
  parseSpotifyUrl,
  PLAYLIST_IMPORT_LIMIT,
} from "@/lib/spotify";

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
          "Vlož Spotify odkaz na track, album nebo playlist (open.spotify.com/track|album|playlist/...).",
      },
      { status: 400 },
    );
  }

  await ensureDownloadsDir();

  try {
    if (parsed.kind === "track") {
      const meta = await fetchSpotifyTrackMeta(url);
      const job = await createPlaylistJob({
        title: `${meta.artist} — ${meta.title}`,
        tracks: [meta],
        source: "track",
      });
      startPlaylistJob(job.id, [meta]);

      return NextResponse.json({
        type: "track",
        jobId: job.id,
        job,
      });
    }

    const collection =
      parsed.kind === "album"
        ? await fetchSpotifyAlbum(url, PLAYLIST_IMPORT_LIMIT)
        : await fetchSpotifyPlaylist(url, PLAYLIST_IMPORT_LIMIT);

    if (!collection.tracks.length) {
      return NextResponse.json(
        {
          error:
            parsed.kind === "album"
              ? "Album neobsahuje žádné skladby."
              : "Playlist neobsahuje žádné skladby.",
        },
        { status: 400 },
      );
    }

    const job = await createPlaylistJob({
      title: collection.name,
      tracks: collection.tracks,
      source: parsed.kind === "album" ? "album" : "playlist",
    });
    startPlaylistJob(job.id, collection.tracks);

    return NextResponse.json({
      type: parsed.kind === "album" ? "album" : "playlist",
      jobId: job.id,
      playlist: {
        id: collection.id,
        name: collection.name,
        truncated: collection.truncated,
        limit: PLAYLIST_IMPORT_LIMIT,
        total: collection.tracks.length,
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
