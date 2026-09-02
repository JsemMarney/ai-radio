import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildCrossfadeFromFilterGraph,
  buildHeadLinearFadeFilter,
  buildMidsongLiveTransitionFilterGraph,
  buildMidsongPreviewFilterGraph,
  buildPairCrossfadeFilterGraph,
  buildTailLinearFadeFilter,
  buildTransitionPreviewFilterGraph,
  getMidsongConfig,
  getMidsongPreviewTiming,
  getTransitionPreviewTiming,
  pickMidsongPath,
  probePlayableDuration,
  randomMidsongInterval,
  type MidsongConfig,
  type MidsongPreviewTiming,
} from "@/lib/audio-process";
import {
  computePairFade,
  pairCrossfadeStartSec,
} from "@/lib/fade-math";
import {
  getCrossfadeSec,
  getRadioTransition,
  mp3EncodeArgs,
  probeDuration,
  resolveFfmpeg,
} from "@/lib/ffmpeg";
import { getDownloadsDir, getTrack } from "@/lib/library";
import {
  areSongRequestsEnabled,
  enqueueListenerRequest,
  getListenerRequestQueue,
  getRequestableTracks,
  setListenerRequestQueue,
  validateListenerRequest,
} from "@/lib/song-requests";
import {
  ensureQueueDepth,
  loadBag,
  peekFromBag,
  prependToBag,
  QUEUE_TARGET_SIZE,
  QUEUE_DISPLAY_SIZE,
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
import { buildProgramSchedule, sliceScheduleForDisplay } from "@/lib/program-schedule";
import { StreamPacer } from "@/lib/stream-pacer";
import type {
  PlaybackSegment,
  ScheduledTrack,
} from "@/lib/types";

export type RadioStatus = {
  nowPlaying: RadioNowPlaying | null;
  trackStartedAt: string | null;
  recentlyPlayed: RadioNowPlaying[];
  listeners: number;
  broadcasting: boolean;
  queueRemaining: number;
  sessionId: string | null;
  upcoming: RadioNowPlaying[];
  schedule: ScheduledTrack[];
  nextUp: ScheduledTrack | null;
  segment: PlaybackSegment;
  crossfadeSec: number;
  /** Inkrementuje se při skipu / testu — klient obnoví MP3 dekodér. */
  streamEpoch: number;
  /** Zbývající přechody do další šance na midsong (sync s enginem). */
  songsUntilMidsong: number;
  /** Odhad délky midsong souboru (s). */
  midsongDurationSec: number;
  midsongConfigured: boolean;
  midsongMinTracks: number;
  midsongMaxTracks: number;
  requestsEnabled: boolean;
  requestsPending: number;
};

type BroadcastSink = (chunk: Uint8Array) => void;

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
  private sinks = new Set<BroadcastSink>();
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
  private midsongConfig: MidsongConfig = {
    paths: [],
    minTracks: 3,
    maxTracks: 6,
    chance: 1,
    fadeSec: 4,
  };
  private songsUntilMidsong = 0;
  private upcomingCache: RadioNowPlaying[] = [];
  private scheduleCache: ScheduledTrack[] = [];
  private currentSegment: PlaybackSegment = "song";
  private streamEpoch = 0;
  private midsongDurationSec = 6;
  private listenerRequests: string[] = [];

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
    const display = QUEUE_DISPLAY_SIZE;
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
      upcoming: this.upcomingCache.slice(0, display),
      schedule: sliceScheduleForDisplay(this.scheduleCache, display),
      nextUp: this.scheduleCache[0] ?? null,
      segment: this.currentSegment,
      crossfadeSec: getCrossfadeSec(),
      streamEpoch: this.streamEpoch,
      songsUntilMidsong: this.songsUntilMidsong,
      midsongDurationSec: this.midsongDurationSec,
      midsongConfigured: this.midsongConfig.paths.length > 0,
      midsongMinTracks: this.midsongConfig.minTracks,
      midsongMaxTracks: this.midsongConfig.maxTracks,
      requestsEnabled: areSongRequestsEnabled(),
      requestsPending: this.listenerRequests.length,
    };
  }

  private async refreshProgramCache(): Promise<void> {
    this.upcomingCache = await this.getUpcoming(QUEUE_TARGET_SIZE);
    const np = this.nowPlaying as (RadioNowPlaying & { durationSec?: number | null }) | null;
    const midsongConfigured = this.midsongConfig.paths.length > 0;
    this.scheduleCache = buildProgramSchedule({
      nowPlaying: np,
      trackStartedAt: this.trackStartedAt,
      upcoming: this.upcomingCache,
      crossfadeSec: getCrossfadeSec(),
      songsUntilMidsong: this.songsUntilMidsong,
      stingerEveryAvg:
        (this.midsongConfig.minTracks + this.midsongConfig.maxTracks) / 2,
      stingerSec: this.midsongDurationSec,
      showStingers: midsongConfigured,
      stingerLabel: "Midsong",
    });
  }

  private emitStatus(force = false): void {
    const trackKey = [
      this.nowPlaying?.uuid ?? "",
      this.recentlyPlayed.map((t) => t.uuid).join(","),
      this.upcomingCache.map((t) => t.uuid).join(","),
      this.currentSegment,
      String(this.songsUntilMidsong),
    ].join("|");

    if (!force && trackKey === this.lastSseTrackKey) return;
    this.lastSseTrackKey = trackKey;

    void this.refreshProgramCache().then(() => {
      this.onStatusChange?.(this.getStatus());
    });
  }

  private emitListeners(): void {
    this.onStatusChange?.(this.getStatus());
  }

  subscribe(): ReadableStream<Uint8Array> {
    const engine = this;
    let subscriber!: Subscriber;
    let flushPending: (() => void) | null = null;

    return new ReadableStream<Uint8Array>(
      {
      start(controller) {
        const pending: Uint8Array[] = [];

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
    },
    { highWaterMark: 256 },
    );
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

  async getRequestableTracks(search?: string, limit = 40) {
    const blocked = [
      this.nowPlaying?.uuid,
      ...this.getRecentUuids(),
      ...this.listenerRequests,
    ].filter(Boolean) as string[];
    return getRequestableTracks({ search, limit, excludeUuids: blocked });
  }

  async submitListenerRequest(
    uuid: string,
  ): Promise<{ ok: boolean; error?: string; position?: number }> {
    const blocked = [
      this.nowPlaying?.uuid,
      ...this.getRecentUuids(),
    ].filter(Boolean) as string[];
    const valid = await validateListenerRequest(uuid, blocked);
    if (!valid.ok) {
      return { ok: false, error: valid.error };
    }
    const position = await enqueueListenerRequest(uuid);
    this.listenerRequests = await getListenerRequestQueue();
    this.emitStatus(true);
    return { ok: true, position };
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
    this.listenerRequests = await getListenerRequestQueue();
    await this.refillBag();

    this.ffmpegPath = await resolveFfmpeg();
    this.midsongConfig = getMidsongConfig();
    this.songsUntilMidsong = randomMidsongInterval(this.midsongConfig);
    if (this.midsongConfig.paths.length) {
      const midPath = this.midsongConfig.paths[0]!;
      const probed = await probeDuration(midPath);
      if (probed && probed > 0) {
        this.midsongDurationSec = probed;
      }
    }
    this.started = true;
    if (this.nowPlaying?.uuid) {
      const enriched = await this.trackToNowPlaying(this.nowPlaying.uuid);
      if (enriched) this.nowPlaying = enriched;
    }
    await this.refreshProgramCache();
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
    this.streamEpoch += 1;
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
    this.emitStatus(true);
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

  /** Fronta + odhad startů pro UI (zobrazí max displayLimit skladeb). */
  async getQueuePreview(limit = QUEUE_DISPLAY_SIZE) {
    await this.refreshProgramCache();
    const displayLimit = Math.min(Math.max(1, limit), QUEUE_DISPLAY_SIZE);
    return {
      upcoming: this.upcomingCache.slice(0, displayLimit),
      schedule: sliceScheduleForDisplay(this.scheduleCache, displayLimit),
      nextUp: this.scheduleCache[0] ?? null,
      queueRemaining: this.queueRemaining,
      reserved: this.reservedNextUuid,
    };
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

  /** Stinger (midsong) náhodně každých min–max skladeb — rozhodnutí až na konci skladby. */
  private shouldPlayMidsong(): boolean {
    this.midsongConfig = getMidsongConfig();
    if (!this.midsongConfig.paths.length) {
      return false;
    }
    if (!this.ffmpegPath) {
      console.warn("[radio] Midsong vypnuto — chybí ffmpeg.");
      return false;
    }
    this.songsUntilMidsong -= 1;
    if (this.songsUntilMidsong > 0) {
      return false;
    }
    this.songsUntilMidsong = randomMidsongInterval(this.midsongConfig);
    if (Math.random() > this.midsongConfig.chance) {
      console.info("[radio] Midsong přeskočen (náhoda).");
      return false;
    }
    return true;
  }

  private async streamMidsongTransition(
    pathA: string,
    pathB: string,
    currentUuid: string,
    nextUuid: string,
    durA: number,
    startA: number,
    midsongPath: string,
  ): Promise<{ finished: boolean; nextStarted: boolean }> {
    const fadeSec = this.midsongConfig.fadeSec;
    const midDur =
      (this.ffmpegPath
        ? await probePlayableDuration(midsongPath, this.ffmpegPath)
        : null) ??
      (await probeDuration(midsongPath)) ??
      6;
    const tailA = Math.max(0.1, durA - startA);

    this.currentSegment = "stinger";
    this.emitStatus(true);

    const filter = buildMidsongLiveTransitionFilterGraph(
      startA,
      durA,
      midDur,
      fadeSec,
    );

    const stingerDelayMs = Math.max(0, (tailA - fadeSec) * 1000);
    let stingerTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      stingerTimer = null;
      if (this.skipRequested) return;
      void this.commitNext(currentUuid);
      void this.markPlayed(currentUuid);
    }, stingerDelayMs);

    const nextDelayMs = Math.max(0, (tailA + midDur) * 1000);
    let nextTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      nextTimer = null;
      if (this.skipRequested) return;
      void this.commitNext(nextUuid);
      void this.markPlayed(nextUuid);
      void this.setNowPlaying(nextUuid, { finishedPrevious: true });
      this.currentSegment = "song";
      this.emitStatus(true);
    }, nextDelayMs);

    let ok = false;
    try {
      ok = await this.streamFfmpeg([
        "-i",
        pathA,
        "-i",
        midsongPath,
        "-i",
        pathB,
        "-filter_complex",
        filter,
        ...mp3EncodeArgs("[aout]"),
      ]);
    } finally {
      if (stingerTimer) clearTimeout(stingerTimer);
      if (nextTimer) clearTimeout(nextTimer);
      if (!this.skipRequested) {
        await this.commitNext(currentUuid);
        await this.commitNext(nextUuid);
        await this.markPlayed(nextUuid);
      }
    }

    if (!ok && !this.skipRequested) {
      console.warn("[radio] Midsong ffmpeg selhal — fallback na crossfade/cut.");
    }

    this.currentSegment = "song";
    this.emitStatus(true);

    if (this.skipRequested) {
      return { finished: false, nextStarted: true };
    }

    return { finished: ok, nextStarted: ok };
  }

  private async streamCrossfadeFrom(
    pathA: string,
    pathB: string,
    currentUuid: string,
    nextUuid: string,
    durA: number,
    durB: number,
    startA: number,
    fadeSec: number,
  ): Promise<{ finished: boolean; nextStarted: boolean }> {
    this.currentSegment = "crossfade";
    void this.commitNext(currentUuid);
    void this.commitNext(nextUuid);
    void this.markPlayed(nextUuid);
    void this.setNowPlaying(nextUuid, {
      atCrossfade: true,
      finishedPrevious: true,
    });
    this.emitStatus(true);

    const filter = buildCrossfadeFromFilterGraph(startA, durA, durB, fadeSec);
    const ok = await this.streamFfmpeg([
      "-i",
      pathA,
      "-i",
      pathB,
      "-filter_complex",
      filter,
      ...mp3EncodeArgs("[aout]"),
    ]);

    this.currentSegment = "song";

    if (this.skipRequested) {
      return { finished: false, nextStarted: true };
    }

    return { finished: ok, nextStarted: ok };
  }

  private broadcast(chunk: Buffer): void {
    const data = new Uint8Array(chunk);
    for (const sub of this.subscribers) {
      sub.enqueue(data);
    }
    for (const sink of this.sinks) {
      try {
        sink(data);
      } catch {
        // rozbitý sink (např. zavřený Icecast pipe)
      }
    }
  }

  /** Trvalý výstup (Icecast source) — nepočítá se jako HTTP posluchač. */
  attachSink(sink: BroadcastSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
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

    if (this.listenerRequests.length) {
      const uuid = this.listenerRequests.shift()!;
      await setListenerRequestQueue(this.listenerRequests);
      return uuid;
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

  /** Přednačti další skladbu na disk, ať mezi přechody není pauza. */
  private prefetchBroadcast(uuid: string | null): void {
    if (!uuid) return;
    void ensureBroadcastFile(uuid).catch(() => {});
  }

  private ffmpegBaseArgs(): string[] {
    return [
      "-hide_banner",
      "-nostats",
      "-loglevel",
      "error",
      "-probesize",
      "32k",
      "-analyzeduration",
      "0",
    ];
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
      const stream = createReadStream(filepath, { highWaterMark: 256 * 1024 });
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

  private async streamFfmpeg(args: string[]): Promise<boolean> {
    if (!this.ffmpegPath) return false;
    this.skipRequested = false;
    const pacer = this.getPacer();

    return new Promise<boolean>((resolve) => {
      const proc = spawn(this.ffmpegPath!, [...this.ffmpegBaseArgs(), ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.currentProc = proc;

      let stderr = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });

      proc.stdout?.on("data", (chunk: Buffer) => {
        if (this.skipRequested) {
          proc.kill("SIGTERM");
          return;
        }
        pacer.enqueue(chunk);
      });

      proc.on("close", (code) => {
        this.currentProc = null;
        if (code !== 0 && code !== null && !this.skipRequested) {
          console.error(
            `[radio] ffmpeg ukončen s kódem ${code}: ${stderr.trim().slice(-800)}`,
          );
        }
        void pacer.flush().then(() => resolve(code === 0 || code === null));
      });
      proc.on("error", (err) => {
        this.currentProc = null;
        console.error("[radio] ffmpeg selhal:", err.message);
        pacer.abortSegment();
        resolve(false);
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

    const [pathA, pathB] = await Promise.all([
      ensureBroadcastFile(currentUuid),
      ensureBroadcastFile(nextUuid),
    ]);
    this.prefetchBroadcast(await this.peekNext(nextUuid));
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
    const useCrossfade =
      getRadioTransition() === "crossfade" && this.ffmpegPath && fadeSec > 0;
    const fade = useCrossfade ? this.computeFade(durA, durB, fadeSec) : 0;
    const transitionAt =
      useCrossfade && fade >= 0.5
        ? pairCrossfadeStartSec(durA, durB, fadeSec)
        : Math.max(0, durA - fadeSec);

    this.skipRequested = false;
    this.currentSegment = "song";
    await this.setNowPlaying(currentUuid);

    if (transitionAt > 0.25) {
      await this.streamBody(pathA, 0, transitionAt);
    } else {
      await this.streamBroadcastFile(pathA);
    }

    if (this.skipRequested) {
      return { finished: false, nextStarted: false };
    }

    const playMidsong = this.shouldPlayMidsong();
    this.emitStatus(true);
    const midsongPath = playMidsong
      ? pickMidsongPath(this.midsongConfig)
      : null;

    if (midsongPath) {
      console.info(`[radio] Midsong: ${path.basename(midsongPath)}`);
      const result = await this.streamMidsongTransition(
        pathA,
        pathB,
        currentUuid,
        nextUuid,
        durA,
        transitionAt,
        midsongPath,
      );
      if (result.finished || this.skipRequested) {
        return result;
      }
      console.warn("[radio] Midsong selhal — pokračuji crossfade/cut.");
    }

    if (useCrossfade && fade >= 0.5) {
      return this.streamCrossfadeFrom(
        pathA,
        pathB,
        currentUuid,
        nextUuid,
        durA,
        durB,
        transitionAt,
        fadeSec,
      );
    }

    await this.commitNext(currentUuid);
    await this.markPlayed(currentUuid);
    await this.setNowPlaying(nextUuid, { finishedPrevious: true });
    await this.streamBroadcastFile(pathB);
    return { finished: !this.skipRequested, nextStarted: true };
  }

  private async streamSolo(
    uuid: string,
    offsetSec = 0,
  ): Promise<boolean> {
    this.prefetchBroadcast(await this.peekNext(uuid));

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
      this.prefetchBroadcast(nextUuid);

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
