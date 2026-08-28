import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { getTrack, listTracks } from "@/lib/library";
import {
  getCrossfadeSec,
  getRadioTransition,
  resolveFfmpeg,
} from "@/lib/ffmpeg";
import {
  adjustListenerCount,
  cleanupStaleBroadcastLock,
  readRadioState,
  refreshBroadcastLock,
  setBroadcasting,
  tryAcquireBroadcastLock,
  updateNowPlaying,
  type RadioNowPlaying,
} from "@/lib/radio-state";
import { ensureTrackMp3 } from "@/lib/ytdlp";

export type { RadioNowPlaying };

type Subscriber = {
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
};

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class RadioStation {
  private subscribers = new Set<Subscriber>();
  private bag: string[] = [];
  private lastPlayedUuid: string | null = null;
  private loopStarted = false;
  private loopRunning = false;
  private isBroadcaster = false;
  private skipRequested = false;
  private playRequestUuid: string | null = null;
  private currentStream: ReadStream | null = null;
  private currentProc: ChildProcess | null = null;
  private ffmpegPath: string | null = null;
  private lockTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;

  nowPlaying: RadioNowPlaying | null = null;
  trackStartedAt: string | null = null;
  recentlyPlayed: RadioNowPlaying[] = [];
  listenerCount = 0;

  get queueRemaining(): number {
    return this.bag.length;
  }

  get broadcasting(): boolean {
    return this.isBroadcaster;
  }

  subscribe(): ReadableStream<Uint8Array> {
    const station = this;
    let subscriber: Subscriber;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        subscriber = {
          enqueue(chunk) {
            try {
              controller.enqueue(chunk);
            } catch {
              station.unsubscribe(subscriber);
            }
          },
          close() {
            try {
              controller.close();
            } catch {
              // already closed
            }
          },
        };
        station.subscribers.add(subscriber);
        void station.onListenerJoined();
        void station.start();
      },
      cancel() {
        station.unsubscribe(subscriber);
      },
    });

    return stream;
  }

  skip(): void {
    this.stopCurrent();
  }

  playNow(uuid: string): void {
    this.playRequestUuid = uuid;
    this.stopCurrent();
  }

  async start(): Promise<void> {
    await this.hydrateFromDisk();

    if (this.loopStarted) {
      if (!this.isBroadcaster) void this.tryBecomeBroadcaster();
      return;
    }
    this.loopStarted = true;

    this.ffmpegPath = await resolveFfmpeg();
    await this.tryBecomeBroadcaster();

    if (!this.retryTimer) {
      this.retryTimer = setInterval(() => {
        if (!this.isBroadcaster) void this.tryBecomeBroadcaster();
      }, 10_000);
    }
  }

  private async hydrateFromDisk(): Promise<void> {
    const state = await readRadioState();
    this.nowPlaying = state.nowPlaying;
    this.trackStartedAt = state.trackStartedAt;
    this.recentlyPlayed = state.recentlyPlayed ?? [];
    this.listenerCount = state.listenerCount ?? 0;
  }

  private async tryBecomeBroadcaster(): Promise<void> {
    if (this.isBroadcaster || this.loopRunning) return;

    await cleanupStaleBroadcastLock();
    const acquired = await tryAcquireBroadcastLock();
    if (!acquired) return;

    this.isBroadcaster = true;
    await setBroadcasting(true);
    await this.hydrateFromDisk();

    if (!this.lockTimer) {
      this.lockTimer = setInterval(() => {
        void refreshBroadcastLock();
      }, 8_000);
    }

    void this.runLoop();
  }

  private async onListenerJoined(): Promise<void> {
    this.listenerCount = await adjustListenerCount(1);
  }

  private stopCurrent(): void {
    this.skipRequested = true;
    this.currentStream?.destroy();
    this.currentStream = null;
    this.currentProc?.kill("SIGKILL");
    this.currentProc = null;
  }

  private async unsubscribe(subscriber: Subscriber): Promise<void> {
    subscriber.close();
    if (this.subscribers.delete(subscriber)) {
      this.listenerCount = await adjustListenerCount(-1);
    }
  }

  private broadcast(chunk: Buffer): void {
    const data = new Uint8Array(chunk);
    for (const sub of this.subscribers) {
      sub.enqueue(data);
    }
  }

  private async refillBag(): Promise<void> {
    const tracks = await listTracks({ readyOnly: true });
    const ids = shuffle(tracks.map((t) => t.uuid));

    if (
      ids.length > 1 &&
      this.lastPlayedUuid &&
      ids[0] === this.lastPlayedUuid
    ) {
      const first = ids.shift()!;
      ids.push(first);
    }

    this.bag = ids;
  }

  private async pickNext(): Promise<string | null> {
    if (this.playRequestUuid) {
      const uuid = this.playRequestUuid;
      this.playRequestUuid = null;
      return uuid;
    }

    const tracks = await listTracks({ readyOnly: true });
    if (!tracks.length) return null;

    for (let attempt = 0; attempt < tracks.length + 2; attempt++) {
      if (!this.bag.length) await this.refillBag();
      if (!this.bag.length) return null;

      const nextId = this.bag.shift()!;
      const exists = tracks.some((t) => t.uuid === nextId);
      if (exists) return nextId;
    }

    return null;
  }

  private async getDuration(uuid: string): Promise<number> {
    const track = await getTrack(uuid);
    if (track?.duration && track.duration > 0) return track.duration;
    return 180;
  }

  private async setNowPlaying(
    uuid: string,
    options?: { atCrossfade?: boolean; finishedPrevious?: boolean },
  ): Promise<void> {
    const track = await getTrack(uuid);
    const previous = this.nowPlaying;
    const atCrossfade = options?.atCrossfade ?? false;
    const addPrevious =
      options?.finishedPrevious &&
      previous?.uuid &&
      previous.uuid !== uuid
        ? previous
        : undefined;

    if (!track) {
      this.nowPlaying = {
        uuid,
        title: "Neznámá skladba",
        artist: "—",
        album: null,
        year: null,
        thumbnail: null,
      };
    } else {
      this.nowPlaying = {
        uuid: track.uuid,
        title: track.title,
        artist: track.artist,
        album: track.album,
        year: track.year,
        thumbnail: track.thumbnail,
      };
    }

    await updateNowPlaying(this.nowPlaying, {
      atCrossfade,
      addPreviousToRecent: addPrevious,
    });
    await this.hydrateFromDisk();
  }

  private async streamRawFile(filepath: string): Promise<void> {
    this.skipRequested = false;

    await new Promise<void>((resolve) => {
      const stream = createReadStream(filepath);
      this.currentStream = stream;

      stream.on("data", (chunk: string | Buffer) => {
        if (this.skipRequested) {
          stream.destroy();
          return;
        }
        this.broadcast(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      stream.on("close", () => {
        this.currentStream = null;
        resolve();
      });

      stream.on("error", () => {
        this.currentStream = null;
        resolve();
      });
    });
  }

  private async streamFfmpeg(args: string[]): Promise<void> {
    if (!this.ffmpegPath) return;
    this.skipRequested = false;

    await new Promise<void>((resolve) => {
      const proc = spawn(this.ffmpegPath!, args, {
        stdio: ["ignore", "pipe", "ignore"],
      });
      this.currentProc = proc;

      proc.stdout?.on("data", (chunk: Buffer) => {
        if (this.skipRequested) {
          proc.kill("SIGKILL");
          return;
        }
        this.broadcast(chunk);
      });

      proc.on("close", () => {
        this.currentProc = null;
        resolve();
      });

      proc.on("error", () => {
        this.currentProc = null;
        resolve();
      });
    });
  }

  private mp3OutArgs(): string[] {
    return ["-f", "mp3", "-b:a", "192k", "-write_xing", "0", "pipe:1"];
  }

  private async streamBody(
    filepath: string,
    offsetSec: number,
    durationSec: number,
  ): Promise<void> {
    if (durationSec <= 0.25) return;

    if (this.ffmpegPath) {
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        String(offsetSec),
        "-i",
        filepath,
        "-t",
        String(durationSec),
        ...this.mp3OutArgs(),
      ];
      await this.streamFfmpeg(args);
      return;
    }

    await this.streamRawFile(filepath);
  }

  private async streamCrossfade(
    pathA: string,
    offsetA: number,
    pathB: string,
    fadeSec: number,
  ): Promise<void> {
    if (!this.ffmpegPath || fadeSec <= 0) {
      await this.streamRawFile(pathA);
      await this.streamRawFile(pathB);
      return;
    }

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(offsetA),
      "-i",
      pathA,
      "-i",
      pathB,
      "-filter_complex",
      `[0:a][1:a]acrossfade=d=${fadeSec}:c1=tri:c2=tri`,
      ...this.mp3OutArgs(),
    ];
    await this.streamFfmpeg(args);
  }

  private computeFade(durA: number, durB: number, fadeSec: number): number {
    const maxFade = Math.min(
      fadeSec,
      durA * 0.4,
      durB * 0.4,
      durA - 0.5,
      durB - 0.5,
    );
    return Math.max(0, maxFade);
  }

  private async resolveTrackPath(uuid: string): Promise<string | null> {
    await refreshBroadcastLock();
    return ensureTrackMp3(uuid);
  }

  private async streamPair(currentUuid: string, nextUuid: string): Promise<void> {
    const pathA = await this.resolveTrackPath(currentUuid);
    const pathB = await this.resolveTrackPath(nextUuid);
    if (!pathA || !pathB) {
      this.bag = this.bag.filter((id) => id !== currentUuid && id !== nextUuid);
      return;
    }

    const durA = await this.getDuration(currentUuid);
    const durB = await this.getDuration(nextUuid);
    const fadeSec = getCrossfadeSec();
    const useCrossfade =
      getRadioTransition() === "crossfade" && this.ffmpegPath && fadeSec > 0;

    this.skipRequested = false;
    this.lastPlayedUuid = currentUuid;

    if (!useCrossfade) {
      await this.setNowPlaying(currentUuid);
      await refreshBroadcastLock();
      await this.streamRawFile(pathA);
      return;
    }

    const fade = this.computeFade(durA, durB, fadeSec);
    if (fade < 0.5) {
      await this.setNowPlaying(currentUuid);
      await refreshBroadcastLock();
      await this.streamRawFile(pathA);
      return;
    }

    const bodyA = durA - fade;
    if (bodyA > 0.5) {
      await this.setNowPlaying(currentUuid);
      await refreshBroadcastLock();
      await this.streamBody(pathA, 0, bodyA);
    }

    if (this.skipRequested) return;

    await this.setNowPlaying(nextUuid, {
      atCrossfade: true,
      finishedPrevious: true,
    });
    await this.streamCrossfade(pathA, bodyA, pathB, fade);

    if (this.skipRequested) return;

    const bodyBStart = fade;
    const bodyBLen = durB - 2 * fade;
    if (bodyBLen > 0.5) {
      await this.streamBody(pathB, bodyBStart, bodyBLen);
    }
  }

  private async streamSolo(uuid: string): Promise<void> {
    const filepath = await this.resolveTrackPath(uuid);
    if (!filepath) {
      this.bag = this.bag.filter((id) => id !== uuid);
      return;
    }

    this.skipRequested = false;
    this.lastPlayedUuid = uuid;
    await this.setNowPlaying(uuid);
    await refreshBroadcastLock();
    await this.streamRawFile(filepath);
  }

  private async runLoop(): Promise<void> {
    if (this.loopRunning) return;
    this.loopRunning = true;

    let currentUuid = await this.pickNext();

    while (this.isBroadcaster) {
      if (!currentUuid) {
        await sleep(3000);
        currentUuid = await this.pickNext();
        continue;
      }

      const nextUuid = await this.pickNext();
      if (!nextUuid || nextUuid === currentUuid) {
        await this.streamSolo(currentUuid);
        if (this.skipRequested) {
          this.skipRequested = false;
          currentUuid = await this.pickNext();
          continue;
        }
        currentUuid = await this.pickNext();
        continue;
      }

      await this.streamPair(currentUuid, nextUuid);
      if (this.skipRequested) {
        this.skipRequested = false;
        currentUuid = await this.pickNext();
        continue;
      }

      currentUuid = nextUuid;
    }

    this.loopRunning = false;
  }
}

const globalForRadio = globalThis as unknown as {
  __aiRadioStation?: RadioStation;
};

export function getRadioStation(): RadioStation {
  if (!globalForRadio.__aiRadioStation) {
    globalForRadio.__aiRadioStation = new RadioStation();
    void globalForRadio.__aiRadioStation.start();
  }
  return globalForRadio.__aiRadioStation;
}
