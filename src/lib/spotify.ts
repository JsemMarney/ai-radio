export type SpotifyTrackMeta = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  duration: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  releaseDate: string | null;
};

export type SpotifyPlaylistMeta = {
  id: string;
  name: string;
  description: string | null;
  webpageUrl: string;
  tracks: SpotifyTrackMeta[];
  truncated: boolean;
};

export const PLAYLIST_IMPORT_LIMIT = 50;

function isSpotifyHost(hostname: string): boolean {
  return (
    hostname === "open.spotify.com" ||
    hostname === "spotify.com" ||
    hostname.endsWith(".spotify.com")
  );
}

export function extractSpotifyTrackId(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (!isSpotifyHost(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/track\/([a-zA-Z0-9]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function extractSpotifyPlaylistId(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (!isSpotifyHost(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/playlist\/([a-zA-Z0-9]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export type SpotifyUrlKind =
  | { kind: "track"; id: string }
  | { kind: "playlist"; id: string }
  | { kind: "unknown" };

export function parseSpotifyUrl(url: string): SpotifyUrlKind {
  const trackId = extractSpotifyTrackId(url);
  if (trackId) return { kind: "track", id: trackId };
  const playlistId = extractSpotifyPlaylistId(url);
  if (playlistId) return { kind: "playlist", id: playlistId };
  return { kind: "unknown" };
}

async function getClientCredentialsToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify auth selhala (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function getAnonymousToken(): Promise<string | null> {
  try {
    const res = await fetch(
      "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
      {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: string };
    return data.accessToken ?? null;
  } catch {
    return null;
  }
}

async function getSpotifyToken(): Promise<string> {
  const token =
    (await getClientCredentialsToken()) ?? (await getAnonymousToken());
  if (!token) {
    throw new Error(
      "Nepodařilo se získat Spotify token. Nastav SPOTIFY_CLIENT_ID a SPOTIFY_CLIENT_SECRET v .env.local (developer.spotify.com).",
    );
  }
  return token;
}

type SpotifyApiTrack = {
  id: string;
  name: string;
  duration_ms: number;
  external_urls?: { spotify?: string };
  album?: {
    name?: string;
    release_date?: string;
    images?: { url: string }[];
  };
  artists?: { name: string }[];
};

function mapTrack(track: SpotifyApiTrack): SpotifyTrackMeta {
  const releaseDate = track.album?.release_date ?? null;
  return {
    id: track.id,
    title: track.name,
    artist: (track.artists ?? []).map((a) => a.name).join(", ") || "Unknown",
    album: track.album?.name ?? null,
    year: releaseDate ? releaseDate.slice(0, 4) : null,
    duration: track.duration_ms ? track.duration_ms / 1000 : null,
    thumbnail: track.album?.images?.[0]?.url ?? null,
    webpageUrl:
      track.external_urls?.spotify ??
      `https://open.spotify.com/track/${track.id}`,
    releaseDate,
  };
}

export async function fetchSpotifyTrackMeta(
  urlOrId: string,
): Promise<SpotifyTrackMeta> {
  const trackId = extractSpotifyTrackId(urlOrId) ?? (/^[a-zA-Z0-9]+$/.test(urlOrId) ? urlOrId : null);
  if (!trackId) {
    throw new Error(
      "Vlož platný odkaz na Spotify track (open.spotify.com/track/...).",
    );
  }

  const token = await getSpotifyToken();
  const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API chyba (${res.status}): ${text}`);
  }

  const track = (await res.json()) as SpotifyApiTrack;
  return mapTrack(track);
}

export async function fetchSpotifyPlaylist(
  url: string,
  limit = PLAYLIST_IMPORT_LIMIT,
): Promise<SpotifyPlaylistMeta> {
  const playlistId = extractSpotifyPlaylistId(url);
  if (!playlistId) {
    throw new Error(
      "Vlož platný odkaz na Spotify playlist (open.spotify.com/playlist/...).",
    );
  }

  const token = await getSpotifyToken();

  const playlistRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,description,external_urls`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  if (!playlistRes.ok) {
    const text = await playlistRes.text();
    throw new Error(`Spotify playlist API chyba (${playlistRes.status}): ${text}`);
  }

  const playlist = (await playlistRes.json()) as {
    id: string;
    name: string;
    description: string | null;
    external_urls?: { spotify?: string };
  };

  const tracks: SpotifyTrackMeta[] = [];
  let nextUrl: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=next,items(track(id,name,duration_ms,external_urls,album(name,release_date,images),artists(name)))`;

  while (nextUrl && tracks.length < limit) {
    const pageRes: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!pageRes.ok) {
      const text = await pageRes.text();
      throw new Error(`Spotify tracks API chyba (${pageRes.status}): ${text}`);
    }

    const page = (await pageRes.json()) as {
      next: string | null;
      items: { track: SpotifyApiTrack | null }[];
    };

    for (const item of page.items) {
      if (!item.track?.id) continue;
      tracks.push(mapTrack(item.track));
      if (tracks.length >= limit) break;
    }

    nextUrl = page.next;
  }

  const truncated = Boolean(nextUrl) || tracks.length >= limit;

  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    webpageUrl:
      playlist.external_urls?.spotify ??
      `https://open.spotify.com/playlist/${playlist.id}`,
    tracks: tracks.slice(0, limit),
    truncated: truncated && tracks.length >= limit,
  };
}

export function searchQueryForTrack(meta: SpotifyTrackMeta): string {
  return `${meta.artist} - ${meta.title}`.trim();
}
