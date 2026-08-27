import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { getTrack, listTracks } from "@/lib/library";
import {
  readRadioState,
  refreshBroadcastLock,
  tryAcquireBroadcastLock,
  writeRadioState,
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

  nowPlaying: RadioNowPlaying | null = null;

  get listenerCount(): number {
    return this.subscribers.size;
  }

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
        void station.start();
      },
      cancel() {
        station.unsubscribe(subscriber);
      },
    });

    return stream;
  }

  skip(): void {
    this.skipRequested = true;
    this.currentStream?.destroy();
  }

  playNow(uuid: string): void {
    this.playRequestUuid = uuid;
    this.skipRequested = true;
    this.currentStream?.destroy();
  }

  async start(): Promise<void> {
    if (this.loopStarted) return;
    this.loopStarted = true;

    const state = await readRadioState();
    if (state?.nowPlaying) {
      this.nowPlaying = state.nowPlaying;
    }

    this.isBroadcaster = await tryAcquireBroadcastLock();
    if (this.isBroadcaster) {
      void this.runLoop();
    }
  }

  private unsubscribe(subscriber: Subscriber): void {
    subscriber.close();
    this.subscribers.delete(subscriber);
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

  private async setNowPlaying(uuid: string): Promise<void> {
    const track = await getTrack(uuid);
    if (!track) {
      this.nowPlaying = {
        uuid,
        title: "Neznámá skladba",
        artist: "—",
        album: null,
        year: null,
        thumbnail: null,
      };
      await writeRadioState(this.nowPlaying);
      return;
    }

    this.nowPlaying = {
      uuid: track.uuid,
      title: track.title,
      artist: track.artist,
      album: track.album,
      year: track.year,
      thumbnail: track.thumbnail,
    };
    await writeRadioState(this.nowPlaying);
  }

  private async streamTrack(uuid: string): Promise<void> {
    const filepath = await ensureTrackMp3(uuid);
    if (!filepath) return;

    this.skipRequested = false;
    this.lastPlayedUuid = uuid;
    await this.setNowPlaying(uuid);
    await refreshBroadcastLock();

    const startedAt = Date.now();

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

    const elapsed = Date.now() - startedAt;
    if (elapsed < 1500 && !this.skipRequested) {
      await new Promise((r) => setTimeout(r, 1500 - elapsed));
    }
  }

  private async runLoop(): Promise<void> {
    if (this.loopRunning) return;
    this.loopRunning = true;

    while (true) {
      const uuid = await this.pickNext();
      if (!uuid) {
        this.nowPlaying = null;
        await writeRadioState(null);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      await this.streamTrack(uuid);
    }
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
