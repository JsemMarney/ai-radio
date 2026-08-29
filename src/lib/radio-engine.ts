import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildHeadLinearFadeFilter,
  buildMidsongPreviewFilterGraph,
  buildPairCrossfadeFilterGraph,
  buildTailLinearFadeFilter,
  buildTransitionPreviewFilterGraph,
  computePairFade,
  getJingleConfig,
  getMidsongConfig,
  getMidsongPreviewTiming,
  getTransitionPreviewTiming,
  pairCrossfadeStartSec,
  pickMidsongPath,
  probePlayableDuration,
  type MidsongConfig,
  type MidsongPreviewTiming,
} from "@/lib/audio-process";
import {
  getCrossfadeSec,
  getRadioTransition,
  mp3EncodeArgs,
  probeDuration,
  resolveFfmpeg,
} from "@/lib/ffmpeg";
import { getDownloadsDir, getTrack } from "@/lib/library";
import {
  ensureQueueDepth,
  loadBag,
  peekFromBag,
  prependToBag,
  QUEUE_TARGET_SIZE,
  removeFromBag,
  saveBag,
} from "@/lib/radio-playlist";
import {
  readRadioState,
  setBroadcasting,
  updateNowPlaying,
  type RadioNowPlaying,
} from "@/lib/radio-state";
import { ensureBroadcastFile } from "@/lib/remaster";
import { StreamPacer } from "@/lib/stream-pacer";

export type RadioStatus = {
  nowPlaying: RadioNowPlaying | null;
  trackStartedAt: string | null;
  recentlyPlayed: RadioNowPlaying[];
  listeners: number;
  broadcasting: boolean;
  queueRemaining: number;
  sessionId: string | null;
};

type Subscriber = {
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const execFileAsync = promisify(execFile);

export class RadioEngine {
  private subscribers = new Set<Subscriber>();
  private bag: string[] = [];
  private lastPlayedUuid: string | null = null;
  private loopRunning = false;
  private skipRequested = false;
  private transitionTestRequested = false;
  private midsongTestRequested = false;
  private playResumeOffsetSec = 0;
  private playRequestUuid: string | null = null;
  reservedNextUuid: string | null = null;
  private currentStream: ReadStream | null = null;
  private currentProc: ChildProcess | null = null;
  private sessionPacer: StreamPacer | null = null;
  private pacingTimers: ReturnType<typeof setTimeout>[] = [];
  private ffmpegPath: string | null = null;
  private durationCache = new Map<string, number>();
  private started = false;
  private tracksSinceJingle = 0;
  private jinglePath: string | null = null;
  private jingleEvery = 4;
  private midsongConfig: MidsongConfig = {
    paths: [],
    everyNTracks: 1,
    chance: 1,
    fadeSec: 4,
  };
  private transitionsSinceMidsong = 0;

  nowPlaying: RadioNowPlaying | null = null;
  trackStartedAt: string | null = null;
  recentlyPlayed: RadioNowPlaying[] = [];
  listenerCount = 0;
  sessionId: string | null = null;

  onStatusChange: ((status: RadioStatus) => void) | null = null;

  get queueRemaining(): number {
    const raw = this.bag.length + (this.reservedNextUuid ? 1 : 0);
    return Math.min(QUEUE_TARGET_SIZE, raw);
  }

  private lastSseTrackKey = "";

  getStatus(): RadioStatus {
    return {
      nowPlaying: this.nowPlaying,
      trackStartedAt: this.trackStartedAt,
      recentlyPlayed: this.recentlyPlayed.filter(
        (t) => t.uuid !== this.nowPlaying?.uuid,
      ),
      listeners: this.listenerCount,
      broadcasting: this.started,
      queueRemaining: this.queueRemaining,
      sessionId: this.sessionId,
    };
  }

  private emitStatus(force = false): void {
    const trackKey = [
      this.nowPlaying?.uuid ?? "",
      this.recentlyPlayed.map((t) => t.uuid).join(","),
    ].join("|");

    if (!force && trackKey === this.lastSseTrackKey) return;
    this.lastSseTrackKey = trackKey;
    this.onStatusChange?.(this.getStatus());
  }

  private emitListeners(): void {
    this.onStatusChange?.(this.getStatus());
  }

  subscribe(): ReadableStream<Uint8Array> {
    const engine = this;
    let subscriber!: Subscriber;
    let flushPending: (() => void) | null = null;

    return new ReadableStream<Uint8Array>({
      highWaterMark: 256,
      start(controller) {
        const pending: Uint8Array[] = [];
        const MAX_PENDING = 384;

        flushPending = () => {
          while (pending.length > 0) {
            try {
              controller.enqueue(pending.shift()!);
            } catch {
              break;
            }
          }
        };

        subscriber = {
          enqueue(chunk) {
            pending.push(chunk);
            if (pending.length > MAX_PENDING) {
              pending.splice(0, pending.length - MAX_PENDING);
            }
            flushPending?.();
          },
          close() {
            pending.length = 0;
            try {
              controller.close();
            } catch {
              // already closed
            }
          },
        };
        engine.subscribers.add(subscriber);
        engine.listenerCount += 1;
        engine.emitListeners();
      },
      pull() {
        flushPending?.();
      },
      cancel() {
        engine.unsubscribe(subscriber);
      },
    });
  }

  skip(): void {
    this.stopCurrent();
  }

  /** Na živém streamu přehraje ukázku konce aktuální + crossfade do další skladby. */
  testTransition(): void {
    this.transitionTestRequested = true;
    this.stopCurrent();
  }

  /** Live test: konec skladby → midsong → začátek další. */
  testMidsong(): void {
    this.midsongTestRequested = true;
    this.stopCurrent();
  }

  /** Vyrenderuje MP3 ukázku crossfade (konec A → začátek B). */
  async renderTransitionPreview(
    fromUuid?: string | null,
    toUuid?: string | null,
  ): Promise<string | null> {
    if (!this.ffmpegPath) return null;

    const currentUuid =
      fromUuid ?? this.nowPlaying?.uuid ?? (await this.peekNext());
    const nextUuid =
      toUuid ??
      this.reservedNextUuid ??
      (currentUuid ? await this.peekNext(currentUuid) : null);
    if (!currentUuid || !nextUuid || currentUuid === nextUuid) return null;

    const pathA = await ensureBroadcastFile(currentUuid);
    const pathB = await ensureBroadcastFile(nextUuid);
    if (!pathA || !pathB) return null;

    const durA = await this.getPlayableDuration(currentUuid, pathA);
    const durB = await this.getPlayableDuration(nextUuid, pathB);
    const fadeSec = getCrossfadeSec();
    const timing = getTransitionPreviewTiming(durA, durB, fadeSec);

    const previewDir = path.join(getDownloadsDir(), "_preview");
    await mkdir(previewDir, { recursive: true });
    const outPath = path.join(previewDir, `${randomUUID()}.mp3`);

    try {
      await execFileAsync(
        this.ffmpegPath,
        [
          "-y",
          "-i",
          pathA,
          "-i",
          pathB,
          "-filter_complex",
          buildTransitionPreviewFilterGraph(
            timing.startA,
            durA,
            durB,
            fadeSec,
          ),
          "-t",
          String(timing.duration),
          ...mp3EncodeArgs("[aout]", outPath),
        ],
        { timeout: 180_000 },
      );

      const outDur = await probeDuration(outPath);
      if (!outDur || outDur < 1) return null;
      return outPath;
    } catch (err) {
      console.warn("[radio] Náhled přechodu selhal:", err);
      return null;
    }
  }

  playNow(uuid: string): void {
    this.playRequestUuid = uuid;
    this.reservedNextUuid = null;
    this.stopCurrent();
  }

  async start(): Promise<void> {
    const boot = await setBroadcasting(true);
    this.sessionId = boot.sessionId;
    this.nowPlaying = boot.nowPlaying;
    this.recentlyPlayed = boot.recentlyPlayed ?? [];

    if (boot.nowPlaying?.uuid && boot.trackStartedAt) {
      const path = await ensureBroadcastFile(boot.nowPlaying.uuid);
      const dur = path
        ? await this.getDuration(boot.nowPlaying.uuid, path)
        : 0;
      const startedMs = Date.parse(boot.trackStartedAt);
      const elapsed =
        Number.isFinite(startedMs) ? (Date.now() - startedMs) / 1000 : Infinity;
      if (dur > 0 && elapsed >= dur - 1) {
        const refreshed = await updateNowPlaying(boot.nowPlaying, {
          restartTrackClock: true,
        });
        this.trackStartedAt = refreshed.trackStartedAt;
      } else {
        this.trackStartedAt = boot.trackStartedAt;
      }
    } else {
      this.trackStartedAt = boot.trackStartedAt;
    }

    const playlist = await loadBag();
    this.bag = playlist.bag;
    this.lastPlayedUuid = playlist.lastPlayedUuid;
    await this.refillBag();

    this.ffmpegPath = await resolveFfmpeg();
    const jingle = getJingleConfig();
    this.jingleEvery = jingle.everyNTracks;
    this.jinglePath = jingle.path;
    this.midsongConfig = getMidsongConfig();
    this.transitionsSinceMidsong = 0;
    this.started = true;
    if (!this.loopRunning) void this.runLoop();
    this.emitStatus(true);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.stopCurrent();
    await setBroadcasting(false);
    this.emitStatus(true);
  }

  private stopCurrent(): void {
    this.skipRequested = true;
    this.sessionPacer?.stop();
    this.sessionPacer = null;
    for (const t of this.pacingTimers) clearTimeout(t);
    this.pacingTimers = [];
    this.currentStream?.destroy();
    this.currentStream = null;
    if (this.currentProc) {
      this.currentProc.kill("SIGTERM");
      setTimeout(() => this.currentProc?.kill("SIGKILL"), 500);
      this.currentProc = null;
    }
  }

  private unsubscribe(subscriber: Subscriber): void {
    subscriber.close();
    if (this.subscribers.delete(subscriber)) {
      this.listenerCount = Math.max(0, this.listenerCount - 1);
      this.emitListeners();
    }
  }

  getIcyTitle(): string {
    if (!this.nowPlaying) return "";
    return `${this.nowPlaying.artist} - ${this.nowPlaying.title}`;
  }

  /** Poslední skladby — pro cooldown opakování ve frontě. */
  private getRecentUuids(): string[] {
    const ids: string[] = [];
    if (this.nowPlaying?.uuid) ids.push(this.nowPlaying.uuid);
    for (const track of this.recentlyPlayed) {
      if (!ids.includes(track.uuid)) ids.push(track.uuid);
    }
    if (this.lastPlayedUuid && !ids.includes(this.lastPlayedUuid)) {
      ids.push(this.lastPlayedUuid);
    }
    return ids;
  }

  private async refillBag(): Promise<void> {
    const topped = await ensureQueueDepth(this.bag, this.getRecentUuids());
    if (
      topped.length !== this.bag.length ||
      topped.some((id, index) => id !== this.bag[index])
    ) {
      this.bag = topped;
      await saveBag(this.bag, this.lastPlayedUuid);
    }
  }

  /** Nahlédnutí do fronty (bez commit). */
  async getUpcoming(limit = QUEUE_TARGET_SIZE): Promise<RadioNowPlaying[]> {
    const out: RadioNowPlaying[] = [];
    let simulated = [...this.bag];
    if (this.reservedNextUuid) {
      simulated = removeFromBag(simulated, this.reservedNextUuid);
    }
    let avoid = this.nowPlaying?.uuid ?? null;
    const seen = new Set<string>();
    const recentUuids = this.getRecentUuids();

    if (this.reservedNextUuid && !seen.has(this.reservedNextUuid)) {
      const t = await this.trackToNowPlaying(this.reservedNextUuid);
      if (t) {
        out.push(t);
        seen.add(t.uuid);
        avoid = t.uuid;
      }
    }

    while (out.length < limit) {
      const pick = await peekFromBag(simulated, recentUuids, avoid);
      if (!pick.uuid) break;

      if (seen.has(pick.uuid)) {
        simulated = removeFromBag(simulated, pick.uuid);
        avoid = pick.uuid;
        continue;
      }

      const t = await this.trackToNowPlaying(pick.uuid);
      if (t) out.push(t);
      seen.add(pick.uuid);
      avoid = pick.uuid;
      simulated = removeFromBag(simulated, pick.uuid);
    }

    return out.slice(0, limit);
  }

  /** Odebere skladbu z fronty (studio). */
  async removeFromQueue(uuid: string): Promise<boolean> {
    if (!this.bag.includes(uuid) && this.reservedNextUuid !== uuid) {
      return false;
    }
    this.bag = removeFromBag(this.bag, uuid);
    if (this.reservedNextUuid === uuid) {
      this.reservedNextUuid = null;
    }
    await saveBag(this.bag, this.lastPlayedUuid);
    await this.refillBag();
    this.emitStatus(true);
    return true;
  }

  private async trackToNowPlaying(uuid: string): Promise<RadioNowPlaying | null> {
    const track = await getTrack(uuid);
    if (!track) return null;
    return {
      uuid: track.uuid,
      title: track.title,
      artist: track.artist,
      album: track.album,
      year: track.year,
      thumbnail: track.thumbnail,
      durationSec: track.playDuration ?? track.duration ?? null,
    };
  }

  private async maybePlayJingle(): Promise<void> {
    if (!this.jinglePath || this.skipRequested) return;
    if (this.tracksSinceJingle < this.jingleEvery) return;
    this.tracksSinceJingle = 0;
    this.skipRequested = false;
    await this.streamBroadcastFile(this.jinglePath);
  }

  private onTrackFinished(): void {
    this.tracksSinceJingle += 1;
  }

  /** Vložit midsong mezi skladby (test: every=1, chance=1). */
  private shouldPlayMidsong(): boolean {
    this.midsongConfig = getMidsongConfig();
    if (!this.midsongConfig.paths.length) {
      return false;
    }
    if (!this.ffmpegPath) {
      console.warn("[radio] Midsong vypnuto — chybí ffmpeg.");
      return false;
    }
    this.transitionsSinceMidsong += 1;
    if (this.transitionsSinceMidsong < this.midsongConfig.everyNTracks) {
      return false;
    }
    this.transitionsSinceMidsong = 0;
    if (Math.random() > this.midsongConfig.chance) {
      return false;
    }
    return true;
  }

  private async streamPairViaMidsong(
    pathA: string,
    pathB: string,
    currentUuid: string,
    nextUuid: string,
    durA: number,
    durB: number,
    midsongPath: string,
  ): Promise<{ finished: boolean; nextStarted: boolean }> {
    const fadeSec = this.midsongConfig.fadeSec;
    this.skipRequested = false;
    await this.setNowPlaying(currentUuid);

    await this.streamFfmpeg([
      "-i",
      pathA,
      "-filter_complex",
      buildTailLinearFadeFilter(durA, fadeSec),
      ...mp3EncodeArgs("[aout]"),
    ]);

    if (this.skipRequested) {
      return { finished: false, nextStarted: false };
    }

    await this.commitNext(currentUuid);
    await this.markPlayed(currentUuid);

    await this.streamFfmpeg([
      "-i",
      midsongPath,
      ...mp3EncodeArgs(),
    ]);

    if (this.skipRequested) {
      await this.returnReserved(nextUuid);
      return { finished: true, nextStarted: false };
    }

    await this.commitNext(nextUuid);
    await this.markPlayed(nextUuid);
    await this.setNowPlaying(nextUuid, { finishedPrevious: true });

    await this.streamFfmpeg([
      "-i",
      pathB,
      "-filter_complex",
      buildHeadLinearFadeFilter(fadeSec),
      ...mp3EncodeArgs("[aout]"),
    ]);

    if (this.skipRequested) {
      return { finished: false, nextStarted: true };
    }

    return { finished: true, nextStarted: true };
  }

  private broadcast(chunk: Buffer): void {
    const data = new Uint8Array(chunk);
    for (const sub of this.subscribers) {
      sub.enqueue(data);
    }
  }

  /** Jeden pacer na celou relaci — bez resetu hodin mezi skladbami/jinglem. */
  private getPacer(): StreamPacer {
    if (!this.sessionPacer) {
      this.sessionPacer = new StreamPacer((buf) => this.broadcast(buf));
    }
    return this.sessionPacer;
  }

  /** Nahlédne do fronty — skladba zůstane v bagu. */
  private async peekNext(avoidUuid?: string | null): Promise<string | null> {
    if (this.playRequestUuid) {
      return this.playRequestUuid;
    }

    const result = await peekFromBag(
      this.bag,
      this.getRecentUuids(),
      avoidUuid ?? this.nowPlaying?.uuid ?? null,
    );
    if (!this.bag.length && result.bag.length) {
      this.bag = result.bag;
      await saveBag(this.bag, this.lastPlayedUuid);
    }
    return result.uuid;
  }

  /** Odebere skladbu z fronty a uloží bag. */
  private async commitNext(uuid: string): Promise<void> {
    if (this.playRequestUuid === uuid) {
      this.playRequestUuid = null;
      return;
    }
    if (!this.bag.includes(uuid)) {
      this.reservedNextUuid = null;
      return;
    }
    this.bag = removeFromBag(this.bag, uuid);
    this.reservedNextUuid = null;
    await saveBag(this.bag, this.lastPlayedUuid);
    await this.refillBag();
  }

  /** Vrátí neodehranou skladbu zpět na začátek fronty. */
  private async returnReserved(uuid: string): Promise<void> {
    if (this.playRequestUuid === uuid) {
      this.playRequestUuid = null;
      return;
    }
    this.bag = prependToBag(this.bag, uuid);
    this.reservedNextUuid = null;
    await saveBag(this.bag, this.lastPlayedUuid);
  }

  private async markPlayed(uuid: string): Promise<void> {
    this.lastPlayedUuid = uuid;
    await saveBag(this.bag, uuid);
    await this.refillBag();
  }

  private isCorruptDuration(probed: number, metaDuration: number): boolean {
    if (metaDuration <= 0) return probed > 0 && probed < 15;
    return probed < Math.min(30, metaDuration * 0.25);
  }

  private async getPlayableDuration(
    uuid: string,
    filepath?: string | null,
  ): Promise<number> {
    const cached = this.durationCache.get(uuid);
    if (cached && cached > 0) return cached;
    return this.getDuration(uuid, filepath);
  }

  private async getDuration(uuid: string, filepath?: string | null): Promise<number> {
    const track = await getTrack(uuid);
    const metaDuration =
      track?.duration && track.duration > 0 ? track.duration : 0;

    const filePath = filepath ?? (await ensureBroadcastFile(uuid));
    let probed = 0;
    if (filePath) {
      if (this.ffmpegPath) {
        const playable = await probePlayableDuration(filePath, this.ffmpegPath);
        if (playable > 0) probed = playable;
      }
      if (probed <= 0) {
        const p = await probeDuration(filePath);
        if (p && p > 0) probed = p;
      }
    }

    // Reálná délka slyšitelného audia — metadata neprodlužují 1s clip na 3 min.
    if (probed > 0) {
      this.durationCache.set(uuid, probed);
      return probed;
    }

    const playDuration = track?.playDuration ?? 0;
    const minOk = Math.min(30, metaDuration * 0.25);
    if (playDuration > minOk) {
      this.durationCache.set(uuid, playDuration);
      return playDuration;
    }

    if (metaDuration > 0) {
      this.durationCache.set(uuid, metaDuration);
      return metaDuration;
    }

    const cached = this.durationCache.get(uuid);
    if (cached && cached > 0) return cached;

    return 180;
  }

  private async streamBroadcastFile(filepath: string): Promise<void> {
    await this.streamRawFile(filepath);
  }

  private async setNowPlaying(
    uuid: string,
    options?: {
      atCrossfade?: boolean;
      finishedPrevious?: boolean;
      restartTrackClock?: boolean;
    },
  ): Promise<void> {
    const track = await getTrack(uuid);
    const previous = this.nowPlaying;
    const atCrossfade = options?.atCrossfade ?? false;
    const restartTrackClock =
      options?.restartTrackClock ?? !atCrossfade;
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
        durationSec: null,
      };
    } else {
      this.nowPlaying = {
        uuid: track.uuid,
        title: track.title,
        artist: track.artist,
        album: track.album,
        year: track.year,
        thumbnail: track.thumbnail,
        durationSec: track.playDuration ?? track.duration ?? null,
      };
    }

    const written = await updateNowPlaying(this.nowPlaying, {
      atCrossfade,
      addPreviousToRecent: addPrevious,
      restartTrackClock,
    });
    this.trackStartedAt = written.trackStartedAt;
    this.recentlyPlayed = written.recentlyPlayed ?? [];
    this.sessionId = written.sessionId ?? this.sessionId;
    this.emitStatus();
  }

  private async streamRawFile(filepath: string): Promise<void> {
    this.skipRequested = false;
    const pacer = this.getPacer();

    await new Promise<void>((resolve) => {
      const stream = createReadStream(filepath, { highWaterMark: 64 * 1024 });
      this.currentStream = stream;

      stream.on("data", (chunk: string | Buffer) => {
        if (this.skipRequested) {
          stream.destroy();
          return;
        }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        pacer.enqueue(buf);
      });

      stream.on("close", () => {
        this.currentStream = null;
        void pacer.flush().then(resolve);
      });
      stream.on("error", () => {
        this.currentStream = null;
        pacer.abortSegment();
        resolve();
      });
    });
  }

  private async streamFfmpeg(args: string[]): Promise<void> {
    if (!this.ffmpegPath) return;
    this.skipRequested = false;
    const pacer = this.getPacer();

    await new Promise<void>((resolve) => {
      const proc = spawn(this.ffmpegPath!, args, {
        stdio: ["ignore", "pipe", "ignore"],
        readableHighWaterMark: 64 * 1024,
      });
      this.currentProc = proc;

      proc.stdout?.on("data", (chunk: Buffer) => {
        if (this.skipRequested) {
          proc.kill("SIGTERM");
          return;
        }
        pacer.enqueue(chunk);
      });

      proc.on("close", () => {
        this.currentProc = null;
        void pacer.flush().then(resolve);
      });
      proc.on("error", () => {
        this.currentProc = null;
        pacer.abortSegment();
        resolve();
      });
    });
  }

  private async streamBody(
    filepath: string,
    offsetSec: number,
    durationSec: number,
  ): Promise<void> {
    if (durationSec <= 0.25) return;

    if (this.ffmpegPath) {
      await this.streamFfmpeg([
        "-ss", String(Math.max(0, offsetSec)),
        "-i", filepath,
        "-t", String(durationSec),
        ...mp3EncodeArgs(),
      ]);
      return;
    }

    await this.streamRawFile(filepath);
  }

  private async streamPairCrossfade(
    pathA: string,
    pathB: string,
    durA: number,
    durB: number,
    fade: number,
  ): Promise<void> {
    if (!this.ffmpegPath || fade <= 0) {
      await this.streamBroadcastFile(pathA);
      await this.streamBroadcastFile(pathB);
      return;
    }

    const filter = buildPairCrossfadeFilterGraph(durA, durB, fade);
    await this.streamFfmpeg([
      "-i", pathA,
      "-i", pathB,
      "-filter_complex", filter,
      ...mp3EncodeArgs("[aout]"),
    ]);
  }

  private computeFade(durA: number, durB: number, fadeSec: number): number {
    return computePairFade(durA, durB, fadeSec);
  }

  private async playTransitionTest(
    currentUuid: string,
    nextUuid: string,
  ): Promise<{ nextUuid: string; resumeOffsetSec: number } | null> {
    const durAPath = await ensureBroadcastFile(currentUuid);
    const durBPath = await ensureBroadcastFile(nextUuid);
    if (!durAPath || !durBPath) return null;

    const durA = await this.getDuration(currentUuid, durAPath);
    const durB = await this.getDuration(nextUuid, durBPath);
    const fadeSec = getCrossfadeSec();
    const timing = getTransitionPreviewTiming(durA, durB, fadeSec);

    const previewPath = await this.renderTransitionPreview(
      currentUuid,
      nextUuid,
    );
    if (!previewPath) return null;

    this.skipRequested = false;
    await this.setNowPlaying(currentUuid);

    const crossfadeAtMs = Math.max(
      0,
      (timing.leadSec) * 1000,
    );
    let crossfadeTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      crossfadeTimer = null;
      if (this.skipRequested) return;
      void this.setNowPlaying(nextUuid, {
        atCrossfade: true,
        finishedPrevious: true,
      });
    }, crossfadeAtMs);

    try {
      await this.streamBroadcastFile(previewPath);
    } finally {
      if (crossfadeTimer) clearTimeout(crossfadeTimer);
      await unlink(previewPath).catch(() => {});
    }

    if (this.skipRequested) return null;

    return { nextUuid, resumeOffsetSec: timing.resumeOffsetSec };
  }

  async renderMidsongPreview(
    fromUuid?: string | null,
    toUuid?: string | null,
    midsongPath?: string | null,
  ): Promise<{ path: string; timing: MidsongPreviewTiming } | null> {
    if (!this.ffmpegPath) return null;

    this.midsongConfig = getMidsongConfig();
    const midPath =
      midsongPath ?? pickMidsongPath(this.midsongConfig);
    if (!midPath) return null;

    const currentUuid =
      fromUuid ?? this.nowPlaying?.uuid ?? (await this.peekNext());
    const nextUuid =
      toUuid ??
      this.reservedNextUuid ??
      (currentUuid ? await this.peekNext(currentUuid) : null);
    if (!currentUuid || !nextUuid || currentUuid === nextUuid) return null;

    const pathA = await ensureBroadcastFile(currentUuid);
    const pathB = await ensureBroadcastFile(nextUuid);
    if (!pathA || !pathB) return null;

    const durA = await this.getPlayableDuration(currentUuid, pathA);
    const durB = await this.getPlayableDuration(nextUuid, pathB);
    const midsongDur = (await probeDuration(midPath)) ?? 6;
    const timing = getMidsongPreviewTiming(
      durA,
      durB,
      midsongDur,
      this.midsongConfig.fadeSec,
    );

    const previewDir = path.join(getDownloadsDir(), "_preview");
    await mkdir(previewDir, { recursive: true });
    const outPath = path.join(previewDir, `${randomUUID()}.mp3`);

    try {
      await execFileAsync(this.ffmpegPath, [
        "-y",
        "-i",
        pathA,
        "-i",
        midPath,
        "-i",
        pathB,
        "-filter_complex",
        buildMidsongPreviewFilterGraph(timing, durA, midsongDur),
        "-t",
        String(timing.duration),
        ...mp3EncodeArgs("[aout]", outPath),
      ]);
      return { path: outPath, timing };
    } catch (err) {
      console.error("[radio] Midsong preview selhal:", err);
      await unlink(outPath).catch(() => {});
      return null;
    }
  }

  private async playMidsongTest(
    currentUuid: string,
    nextUuid: string,
  ): Promise<{ nextUuid: string; resumeOffsetSec: number } | null> {
    const rendered = await this.renderMidsongPreview(currentUuid, nextUuid);
    if (!rendered) return null;

    const { path: previewPath, timing } = rendered;
    this.midsongConfig = getMidsongConfig();
    const midsongPath = pickMidsongPath(this.midsongConfig);
    const midsongDur = midsongPath
      ? ((await probeDuration(midsongPath)) ?? 6)
      : 6;

    this.skipRequested = false;
    await this.setNowPlaying(currentUuid);

    const midsongAtMs = Math.max(0, timing.leadSec * 1000);
    let midsongTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      midsongTimer = null;
      if (this.skipRequested) return;
      void this.commitNext(currentUuid);
      void this.markPlayed(currentUuid);
    }, midsongAtMs);

    const nextAtMs = Math.max(0, (timing.leadSec + midsongDur) * 1000);
    let nextTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      nextTimer = null;
      if (this.skipRequested) return;
      void this.commitNext(nextUuid);
      void this.markPlayed(nextUuid);
      void this.setNowPlaying(nextUuid, {
        atCrossfade: true,
        finishedPrevious: true,
      });
    }, nextAtMs);

    try {
      await this.streamBroadcastFile(previewPath);
    } finally {
      if (midsongTimer) clearTimeout(midsongTimer);
      if (nextTimer) clearTimeout(nextTimer);
      await unlink(previewPath).catch(() => {});
    }

    if (this.skipRequested) return null;

    return { nextUuid, resumeOffsetSec: timing.resumeOffsetSec };
  }

  private async handleMidsongTest(
    currentUuid: string,
  ): Promise<{ currentUuid: string | null; ran: boolean }> {
    this.midsongTestRequested = false;
    this.skipRequested = false;

    const nextUuid =
      this.reservedNextUuid ?? (await this.peekNext(currentUuid));
    if (!nextUuid || nextUuid === currentUuid) {
      return { currentUuid, ran: false };
    }

    const result = await this.playMidsongTest(currentUuid, nextUuid);
    if (!result) {
      return { currentUuid, ran: false };
    }

    this.playResumeOffsetSec = result.resumeOffsetSec;
    return { currentUuid: result.nextUuid, ran: true };
  }

  private async streamPair(
    currentUuid: string,
    nextUuid: string,
  ): Promise<{ finished: boolean; nextStarted: boolean }> {
    if (currentUuid === nextUuid) {
      return { finished: false, nextStarted: false };
    }

    const pathA = await ensureBroadcastFile(currentUuid);
    const pathB = await ensureBroadcastFile(nextUuid);
    if (!pathA || !pathB) {
      this.bag = this.bag.filter((id) => id !== currentUuid && id !== nextUuid);
      return { finished: false, nextStarted: false };
    }

    const trackA = await getTrack(currentUuid);
    const trackB = await getTrack(nextUuid);
    const probedA = (await probeDuration(pathA)) ?? 0;
    const probedB = (await probeDuration(pathB)) ?? 0;
    const metaA = trackA?.duration ?? 0;
    const metaB = trackB?.duration ?? 0;

    if (this.isCorruptDuration(probedA, metaA)) {
      console.warn(`[radio] Poškozená skladba, přeskakuji: ${trackA?.title ?? currentUuid}`);
      this.bag = removeFromBag(this.bag, currentUuid);
      await saveBag(this.bag, this.lastPlayedUuid);
      return { finished: false, nextStarted: false };
    }
    if (this.isCorruptDuration(probedB, metaB)) {
      console.warn(`[radio] Poškozená skladba ve frontě, přeskakuji: ${trackB?.title ?? nextUuid}`);
      this.bag = removeFromBag(this.bag, nextUuid);
      this.reservedNextUuid = null;
      await saveBag(this.bag, this.lastPlayedUuid);
      return { finished: false, nextStarted: false };
    }

    const durA = await this.getDuration(currentUuid, pathA);
    const durB = await this.getDuration(nextUuid, pathB);
    const fadeSec = getCrossfadeSec();

    if (this.shouldPlayMidsong()) {
      const midsongPath = pickMidsongPath(this.midsongConfig);
      if (midsongPath) {
        console.info(`[radio] Midsong: ${path.basename(midsongPath)}`);
        return this.streamPairViaMidsong(
          pathA,
          pathB,
          currentUuid,
          nextUuid,
          durA,
          durB,
          midsongPath,
        );
      }
    }

    const useCrossfade =
      getRadioTransition() === "crossfade" && this.ffmpegPath && fadeSec > 0;

    this.skipRequested = false;

    if (!useCrossfade) {
      await this.commitNext(currentUuid);
      await this.markPlayed(currentUuid);
      await this.setNowPlaying(currentUuid);
      await this.streamBroadcastFile(pathA);
      return { finished: !this.skipRequested, nextStarted: false };
    }

    const fade = this.computeFade(durA, durB, fadeSec);
    if (fade < 0.5) {
      await this.setNowPlaying(currentUuid);
      await this.streamBroadcastFile(pathA);
      return { finished: !this.skipRequested, nextStarted: false };
    }

    this.skipRequested = false;
    await this.setNowPlaying(currentUuid);

    const crossfadeAtMs = pairCrossfadeStartSec(durA, durB, fadeSec) * 1000;
    let crossfadeTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      crossfadeTimer = null;
      if (this.skipRequested) return;
      void this.commitNext(currentUuid);
      void this.commitNext(nextUuid);
      void this.markPlayed(nextUuid);
      void this.setNowPlaying(nextUuid, {
        atCrossfade: true,
        finishedPrevious: true,
      });
    }, crossfadeAtMs);

    try {
      await this.streamPairCrossfade(pathA, pathB, durA, durB, fade);
    } finally {
      if (crossfadeTimer) {
        clearTimeout(crossfadeTimer);
        crossfadeTimer = null;
        if (!this.skipRequested) {
          await this.commitNext(currentUuid);
          await this.commitNext(nextUuid);
          await this.markPlayed(nextUuid);
        }
      }
    }

    if (this.skipRequested) {
      return { finished: false, nextStarted: true };
    }

    return { finished: !this.skipRequested, nextStarted: true };
  }

  private async streamSolo(
    uuid: string,
    offsetSec = 0,
  ): Promise<boolean> {
    const filepath = await ensureBroadcastFile(uuid);
    if (!filepath) {
      this.bag = this.bag.filter((id) => id !== uuid);
      return false;
    }

    const track = await getTrack(uuid);
    const probed = (await probeDuration(filepath)) ?? 0;
    const meta = track?.duration ?? 0;
    if (this.isCorruptDuration(probed, meta)) {
      console.warn(`[radio] Poškozená skladba, přeskakuji: ${track?.title ?? uuid}`);
      this.bag = removeFromBag(this.bag, uuid);
      await saveBag(this.bag, this.lastPlayedUuid);
      return false;
    }

    this.skipRequested = false;
    await this.commitNext(uuid);
    await this.markPlayed(uuid);
    await this.setNowPlaying(uuid);

    if (offsetSec > 0.5 && this.ffmpegPath) {
      await this.streamFfmpeg([
        "-ss",
        String(offsetSec),
        "-i",
        filepath,
        ...mp3EncodeArgs(),
      ]);
    } else {
      await this.streamBroadcastFile(filepath);
    }

    return !this.skipRequested;
  }

  private async handleTransitionTest(
    currentUuid: string,
  ): Promise<{ currentUuid: string | null; ran: boolean }> {
    this.transitionTestRequested = false;
    this.skipRequested = false;

    const nextUuid =
      this.reservedNextUuid ?? (await this.peekNext(currentUuid));
    if (!nextUuid || nextUuid === currentUuid) {
      return { currentUuid, ran: false };
    }

    const result = await this.playTransitionTest(currentUuid, nextUuid);
    if (!result) {
      return { currentUuid, ran: false };
    }

    this.playResumeOffsetSec = result.resumeOffsetSec;
    return { currentUuid: result.nextUuid, ran: true };
  }

  private async runLoop(): Promise<void> {
    if (this.loopRunning) return;
    this.loopRunning = true;

    const state = await readRadioState();
    let currentUuid = state.nowPlaying?.uuid ?? (await this.peekNext());
    if (currentUuid && !state.nowPlaying?.uuid) {
      this.reservedNextUuid = currentUuid;
    }

    while (true) {
      if (this.transitionTestRequested && currentUuid) {
        const test = await this.handleTransitionTest(currentUuid);
        if (test.ran && test.currentUuid) {
          currentUuid = test.currentUuid;
          this.reservedNextUuid = await this.peekNext(currentUuid);
          const offset = this.playResumeOffsetSec;
          this.playResumeOffsetSec = 0;
          if (offset > 0.5) {
            const played = await this.streamSolo(currentUuid, offset);
            if (this.transitionTestRequested || this.midsongTestRequested) continue;
            if (this.skipRequested) {
              this.skipRequested = false;
              currentUuid = await this.peekNext();
              this.reservedNextUuid = currentUuid;
              continue;
            }
            if (played) {
              this.onTrackFinished();
              await this.maybePlayJingle();
              currentUuid = await this.peekNext();
              this.reservedNextUuid = currentUuid;
            }
          }
        } else {
          this.transitionTestRequested = false;
        }
        continue;
      }

      if (this.midsongTestRequested && currentUuid) {
        const test = await this.handleMidsongTest(currentUuid);
        if (test.ran && test.currentUuid) {
          currentUuid = test.currentUuid;
          this.reservedNextUuid = await this.peekNext(currentUuid);
          const offset = this.playResumeOffsetSec;
          this.playResumeOffsetSec = 0;
          if (offset > 0.5) {
            const played = await this.streamSolo(currentUuid, offset);
            if (this.midsongTestRequested) continue;
            if (this.skipRequested) {
              this.skipRequested = false;
              currentUuid = await this.peekNext();
              this.reservedNextUuid = currentUuid;
              continue;
            }
            if (played) {
              this.onTrackFinished();
              await this.maybePlayJingle();
              currentUuid = await this.peekNext();
              this.reservedNextUuid = currentUuid;
            }
          }
        } else {
          this.midsongTestRequested = false;
        }
        continue;
      }

      if (!currentUuid) {
        await sleep(3000);
        currentUuid = await this.peekNext();
        if (currentUuid) this.reservedNextUuid = currentUuid;
        continue;
      }

      const nextUuid = await this.peekNext(currentUuid);
      this.reservedNextUuid = nextUuid;

      if (!nextUuid || nextUuid === currentUuid) {
        const played = await this.streamSolo(currentUuid);
        if (this.transitionTestRequested || this.midsongTestRequested) continue;
        if (this.skipRequested) {
          this.skipRequested = false;
          currentUuid = await this.peekNext();
          this.reservedNextUuid = currentUuid;
          continue;
        }
        if (played) {
          this.onTrackFinished();
          await this.maybePlayJingle();
          currentUuid = await this.peekNext();
          this.reservedNextUuid = currentUuid;
        }
        continue;
      }

      const result = await this.streamPair(currentUuid, nextUuid);

      if (this.transitionTestRequested) {
        const test = await this.handleTransitionTest(currentUuid);
        if (test.ran && test.currentUuid) {
          currentUuid = test.currentUuid;
          this.reservedNextUuid = await this.peekNext(currentUuid);
          const offset = this.playResumeOffsetSec;
          this.playResumeOffsetSec = 0;
          if (offset > 0.5) {
            const played = await this.streamSolo(currentUuid, offset);
            if (this.transitionTestRequested || this.midsongTestRequested) continue;
            if (this.skipRequested) {
              this.skipRequested = false;
              currentUuid = await this.peekNext();
              this.reservedNextUuid = currentUuid;
              continue;
            }
            if (played) {
              this.onTrackFinished();
              await this.maybePlayJingle();
              currentUuid = await this.peekNext();
              this.reservedNextUuid = currentUuid;
            }
          }
        }
        continue;
      }

      if (this.midsongTestRequested) {
        const test = await this.handleMidsongTest(currentUuid);
        if (test.ran && test.currentUuid) {
          currentUuid = test.currentUuid;
          this.reservedNextUuid = await this.peekNext(currentUuid);
          const offset = this.playResumeOffsetSec;
          this.playResumeOffsetSec = 0;
          if (offset > 0.5) {
            const played = await this.streamSolo(currentUuid, offset);
            if (this.transitionTestRequested || this.midsongTestRequested) continue;
            if (this.skipRequested) {
              this.skipRequested = false;
              currentUuid = await this.peekNext();
              this.reservedNextUuid = currentUuid;
              continue;
            }
            if (played) {
              this.onTrackFinished();
              await this.maybePlayJingle();
              currentUuid = await this.peekNext();
              this.reservedNextUuid = currentUuid;
            }
          }
        }
        continue;
      }

      if (this.skipRequested) {
        this.skipRequested = false;
        if (!result.nextStarted) {
          await this.returnReserved(nextUuid);
        }
        currentUuid = await this.peekNext();
        this.reservedNextUuid = currentUuid;
        continue;
      }

      if (result.finished) {
        this.onTrackFinished();
        await this.maybePlayJingle();
      }

      if (result.finished && result.nextStarted) {
        // Unified crossfade už přehrál celou nextUuid — posunout na další ve frontě.
        currentUuid = await this.peekNext(nextUuid);
        this.reservedNextUuid = currentUuid
          ? await this.peekNext(currentUuid)
          : null;
      } else if (result.finished) {
        currentUuid = await this.peekNext();
        this.reservedNextUuid = currentUuid;
      }
    }
  }
}

let engineInstance: RadioEngine | null = null;

export function getRadioEngine(): RadioEngine {
  if (!engineInstance) {
    engineInstance = new RadioEngine();
  }
  return engineInstance;
}
