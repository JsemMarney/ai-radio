import type { RadioStatus } from "@/lib/radio-engine";
import { getStationConfig } from "@/lib/station-config";

export type NowPlayingApiResponse = {
  station: {
    name: string;
    description: string;
    listen_url: string;
    url: string;
    public_player_url: string;
    is_online: boolean;
    mounts: Array<{
      path: string;
      url: string;
      bitrate: number;
      format: string;
      listeners: { total: number; unique: number };
    }>;
  };
  listeners: { total: number; unique: number };
  live: {
    is_live: boolean;
    streamer_name: string;
    broadcast_start: string | null;
  };
  now_playing: {
    sh_id: number;
    played_at: number;
    duration: number;
    playlist: string;
    streamer: string;
    is_request: boolean;
    song: {
      id: string;
      art: string;
      text: string;
      title: string;
      artist: string;
      album: string;
      genre: string;
      isrc: string;
      lyrics: string;
    };
    elapsed: number;
    remaining: number;
  } | null;
  playing_next: {
    sh_id: number;
    played_at: number | null;
    duration: number;
    playlist: string;
    streamer: string;
    is_request: boolean;
    song: {
      id: string;
      art: string;
      text: string;
      title: string;
      artist: string;
      album: string;
      genre: string;
    };
  } | null;
  song_history: Array<{
    sh_id: number;
    played_at: number;
    duration: number;
    playlist: string;
    streamer: string;
    is_request: boolean;
    song: {
      id: string;
      art: string;
      text: string;
      title: string;
      artist: string;
      album: string;
    };
  }>;
  is_online: boolean;
  requests_enabled: boolean;
  requests_pending: number;
};

function trackToSong(
  track: {
    uuid: string;
    title: string;
    artist: string;
    album: string | null;
    thumbnail: string | null;
    durationSec?: number | null;
  },
  playedAtSec: number,
  shId: number,
  isRequest = false,
) {
  return {
    sh_id: shId,
    played_at: playedAtSec,
    duration: Math.round(track.durationSec ?? 0),
    playlist: "default",
    streamer: "",
    is_request: isRequest,
    song: {
      id: track.uuid,
      art: track.thumbnail ?? "",
      text: `${track.artist} - ${track.title}`,
      title: track.title,
      artist: track.artist,
      album: track.album ?? "",
      genre: "",
      isrc: "",
      lyrics: "",
    },
  };
}

export function buildNowPlayingResponse(
  status: RadioStatus & {
    streamUrl?: string;
    requestsEnabled?: boolean;
    requestsPending?: number;
  },
  origin: string,
  bitrateKbps = 256,
): NowPlayingApiResponse {
  const station = getStationConfig();
  const streamUrl = status.streamUrl ?? `${origin}/api/radio/stream`;
  const now = Math.floor(Date.now() / 1000);
  const startedMs = status.trackStartedAt
    ? Date.parse(status.trackStartedAt)
    : NaN;
  const elapsed =
    status.nowPlaying && Number.isFinite(startedMs)
      ? Math.max(0, Math.floor((Date.now() - startedMs) / 1000))
      : 0;
  const duration = Math.round(status.nowPlaying?.durationSec ?? 0);
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : 0;

  const history = (status.recentlyPlayed ?? []).map((track, i) => ({
    ...trackToSong(track, now - (i + 1) * 180, 1000 + i),
    song: {
      id: track.uuid,
      art: track.thumbnail ?? "",
      text: `${track.artist} - ${track.title}`,
      title: track.title,
      artist: track.artist,
      album: track.album ?? "",
    },
  }));

  const next = status.nextUp ?? status.upcoming?.[0] ?? null;

  return {
    station: {
      name: station.name,
      description: station.tagline,
      listen_url: streamUrl,
      url: origin,
      public_player_url: `${origin}/player`,
      is_online: Boolean(status.broadcasting),
      mounts: [
        {
          path: "/stream",
          url: streamUrl,
          bitrate: bitrateKbps,
          format: "mp3",
          listeners: {
            total: status.listeners ?? 0,
            unique: status.listeners ?? 0,
          },
        },
      ],
    },
    listeners: {
      total: status.listeners ?? 0,
      unique: status.listeners ?? 0,
    },
    live: {
      is_live: false,
      streamer_name: "",
      broadcast_start: status.trackStartedAt,
    },
    now_playing: status.nowPlaying
      ? {
          ...trackToSong(status.nowPlaying, now - elapsed, 1),
          elapsed,
          remaining,
        }
      : null,
    playing_next: next
      ? trackToSong(next, 0, 2)
      : null,
    song_history: history,
    is_online: Boolean(status.broadcasting),
    requests_enabled: Boolean(status.requestsEnabled),
    requests_pending: status.requestsPending ?? 0,
  };
}
