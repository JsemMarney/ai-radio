import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildTransitionPreviewFilterGraph,
  getMidsongConfig,
  getTransitionPreviewTiming,
  pickMidsongPath,
  probePlayableDuration,
  randomMidsongInterval,
  type MidsongConfig,
} from "@/lib/audio-process";
import {
  getCrossfadeSec,
  getRadioTransition,
  getStreamBitrate,
  mp3EncodeArgs,
  probeDuration,
  resolveFfmpeg,
} from "@/lib/ffmpeg";
import { getDownloadsDir, getTrack, listTracks, trackMatchKey } from "@/lib/library";
import {
  getMixAnalysis,
  loudnessGain,
  planTransition,
  type MixAnalysis,
} from "@/lib/mix-analysis";
import { MicInput } from "@/lib/mic-input";
import { cleanupVoiceNotes, saveVoiceNote, voiceNotePath } from "@/lib/voice-notes";
import { listBedOptions, resolveBedPath, type BedOption } from "@/lib/talk-bed";
import { PcmDeck, SAMPLE_RATE } from "@/lib/pcm-deck";
import {
  buildProgramSchedule,
  sliceScheduleForDisplay,
} from "@/lib/program-schedule";
import {
  fillRotationQueue,
  getCatalog,
  QUEUE_DISPLAY_SIZE,
  QUEUE_TARGET_SIZE,
  type CatalogEntry,
} from "@/lib/radio-playlist";
import {
  setBroadcasting,
  updateNowPlaying,
  writeRotationState,
  type BrokenTrackInfo,
  type RadioNowPlaying,
  type TrackPlayStats,
} from "@/lib/radio-state";
import { ensureBroadcastFile } from "@/lib/remaster";
import { censor, cleanInput, containsLink } from "@/lib/profanity";
import {
  areSongRequestsEnabled,
  getMaxRequestQueue,
  getRequestableTracks,
  isRequestModerationEnabled,
} from "@/lib/song-requests";
import {
  getAacBitrateKbps,
  isAacEnabled,
  StreamEncoder,
  type StreamFormat,
} from "@/lib/stream-encoder";
import type {
  BreakState,
  DuplicateTrack,
  LibraryStats,
  LibraryStatsRow,
  ListenerRequest,
  PlaybackSegment,
  RequestStatus,
  RequestStatusView,
  QueueItemSource,
  ScheduledTrack,
  StudioQueueItem,
} from "@/lib/types";

const execFileAsync = promisify(execFile);

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
  /** Stream je jeden souvislý proud — klient nemusí nic obnovovat. */
  streamEpoch: number;
  songsUntilMidsong: number;
  midsongDurationSec: number;
  midsongConfigured: boolean;
  midsongMinTracks: number;
  midsongMaxTracks: number;
  requestsEnabled: boolean;
  requestsPending: number;
  formats: { mp3: number; aac: number | null };
  /** Moderátor je ve vysílání s mikrofonem. */
  micLive: boolean;
  /** Přání čekající na schválení moderátorem. */
  moderationPending: number;
  /** Pauza na mluvené slovo. */
  breakState: BreakState;
  /** Jméno moderátora pro posluchače. */
  moderator: string | null;
  bed: string;
  bedLevelDb: number;
};

type BroadcastSink = (chunk: Uint8Array) => void;

type Subscriber = {
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
};

type Output = {
  encoder: StreamEncoder;
  subscribers: Set<Subscriber>;
  burst: Buffer[];
  burstBytes: number;
  bytesPerSec: number;
};

type TrackSource = "rotation" | "request" | "studio";

type PreparedStinger = {
  path: string;
  durationSec: number;
  deck: PcmDeck;
  gain: number;
};

type PreparedTrack = {
  uuid: string;
  meta: RadioNowPlaying;
  path: string;
  durationSec: number;
  offsetSec: number;
  deck: PcmDeck;
  source: TrackSource;
  stinger: PreparedStinger | null;
  analysis: MixAnalysis | null;
  gain: number;
};

type Voice = {
  kind: "track" | "stinger" | "bed";
  uuid: string | null;
  meta: RadioNowPlaying | null;
  path: string;
  durationSec: number;
  deck: PcmDeck;
  analysis: MixAnalysis | null;
  gain: number;
  /** Mixer frame, kterému odpovídá čas 0 v souboru. */
  startFrame: number;
  endFrame: number;
  fadeInStart: number;
  fadeInFrames: number;
  fadeOutStart: number | null;
  fadeOutFrames: number;
  /** Záložní jingle — ustoupí, jakmile je připravená skladba. */
  filler?: boolean;
};

/** Mixer krok — ~23 ms. */
const BLOCK_FRAMES = 1024;
/** O kolik je mixer napřed před reálným časem (rezerva na jitter timeru). */
const LEAD_SEC = 0.2;
const HISTORY_LIMIT = 500;
const REQUEST_COOLDOWN = 8;
const MAX_PENDING_REQUESTS = 30;
const REQUEST_LOG_LIMIT = 200;
const PENDING_REQUEST_TTL_MS = 30 * 60 * 1000;
const STINGER_TAIL_SEC = 0.15;
const SKIP_FADE_SEC = 0.8;
/** Hlas nad touto úrovní (RMS) ztlumí hudbu. ~ -42 dBFS */
const VAD_THRESHOLD = 0.008;
/** Jak dlouho po posledním slovu držet hudbu ztlumenou. */
const DUCK_HOLD_SEC = 1.2;
const DUCK_ATTACK_SEC = 0.15;
const DUCK_RELEASE_SEC = 0.9;

/** Po kolika sekundách ticha pustit záložní jingle. */
const FALLBACK_AFTER_SEC = 3;

function getBurstSec(): number {
  const raw = Number(process.env.RADIO_BURST_SEC ?? 2.5);
  return Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 10) : 2.5;
}

/** Co hrát, když není co hrát (prázdná fronta, chyba přípravy). */
function getFallbackPaths(midsongPaths: string[]): string[] {
  const raw = process.env.RADIO_FALLBACK_PATH?.trim();
  const out: string[] = [];
  if (raw) {
    for (const part of raw.split(",")) {
      const p = part.trim();
      if (!p) continue;
      const resolved = existsSync(p) ? path.resolve(p) : path.join(process.cwd(), p);
      if (existsSync(resolved)) out.push(resolved);
    }
    return out;
  }
  const station = path.join(process.cwd(), "public", "jingle.mp3");
  if (existsSync(station)) out.push(station);
  return out.length ? out : midsongPaths;
}

const secToFrames = (sec: number) => Math.max(0, Math.round(sec * SAMPLE_RATE));

function toPublic(entry: CatalogEntry, requested = false): RadioNowPlaying {
  return {
    uuid: entry.uuid,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    year: entry.year,
    thumbnail: entry.thumbnail,
    durationSec: entry.durationSec,
    ...(requested ? { requested: true } : {}),
  };
}

/**
 * Rádiový engine postavený jako vysílací pult:
 *
 *   dekodéry (PcmDeck) → mixer (chytrý crossfade / jingle / skip fade, gain) → enkodéry (MP3, AAC) → posluchači
 *
 * Mixer běží na hodinách podle počtu vzorků, takže tempo je přesné a stream je
 * jeden souvislý proud bez mezer mezi skladbami.
 */
export class RadioEngine {
  private outputs = new Map<StreamFormat, Output>();
  private sinks = new Set<BroadcastSink>();
  private ffmpegPath: string | null = null;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private clockStart = 0;
  private frame = 0;
  private started = false;

  private main: Voice | null = null;
  private tails: Voice[] = [];
  private next: PreparedTrack | null = null;
  private preparing: Promise<void> | null = null;
  private preparingUuid: string | null = null;
  private nextFadeInSec = 0.02;
  private silentSince = 0;
  private fallbackPaths: string[] = [];

  private queue: string[] = [];
  private requests: string[] = [];
  private history: string[] = [];
  private lastPlayedUuid: string | null = null;
  private playStats: Record<string, TrackPlayStats> = {};
  private requestLog: ListenerRequest[] = [];

  // Pauza na mluvené slovo + podkres
  private breakState: BreakState = "none";
  private breakNow = false;
  private breakResume = false;
  private bedChoice = "builtin";
  private bedLevelDb = -10;
  private bedPrepared: PreparedStinger | null = null;
  private bedPreparing = false;
  private brokenInfo: Record<string, BrokenTrackInfo> = {};
  /** Skladby, které nejde přehrát — rotace je přeskočí až do restartu. */
  private broken = new Set<string>();

  private announceTimers = new Set<ReturnType<typeof setTimeout>>();
  private mixedSegment: PlaybackSegment = "song";

  // Mikrofon moderátora + ducking hudby
  private mic: MicInput | null = null;
  private duckGain = 1;
  private duckHoldUntil = 0;
  private duckLevel = Math.pow(10, -14 / 20);
  private micGain = 1;
  private micMixedLive = false;
  private micLive = false;
  private voiceClip: PcmDeck | null = null;
  private moderator: string | null = null;

  private durationCache = new Map<string, number>();
  private midsongConfig: MidsongConfig = {
    paths: [],
    minTracks: 3,
    maxTracks: 6,
    chance: 1,
    fadeSec: 4,
  };
  private midsongCountdown = 0;
  private midsongDurationSec = 6;

  private upcomingCache: RadioNowPlaying[] = [];
  private scheduleCache: ScheduledTrack[] = [];
  private currentSegment: PlaybackSegment = "song";
  private lastStatusKey = "";

  nowPlaying: RadioNowPlaying | null = null;
  trackStartedAt: string | null = null;
  recentlyPlayed: RadioNowPlaying[] = [];
  sessionId: string | null = null;

  onStatusChange: ((status: RadioStatus) => void) | null = null;

  get listenerCount(): number {
    let n = 0;
    for (const out of this.outputs.values()) n += out.subscribers.size;
    return n;
  }

  // ───────────────────────── status ─────────────────────────

  private upcomingIds(): string[] {
    const ids: string[] = [];
    const push = (id: string | null | undefined) => {
      if (id && !ids.includes(id)) ids.push(id);
    };
    push(this.next?.uuid ?? this.preparingUuid);
    for (const id of this.requests) push(id);
    for (const id of this.queue) push(id);
    return ids;
  }

  get queueRemaining(): number {
    return this.upcomingIds().length;
  }

  /** Stejná sémantika jako buildProgramSchedule: 1 = stinger před další skladbou. */
  private get songsUntilMidsong(): number {
    if (this.next) return this.next.stinger ? 1 : this.midsongCountdown + 1;
    return Math.max(1, this.midsongCountdown);
  }

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
      upcoming: this.upcomingCache.slice(0, QUEUE_DISPLAY_SIZE),
      schedule: sliceScheduleForDisplay(this.scheduleCache, QUEUE_DISPLAY_SIZE),
      nextUp: this.scheduleCache[0] ?? null,
      segment: this.currentSegment,
      crossfadeSec: getCrossfadeSec(),
      streamEpoch: 0,
      songsUntilMidsong: this.songsUntilMidsong,
      midsongDurationSec: this.midsongDurationSec,
      midsongConfigured: this.midsongConfig.paths.length > 0,
      midsongMinTracks: this.midsongConfig.minTracks,
      midsongMaxTracks: this.midsongConfig.maxTracks,
      requestsEnabled: areSongRequestsEnabled(),
      requestsPending: this.requests.length,
      micLive: this.micLive,
      moderationPending: this.pendingRequests.length,
      breakState: this.breakState,
      moderator: this.moderator,
      bed: this.bedChoice,
      bedLevelDb: this.bedLevelDb,
      formats: {
        mp3: Math.floor(getStreamBitrate() / 1000),
        aac: this.outputs.has("aac") ? getAacBitrateKbps() : null,
      },
    };
  }

  private async refreshProgramCache(): Promise<void> {
    const catalog = await getCatalog();
    const requested = new Set(this.requests);
    this.upcomingCache = this.upcomingIds()
      .map((id) => {
        const entry = catalog.get(id);
        if (!entry) return null;
        const isRequest =
          requested.has(id) ||
          (this.next?.uuid === id && this.next.source === "request");
        const pub = toPublic(entry, isRequest);
        if (this.next?.uuid === id) pub.durationSec = this.next.durationSec;
        return pub;
      })
      .filter((t): t is RadioNowPlaying => t !== null);

    this.scheduleCache = buildProgramSchedule({
      nowPlaying: this.nowPlaying,
      trackStartedAt: this.trackStartedAt,
      upcoming: this.upcomingCache,
      crossfadeSec: getCrossfadeSec(),
      songsUntilMidsong: this.songsUntilMidsong,
      stingerEveryAvg:
        (this.midsongConfig.minTracks + this.midsongConfig.maxTracks) / 2,
      stingerSec: this.midsongDurationSec,
      showStingers: this.midsongConfig.paths.length > 0,
      stingerLabel: "Jingle",
    });
  }

  private emitStatus(force = false): void {
    const key = [
      this.nowPlaying?.uuid ?? "",
      this.trackStartedAt ?? "",
      this.upcomingIds().join(","),
      this.currentSegment,
      String(this.songsUntilMidsong),
      String(this.micLive),
      String(this.pendingRequests.length),
      this.breakState,
    ].join("|");
    if (!force && key === this.lastStatusKey) return;
    this.lastStatusKey = key;

    void this.refreshProgramCache()
      .catch(() => {})
      .then(() => this.onStatusChange?.(this.getStatus()));
  }

  private emitListeners(): void {
    this.onStatusChange?.(this.getStatus());
  }

  /**
   * Posluchači slyší mixer se zpožděním (burst + buffer přehrávače),
   * takže změny "právě hraje" posíláme o stejnou dobu později.
   */
  private announce(fn: () => void | Promise<void>): void {
    const delay = getBurstSec() * 1000 + LEAD_SEC * 1000 + 300;
    const timer = setTimeout(() => {
      this.announceTimers.delete(timer);
      void Promise.resolve(fn()).catch((err: unknown) =>
        console.warn("[radio] announce selhal:", err),
      );
    }, delay);
    this.announceTimers.add(timer);
  }

  getIcyTitle(): string {
    if (!this.nowPlaying) return "";
    return `${this.nowPlaying.artist} - ${this.nowPlaying.title}`;
  }

  // ───────────────────────── posluchači ─────────────────────────

  hasFormat(format: StreamFormat): boolean {
    return this.outputs.has(format);
  }

  subscribe(format: StreamFormat = "mp3"): ReadableStream<Uint8Array> {
    const out = this.outputs.get(format) ?? this.outputs.get("mp3");
    let subscriber!: Subscriber;

    return new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          let closed = false;
          subscriber = {
            enqueue: (chunk) => {
              if (closed) return;
              // Pomalý klient (desítky sekund pozadu) — odpojit, ať nežere paměť.
              if (controller.desiredSize !== null && controller.desiredSize < -1500) {
                this.unsubscribe(subscriber);
                return;
              }
              try {
                controller.enqueue(chunk);
              } catch {
                this.unsubscribe(subscriber);
              }
            },
            close: () => {
              if (closed) return;
              closed = true;
              try {
                controller.close();
              } catch {
                // already closed
              }
            },
          };
          if (!out) {
            subscriber.close();
            return;
          }
          // Burst-on-connect: pár sekund z bufferu → přehrávání startuje hned.
          for (const chunk of out.burst) {
            controller.enqueue(new Uint8Array(chunk));
          }
          out.subscribers.add(subscriber);
          this.emitListeners();
        },
        cancel: () => {
          this.unsubscribe(subscriber);
        },
      },
      { highWaterMark: 64 },
    );
  }

  private unsubscribe(subscriber: Subscriber): void {
    subscriber.close();
    for (const out of this.outputs.values()) {
      if (out.subscribers.delete(subscriber)) this.emitListeners();
    }
  }

  /** Trvalý výstup (Icecast source, MP3) — nepočítá se jako HTTP posluchač. */
  attachSink(sink: BroadcastSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  private onEncodedFrames(format: StreamFormat, frames: Buffer): void {
    const out = this.outputs.get(format);
    if (!out) return;
    const data = new Uint8Array(frames);
    for (const sub of out.subscribers) sub.enqueue(data);
    if (format === "mp3") {
      for (const sink of this.sinks) {
        try {
          sink(data);
        } catch {
          // rozbitý sink (např. zavřený Icecast pipe)
        }
      }
    }

    const limit = Math.floor(out.bytesPerSec * getBurstSec());
    out.burst.push(Buffer.from(frames));
    out.burstBytes += frames.length;
    while (out.burst.length > 1 && out.burstBytes - out.burst[0]!.length >= limit) {
      out.burstBytes -= out.burst.shift()!.length;
    }
  }

  private startOutput(format: StreamFormat): void {
    const encoder = new StreamEncoder(
      this.ffmpegPath!,
      (frames) => this.onEncodedFrames(format, frames),
      format,
    );
    this.outputs.set(format, {
      encoder,
      subscribers: new Set(),
      burst: [],
      burstBytes: 0,
      bytesPerSec: (encoder.bitrateKbps * 1000) / 8,
    });
    encoder.start();
  }

  // ───────────────────────── start / stop ─────────────────────────

  async start(): Promise<void> {
    this.ffmpegPath = await resolveFfmpeg();
    if (!this.ffmpegPath) {
      throw new Error("ffmpeg nenalezen — rádio bez něj nemůže vysílat.");
    }

    const boot = await setBroadcasting(true);
    this.sessionId = boot.sessionId;
    this.nowPlaying = boot.nowPlaying;
    this.trackStartedAt = boot.trackStartedAt;
    this.recentlyPlayed = boot.recentlyPlayed ?? [];
    this.lastPlayedUuid = boot.lastPlayedUuid ?? null;
    this.playStats = boot.playStats ?? {};
    this.brokenInfo = boot.brokenTracks ?? {};
    this.requestLog = boot.requestLog ?? [];
    this.moderator = boot.moderator ?? null;
    void cleanupVoiceNotes().catch(() => {});

    const catalog = await getCatalog();
    this.requests = (boot.listenerRequests ?? []).filter((id) => catalog.has(id));
    this.history = (
      boot.rotationHistory?.length
        ? boot.rotationHistory
        : this.recentlyPlayed.map((t) => t.uuid)
    ).slice(0, HISTORY_LIMIT);
    // Frontu plánujeme vždy znovu — uložená může být ze starší relace a
    // nevěděla by, co hrálo mezitím (rozestupy interpretů).
    this.queue = [];

    this.midsongConfig = getMidsongConfig();
    this.midsongCountdown = randomMidsongInterval(this.midsongConfig);
    const firstMidsong = this.midsongConfig.paths[0];
    if (firstMidsong) {
      const a = await getMixAnalysis(this.ffmpegPath, firstMidsong);
      this.midsongDurationSec = a?.playEnd || 6;
    }
    this.fallbackPaths = getFallbackPaths(this.midsongConfig.paths);

    this.startOutput("mp3");
    if (isAacEnabled()) this.startOutput("aac");
    this.started = true;
    this.startPump();

    // Navázat tam, kde rádio skončilo (když restart přišel uprostřed skladby).
    const resumed = await this.tryResume(boot.nowPlaying?.uuid, boot.trackStartedAt);
    if (!resumed) this.nowPlaying = null;

    await this.refillQueue();
    void this.prepareNext();
    this.emitStatus(true);
  }

  private async tryResume(
    uuid: string | undefined,
    startedAt: string | null,
  ): Promise<boolean> {
    if (!uuid || !startedAt) return false;
    const startedMs = Date.parse(startedAt);
    if (!Number.isFinite(startedMs)) return false;
    const elapsed = (Date.now() - startedMs) / 1000;
    if (elapsed < 0 || elapsed > 30 * 60) return false;

    const prepared = await this.prepareTrack(uuid, "rotation", elapsed);
    if (!prepared) return false;
    if (elapsed > prepared.durationSec - 20) {
      this.disposePrepared(prepared);
      return false;
    }
    this.next = prepared;
    this.nextFadeInSec = 1.5;
    return true;
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
    for (const t of this.announceTimers) clearTimeout(t);
    this.announceTimers.clear();
    for (const out of this.outputs.values()) out.encoder.stop();
    this.outputs.clear();
    for (const v of [this.main, ...this.tails]) v?.deck.dispose();
    this.main = null;
    this.tails = [];
    if (this.next) this.disposePrepared(this.next);
    this.next = null;
    await setBroadcasting(false);
    this.emitStatus(true);
  }

  // ───────────────────────── mixer ─────────────────────────

  private startPump(): void {
    this.clockStart = performance.now();
    this.frame = 0;
    this.silentSince = 0;
    const lead = secToFrames(LEAD_SEC);

    this.pumpTimer = setInterval(() => {
      if (!this.started) return;
      const now = performance.now();
      let due =
        Math.floor(((now - this.clockStart) / 1000) * SAMPLE_RATE) +
        lead -
        this.frame;

      // Proces stál (uspání PC, GC) — nedohánět, jen přenastavit hodiny.
      if (due > SAMPLE_RATE * 2) {
        this.clockStart =
          now - ((this.frame - lead + BLOCK_FRAMES) / SAMPLE_RATE) * 1000;
        due = BLOCK_FRAMES;
      }

      while (due >= BLOCK_FRAMES) {
        this.mixBlock(BLOCK_FRAMES);
        due -= BLOCK_FRAMES;
      }
    }, 20);
  }

  private envelope(v: Voice, f: number): number {
    let g = 1;
    if (v.fadeInFrames > 0) {
      const x = (f - v.fadeInStart) / v.fadeInFrames;
      if (x < 1) g *= x <= 0 ? 0 : Math.sin((x * Math.PI) / 2);
    }
    if (v.fadeOutStart !== null) {
      const x = (f - v.fadeOutStart) / v.fadeOutFrames;
      if (x >= 1) return 0;
      if (x > 0) g *= Math.cos((x * Math.PI) / 2);
    }
    return g;
  }

  private mixBlock(n: number): void {
    const f0 = this.frame;
    this.runCues(f0);

    const acc = new Float32Array(n * 2);
    const voices = this.main ? [this.main, ...this.tails] : this.tails;
    for (const v of voices) {
      const pcm = v.deck.read(n);
      for (let i = 0; i < n; i++) {
        const g = this.envelope(v, f0 + i) * v.gain;
        if (g === 0) continue;
        acc[i * 2] += pcm[i * 2]! * g;
        acc[i * 2 + 1] += pcm[i * 2 + 1]! * g;
      }
    }

    this.mixMic(acc, n, f0);

    const out = new Int16Array(n * 2);
    for (let i = 0; i < acc.length; i++) {
      const s = acc[i]!;
      out[i] = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
    }
    this.frame += n;
    for (const o of this.outputs.values()) o.encoder.write(out);

    const fEnd = this.frame;
    this.tails = this.tails.filter((v) => {
      const faded =
        v.fadeOutStart !== null && fEnd >= v.fadeOutStart + v.fadeOutFrames;
      const done = faded || v.deck.ended || fEnd >= v.endFrame + SAMPLE_RATE;
      if (done) v.deck.dispose();
      return !done;
    });

    const segment: PlaybackSegment =
      this.main?.kind === "bed"
        ? "talk"
        : this.main?.kind === "stinger"
        ? "stinger"
        : this.tails.some((v) => v.kind === "track")
          ? "crossfade"
          : "song";
    if (segment !== this.mixedSegment) {
      this.mixedSegment = segment;
      this.announce(() => {
        this.currentSegment = segment;
        this.emitStatus();
      });
    }
  }

  /**
   * Přimíchá mikrofon a ztlumí pod ním hudbu, když moderátor mluví
   * (detekce hlasu s krátkým podržením, plynulý náběh i návrat).
   */
  private mixMic(acc: Float32Array, n: number, f0: number): void {
    const mic = this.mic?.active ? this.mic : null;
    const live = Boolean(mic);
    if (live !== this.micMixedLive) {
      this.micMixedLive = live;
      console.info(live ? "[radio] 🎙 Moderátor ve vysílání" : "[radio] Mikrofon vypnut");
      this.announce(() => {
        this.micLive = live;
        this.emitStatus(true);
      });
    }
    // Hlasovka posluchače puštěná do éteru — chová se jako druhý mikrofon.
    const clip = this.voiceClip;
    if (clip && clip.ended) {
      clip.dispose();
      this.voiceClip = null;
    }
    const clipPcm = this.voiceClip ? this.voiceClip.read(n) : null;

    if (!mic && !clipPcm && this.duckGain > 0.999) return;

    const voice = mic ? mic.read(n) : null;
    if (voice) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += voice[i]! * voice[i]!;
      if (Math.sqrt(sum / n) > VAD_THRESHOLD) {
        this.duckHoldUntil = f0 + n + secToFrames(DUCK_HOLD_SEC);
      }
    }
    if (clipPcm) this.duckHoldUntil = f0 + n + secToFrames(DUCK_HOLD_SEC);
    const target = (voice || clipPcm) && f0 < this.duckHoldUntil ? this.duckLevel : 1;
    const attack = 1 - Math.exp(-1 / (DUCK_ATTACK_SEC * SAMPLE_RATE));
    const release = 1 - Math.exp(-1 / (DUCK_RELEASE_SEC * SAMPLE_RATE));
    const micScale = 32767 * this.micGain;

    for (let i = 0; i < n; i++) {
      this.duckGain += (target - this.duckGain) * (target < this.duckGain ? attack : release);
      const v = (voice ? voice[i]! * micScale : 0) + (clipPcm ? clipPcm[i * 2]! : 0);
      acc[i * 2] = acc[i * 2]! * this.duckGain + v;
      acc[i * 2 + 1] = acc[i * 2 + 1]! * this.duckGain + v;
    }
  }

  /** Pustí hlasovku posluchače do éteru (přes hudbu, ta se ztlumí). */
  async playVoiceNote(requestId: string): Promise<{ ok: boolean; error?: string }> {
    const request = this.requestLog.find((r) => r.id === requestId);
    const file = request?.hasVoice ? voiceNotePath(requestId) : null;
    if (!file || !this.ffmpegPath) return { ok: false, error: "Hlasovka nenalezena." };
    const deck = new PcmDeck(this.ffmpegPath, file).start();
    await deck.waitReady();
    this.voiceClip?.dispose();
    this.voiceClip = deck;
    console.info(`[radio] Hlasovka do éteru: ${request!.from ?? "posluchač"} (${request!.title})`);
    return { ok: true };
  }

  stopVoiceNote(): void {
    this.voiceClip?.dispose();
    this.voiceClip = null;
  }

  /** Jméno moderátora, které vidí posluchači (prázdné = skrýt). */
  setModerator(name: unknown): { ok: boolean; error?: string } {
    const clean = cleanInput(name, 40);
    if (containsLink(clean)) return { ok: false, error: "Odkaz do jména nepatří." };
    this.moderator = censor(clean).text || null;
    void this.persistRotation();
    this.emitStatus(true);
    return { ok: true };
  }

  /** Nový mikrofon ze studia (starý se odpojí — vysílá vždy jen jeden). */
  attachMic(): MicInput {
    if (this.mic) this.mic.connected = false;
    this.mic = new MicInput();
    return this.mic;
  }

  detachMic(mic: MicInput): void {
    mic.connected = false;
    if (this.mic === mic) this.mic = null;
  }

  setMicSettings(settings: { duckDb?: unknown; micGainDb?: unknown }): void {
    const duck = Number(settings.duckDb);
    if (Number.isFinite(duck)) {
      this.duckLevel = duck <= -60 ? 0 : Math.pow(10, Math.min(0, Math.max(-60, duck)) / 20);
    }
    const gain = Number(settings.micGainDb);
    if (Number.isFinite(gain)) {
      this.micGain = Math.pow(10, Math.min(12, Math.max(-12, gain)) / 20);
    }
  }

  private fadeOut(v: Voice, startFrame: number, frames: number): void {
    if (v.fadeOutStart !== null) return;
    v.fadeOutStart = startFrame;
    v.fadeOutFrames = Math.max(1, frames);
  }

  private retireMain(f: number, fadeSec: number): void {
    const m = this.main;
    if (!m) return;
    this.fadeOut(m, f, secToFrames(fadeSec));
    this.tails.push(m);
    this.main = null;
    this.silentSince = f;
  }

  /** Podkres: smyčka s prolnutím, a po „Pokračovat“ návrat ke skladbě. */
  private runBedCues(m: Voice, f: number, remaining: number): void {
    const nxt = this.next;
    if (this.breakResume && nxt) {
      this.breakResume = false;
      this.breakState = "none";
      this.fadeOut(m, f, secToFrames(2));
      if (nxt.stinger) {
        nxt.stinger.deck.dispose();
        nxt.stinger = null;
      }
      console.info("[radio] ▶ Konec pauzy");
      this.startTrack(nxt, f, 0.4);
      this.emitStatus(true);
      return;
    }
    const loopFade = secToFrames(2.5);
    if ((remaining <= loopFade || m.deck.ended) && this.bedPrepared) {
      this.fadeOut(m, f, Math.max(secToFrames(0.3), Math.min(remaining, loopFade)));
      this.startBed(f, 2.5);
    } else if (m.deck.ended && !this.bedPrepared) {
      void this.prepareBed();
    }
  }

  private startBed(f: number, fadeInSec: number): void {
    const bed = this.bedPrepared!;
    this.bedPrepared = null;
    if (this.main) this.tails.push(this.main);
    this.main = {
      kind: "bed",
      uuid: null,
      meta: null,
      path: bed.path,
      durationSec: bed.durationSec,
      deck: bed.deck,
      analysis: null,
      gain: bed.gain,
      startFrame: f,
      endFrame: f + secToFrames(bed.durationSec),
      fadeInStart: f,
      fadeInFrames: secToFrames(fadeInSec),
      fadeOutStart: null,
      fadeOutFrames: 1,
    };
    // Další kolo smyčky připravit dopředu.
    void this.prepareBed();
  }

  private async prepareBed(): Promise<void> {
    if (this.bedPrepared || this.bedPreparing || !this.ffmpegPath) return;
    this.bedPreparing = true;
    try {
      const file = await resolveBedPath(this.bedChoice, this.ffmpegPath);
      if (!file) return;
      const analysis = await getMixAnalysis(this.ffmpegPath, file);
      const dur = analysis?.playEnd || ((await probeDuration(file)) ?? 0);
      if (dur < 5) return;
      const deck = new PcmDeck(this.ffmpegPath, file).start();
      await deck.waitReady();
      if (this.bedPrepared) {
        deck.dispose();
        return;
      }
      this.bedPrepared = {
        path: file,
        durationSec: dur,
        deck,
        gain: loudnessGain(analysis?.lufs) * Math.pow(10, this.bedLevelDb / 20),
      };
    } catch (err) {
      console.warn("[radio] Podkres nejde připravit:", err);
    } finally {
      this.bedPreparing = false;
    }
  }

  getBedOptions(): BedOption[] {
    return listBedOptions();
  }

  /**
   * Ovládání pauzy ze studia:
   *  arm    — pauza po této skladbě,  now — pauza hned,
   *  cancel — zrušit naplánovanou,     resume — konec pauzy, hraje další skladba.
   */
  async controlBreak(
    action: string,
    options: { bed?: unknown; bedLevelDb?: unknown } = {},
  ): Promise<{ ok: boolean; error?: string }> {
    if (typeof options.bed === "string" && options.bed && options.bed !== this.bedChoice) {
      this.bedChoice = options.bed.slice(0, 80);
      this.bedPrepared?.deck.dispose();
      this.bedPrepared = null;
    }
    const level = Number(options.bedLevelDb);
    if (Number.isFinite(level)) {
      const db = Math.min(0, Math.max(-30, level));
      const ratio = Math.pow(10, (db - this.bedLevelDb) / 20);
      this.bedLevelDb = db;
      // Hlasitost změnit i u právě hrajícího podkresu.
      if (this.main?.kind === "bed") this.main.gain *= ratio;
      if (this.bedPrepared) this.bedPrepared.gain *= ratio;
    }

    switch (action) {
      case "arm":
      case "now":
        if (this.breakState === "on") return { ok: true };
        this.breakState = "armed";
        this.breakNow = action === "now";
        await this.prepareBed();
        if (!this.bedPrepared) {
          this.breakState = "none";
          this.breakNow = false;
          return { ok: false, error: "Podkres se nepodařilo připravit (ffmpeg?)." };
        }
        break;
      case "cancel":
        if (this.breakState === "armed") {
          this.breakState = "none";
          this.breakNow = false;
        }
        break;
      case "resume":
        if (this.breakState !== "on") return { ok: false, error: "Pauza neběží." };
        this.breakResume = true;
        if (!this.next) void this.prepareNext();
        break;
      case "settings":
        break;
      default:
        return { ok: false, error: "Neznámá akce." };
    }
    this.emitStatus(true);
    return { ok: true };
  }

  /** Rozhodnutí o přechodech — volá se na začátku každého bloku. */
  private runCues(f: number): void {
    const nxt = this.next;
    const m = this.main;

    if (!m) {
      if (nxt) {
        this.startTrack(nxt, f, this.nextFadeInSec);
      } else if (f - this.silentSince > secToFrames(FALLBACK_AFTER_SEC)) {
        this.startFallback(f);
      }
      return;
    }

    const remaining = m.endFrame - f;
    const ended = m.deck.ended || remaining <= 0;

    if (m.kind === "bed") {
      this.runBedCues(m, f, remaining);
      return;
    }

    // Pauza po této skladbě (nebo hned): místo další skladby naběhne podkres.
    if (m.kind === "track" && this.breakState === "armed" && this.bedPrepared) {
      const fade = secToFrames(this.breakNow ? 1.5 : 3);
      if (this.breakNow || remaining <= fade || ended) {
        this.fadeOut(m, f, this.breakNow ? fade : Math.max(remaining, 1));
        this.startBed(f, this.breakNow ? 1.5 : 2.5);
        this.breakState = "on";
        this.breakNow = false;
        console.info("[radio] ⏸ Pauza — hraje podkres");
        this.emitStatus(true);
      }
      return;
    }

    if (!nxt) {
      // Nic připraveno (prázdná knihovna / chyba) — dohrát; pak záložní jingle.
      if (ended) this.retireMain(f, 0.05);
      return;
    }

    if (m.filler) {
      this.fadeOut(m, f, secToFrames(1));
      this.startTrack(nxt, f, 0.5);
      return;
    }

    if (m.kind === "stinger") {
      if (remaining <= secToFrames(STINGER_TAIL_SEC) || m.deck.ended) {
        this.startTrack(nxt, f, 0.02);
      }
      return;
    }

    if (nxt.stinger) {
      const fade = secToFrames(
        Math.min(this.midsongConfig.fadeSec, m.durationSec * 0.3),
      );
      if (remaining <= fade) this.fadeOut(m, f, Math.max(remaining, 1));
      if (remaining <= fade * 0.5 || ended) this.startStinger(nxt, f);
      return;
    }

    const plan =
      getRadioTransition() === "cut"
        ? { overlapSec: 0.05, fadeOutSec: 0.05, fadeInSec: 0.02, kind: "cut" }
        : planTransition(
            m.analysis,
            nxt.offsetSec > 0 ? null : nxt.analysis,
            m.durationSec,
            getCrossfadeSec(),
          );
    const overlap = secToFrames(plan.overlapSec);
    if (remaining <= overlap || ended) {
      const fadeFrames = secToFrames(plan.fadeOutSec);
      const fadeStart = Math.max(f, m.endFrame - fadeFrames);
      this.fadeOut(m, fadeStart, Math.max(secToFrames(0.05), m.endFrame - fadeStart));
      console.info(
        `[radio] Přechod ${plan.kind}: překryv ${plan.overlapSec.toFixed(1)} s, fade-in ${plan.fadeInSec.toFixed(2)} s`,
      );
      this.startTrack(nxt, f, plan.fadeInSec);
    }
  }

  private startStinger(item: PreparedTrack, f: number): void {
    const st = item.stinger!;
    item.stinger = null;
    if (this.main) {
      this.fadeOut(this.main, f, secToFrames(0.5));
      this.tails.push(this.main);
    }
    this.main = this.stingerVoice(st, f);
    console.info(`[radio] Jingle: ${path.basename(st.path)}`);
  }

  private stingerVoice(st: PreparedStinger, f: number): Voice {
    return {
      kind: "stinger",
      uuid: null,
      meta: null,
      path: st.path,
      durationSec: st.durationSec,
      deck: st.deck,
      analysis: null,
      gain: st.gain,
      startFrame: f,
      endFrame: f + secToFrames(st.durationSec),
      fadeInStart: f,
      fadeInFrames: secToFrames(0.02),
      fadeOutStart: null,
      fadeOutFrames: 1,
    };
  }

  /** Station ID místo ticha. Mixer pak hned naváže, jakmile je skladba připravená. */
  private startFallback(f: number): void {
    if (!this.ffmpegPath || !this.fallbackPaths.length) {
      this.silentSince = f;
      return;
    }
    const file =
      this.fallbackPaths[Math.floor(Math.random() * this.fallbackPaths.length)]!;
    const deck = new PcmDeck(this.ffmpegPath, file).start();
    // Délku neznáme synchronně — konec určí dekodér (deck.ended).
    this.main = {
      ...this.stingerVoice({ path: file, durationSec: 3600, deck, gain: 1 }, f),
      filler: true,
    };
    console.info(`[radio] Není co hrát — záložní jingle ${path.basename(file)}`);
    if (!this.preparing && !this.next) void this.prepareNext();
  }

  private startTrack(item: PreparedTrack, f: number, fadeInSec: number): void {
    this.next = null;
    this.nextFadeInSec = 0.02;
    if (item.stinger) {
      item.stinger.deck.dispose();
      item.stinger = null;
    }
    if (this.main) {
      // Stinger necháme dozvučet přirozeně, skladba už má fade nastavený.
      this.tails.push(this.main);
    }

    const startFrame = f - secToFrames(item.offsetSec);
    this.main = {
      kind: "track",
      uuid: item.uuid,
      meta: item.meta,
      path: item.path,
      durationSec: item.durationSec,
      deck: item.deck,
      analysis: item.analysis,
      gain: item.gain,
      startFrame,
      endFrame: startFrame + secToFrames(item.durationSec),
      fadeInStart: f,
      fadeInFrames: secToFrames(fadeInSec),
      fadeOutStart: null,
      fadeOutFrames: 1,
    };
    this.onTrackStarted(item);
  }

  private onTrackStarted(item: PreparedTrack): void {
    if (this.history[0] !== item.uuid) {
      this.history.unshift(item.uuid);
      if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    }
    this.lastPlayedUuid = item.uuid;
    if (item.offsetSec === 0) {
      const prev = this.playStats[item.uuid];
      this.playStats[item.uuid] = {
        plays: (prev?.plays ?? 0) + 1,
        lastPlayedAt: new Date().toISOString(),
      };
    }
    delete this.brokenInfo[item.uuid];
    console.info(
      `[radio] ▶ ${item.meta.artist} — ${item.meta.title}` +
        (item.source !== "rotation" ? ` (${item.source})` : ""),
    );

    // Schválené přání → věnování, které moderátor přečte a posluchači uvidí.
    let dedication: RadioNowPlaying["dedication"];
    if (item.source === "request") {
      const req = [...this.requestLog]
        .reverse()
        .find((r) => r.uuid === item.uuid && r.status === "approved");
      if (req) {
        req.status = "played";
        req.playedAt = new Date().toISOString();
        if (req.from || req.message || req.hasVoice) {
          dedication = {
            from: req.from,
            message: req.message,
            ...(req.hasVoice ? { voiceId: req.id } : {}),
          };
        }
      }
    }
    const meta: RadioNowPlaying = {
      ...item.meta,
      durationSec: item.durationSec,
      ...(item.source === "request" ? { requested: true } : {}),
      ...(dedication ? { dedication } : {}),
    };
    const offsetMs = item.offsetSec * 1000;
    this.announce(async () => {
      const previous = this.nowPlaying;
      this.trackStartedAt = new Date(Date.now() - offsetMs).toISOString();
      meta.startedAt = this.trackStartedAt;
      this.nowPlaying = meta;
      const written = await updateNowPlaying(meta, {
        addPreviousToRecent:
          previous && previous.uuid !== meta.uuid ? previous : undefined,
        trackStartedAt: this.trackStartedAt,
      });
      this.recentlyPlayed = written.recentlyPlayed ?? [];
      this.emitStatus(true);
    });

    void this.refillQueue()
      .then(() => this.persistRotation())
      .finally(() => void this.prepareNext());
  }

  // ───────────────────────── příprava další skladby ─────────────────────────

  private disposePrepared(item: PreparedTrack): void {
    item.deck.dispose();
    item.stinger?.deck.dispose();
  }

  private markBroken(uuid: string, reason: string): void {
    this.broken.add(uuid);
    this.brokenInfo[uuid] = { reason, at: new Date().toISOString() };
  }

  private isCorrupt(probed: number, metaDuration: number): boolean {
    if (metaDuration <= 0) return probed < 15;
    return probed < Math.min(30, metaDuration * 0.25);
  }

  private async getPlayableDuration(uuid: string, filepath: string): Promise<number> {
    const cached = this.durationCache.get(uuid);
    if (cached) return cached;
    let dur = 0;
    if (this.ffmpegPath) {
      dur = await probePlayableDuration(filepath, this.ffmpegPath).catch(() => 0);
    }
    if (dur <= 0) dur = (await probeDuration(filepath)) ?? 0;
    if (dur <= 0) {
      const track = await getTrack(uuid);
      dur = track?.playDuration ?? track?.duration ?? 0;
    }
    if (dur > 0) this.durationCache.set(uuid, dur);
    return dur;
  }

  private async prepareTrack(
    uuid: string,
    source: TrackSource,
    offsetSec: number,
  ): Promise<PreparedTrack | null> {
    if (!this.ffmpegPath) return null;
    const catalog = await getCatalog();
    const entry = catalog.get(uuid);
    const track = entry ? null : await getTrack(uuid);
    if (!entry && !track) return null;

    const filepath = await ensureBroadcastFile(uuid);
    if (!filepath) {
      console.warn(`[radio] Chybí audio, přeskakuji: ${uuid}`);
      this.markBroken(uuid, "Chybí zvukový soubor");
      return null;
    }

    const analysis = await getMixAnalysis(this.ffmpegPath, filepath, uuid);
    const durationSec =
      analysis && analysis.playEnd > 5
        ? analysis.playEnd
        : await this.getPlayableDuration(uuid, filepath);
    const metaDuration = (entry?.durationSec ?? track?.duration ?? 0) || 0;
    if (durationSec <= 0 || this.isCorrupt(durationSec, metaDuration)) {
      console.warn(
        `[radio] Poškozená skladba (${durationSec.toFixed(1)} s), přeskakuji: ${entry?.title ?? uuid}`,
      );
      this.durationCache.delete(uuid);
      this.markBroken(
        uuid,
        `Poškozené audio (${durationSec.toFixed(0)} s místo ${metaDuration.toFixed(0)} s)`,
      );
      return null;
    }

    const deck = new PcmDeck(this.ffmpegPath, filepath, offsetSec).start();
    await deck.waitReady();

    const meta: RadioNowPlaying = entry
      ? toPublic(entry)
      : {
          uuid,
          title: track!.title,
          artist: track!.artist,
          album: track!.album,
          year: track!.year,
          thumbnail: track!.thumbnail,
          durationSec,
        };

    return {
      uuid,
      meta,
      path: filepath,
      durationSec,
      offsetSec,
      deck,
      source,
      stinger: null,
      analysis,
      gain: loudnessGain(analysis?.lufs),
    };
  }

  private async prepareStinger(): Promise<PreparedStinger | null> {
    if (!this.ffmpegPath) return null;
    const stingerPath = pickMidsongPath(this.midsongConfig);
    if (!stingerPath) return null;
    const analysis = await getMixAnalysis(this.ffmpegPath, stingerPath);
    // Bez koncového ticha — jinak by mezi jinglem a skladbou byla díra.
    const dur =
      analysis?.playEnd || ((await probeDuration(stingerPath)) ?? 0);
    if (dur <= 0) return null;
    this.midsongDurationSec = dur;
    const deck = new PcmDeck(this.ffmpegPath, stingerPath).start();
    return {
      path: stingerPath,
      durationSec: dur,
      deck,
      gain: loudnessGain(analysis?.lufs),
    };
  }

  /** Requesty mají přednost, pak rotace. */
  private takeNextCandidate(): { uuid: string; source: TrackSource } | null {
    const req = this.requests.shift();
    if (req) return { uuid: req, source: "request" };
    const rot = this.queue.shift();
    if (rot) return { uuid: rot, source: "rotation" };
    return null;
  }

  private prepareNext(): Promise<void> {
    if (!this.started || this.next) return Promise.resolve();
    if (this.preparing) return this.preparing;

    this.preparing = (async () => {
      for (let attempt = 0; attempt < 6 && this.started && !this.next; attempt++) {
        if (!this.queue.length) await this.refillQueue();
        const candidate = this.takeNextCandidate();
        if (!candidate) break;

        this.preparingUuid = candidate.uuid;
        const prepared = await this.prepareTrack(candidate.uuid, candidate.source, 0);
        this.preparingUuid = null;
        if (!prepared) {
          this.broken.add(candidate.uuid);
          continue;
        }
        if (!this.started || this.next) {
          this.disposePrepared(prepared);
          return;
        }

        this.midsongConfig = getMidsongConfig();
        if (this.midsongConfig.paths.length) {
          this.midsongCountdown -= 1;
          if (this.midsongCountdown <= 0) {
            this.midsongCountdown = randomMidsongInterval(this.midsongConfig);
            if (Math.random() <= this.midsongConfig.chance) {
              prepared.stinger = await this.prepareStinger();
            }
          }
        }

        this.next = prepared;
        break;
      }
      await this.refillQueue();
      void this.persistRotation();
      this.emitStatus(true);
    })().finally(() => {
      this.preparing = null;
      this.preparingUuid = null;
      if (this.started && !this.next) {
        setTimeout(() => void this.prepareNext(), 3_000);
      }
    });
    return this.preparing;
  }

  private async refillQueue(): Promise<void> {
    const catalog = await getCatalog();
    const current = this.main?.kind === "track" ? this.main.uuid : this.nowPlaying?.uuid;
    const nextId = this.next?.uuid ?? this.preparingUuid;
    const context = [
      ...[...this.requests].reverse(),
      nextId,
      current,
      ...this.history,
    ].filter((id): id is string => Boolean(id));
    const exclude = new Set(
      [nextId, current, ...this.requests, ...this.broken].filter(
        (id): id is string => Boolean(id),
      ),
    );
    this.queue = fillRotationQueue(
      this.queue,
      catalog,
      context,
      QUEUE_TARGET_SIZE,
      exclude,
    );
  }

  private async persistRotation(): Promise<void> {
    await writeRotationState({
      playlistBag: this.queue,
      listenerRequests: this.requests,
      rotationHistory: this.history,
      lastPlayedUuid: this.lastPlayedUuid,
      playStats: this.playStats,
      brokenTracks: this.brokenInfo,
      requestLog: this.requestLog,
      moderator: this.moderator,
    }).catch((err: unknown) => console.warn("[radio] Uložení stavu selhalo:", err));
  }

  /** Vrátí nepoužitou připravenou skladbu zpět, odkud přišla. */
  private requeue(item: PreparedTrack): void {
    if (item.offsetSec > 0) return;
    if (item.source === "rotation") this.queue.unshift(item.uuid);
    else if (item.source === "request") this.requests.unshift(item.uuid);
  }

  // ───────────────────────── ovládání ze studia ─────────────────────────

  /** Další skladba — rychlý fade, žádné ticho a žádný reconnect posluchačů. */
  skip(): void {
    if (this.main?.kind === "bed") {
      void this.controlBreak("resume");
      return;
    }
    if (!this.main) return;
    this.retireMain(this.frame, SKIP_FADE_SEC);
    this.nextFadeInSec = 0.3;
    if (this.next?.stinger) {
      this.next.stinger.deck.dispose();
      this.next.stinger = null;
    }
    if (!this.next) void this.prepareNext();
  }

  /** Připraví skladbu jako další (nahradí aktuálně připravenou). */
  private async replaceNext(uuid: string): Promise<boolean> {
    if (this.preparing) await this.preparing;
    const prepared = await this.prepareTrack(uuid, "studio", 0);
    if (!prepared) {
      console.warn(`[radio] Skladbu ${uuid} nelze připravit.`);
      return false;
    }
    if (this.next) {
      this.requeue(this.next);
      this.disposePrepared(this.next);
    }
    this.queue = this.queue.filter((id) => id !== uuid);
    this.requests = this.requests.filter((id) => id !== uuid);
    this.next = prepared;
    await this.refillQueue();
    void this.persistRotation();
    this.emitStatus(true);
    return true;
  }

  playNow(uuid: string): void {
    void this.replaceNext(uuid).then((ok) => {
      if (ok) this.skip();
    });
  }

  async playNext(uuid: string): Promise<boolean> {
    return this.replaceNext(uuid);
  }

  /** Přesune skladbu v rotační frontě (requesty a připravená skladba zůstávají před ní). */
  async moveInQueue(uuid: string, toIndex: number): Promise<boolean> {
    const from = this.queue.indexOf(uuid);
    if (from < 0) return false;
    const next = this.queue.filter((id) => id !== uuid);
    const idx = Math.min(Math.max(0, Math.floor(toIndex)), next.length);
    next.splice(idx, 0, uuid);
    this.queue = next;
    void this.persistRotation();
    this.emitStatus(true);
    return true;
  }

  /** Skočí na konec aktuální skladby — přechod je slyšet za pár sekund. */
  private async seekToOutro(forceStinger: boolean): Promise<void> {
    if (!this.ffmpegPath) return;
    if (!this.next) await this.prepareNext();
    if (forceStinger && this.next && !this.next.stinger) {
      this.next.stinger = await this.prepareStinger();
    }

    const m = this.main;
    if (!m || m.kind !== "track") return;
    const plan = planTransition(
      m.analysis,
      this.next?.analysis ?? null,
      m.durationSec,
      getCrossfadeSec(),
    );
    const target = Math.max(0, m.durationSec - plan.overlapSec - 10);
    const currentPos = (this.frame - m.startFrame) / SAMPLE_RATE;
    if (target <= currentPos) return;

    const deck = new PcmDeck(this.ffmpegPath, m.path, target).start();
    await deck.waitReady();
    if (this.main !== m) {
      deck.dispose();
      return;
    }

    const f = this.frame;
    this.fadeOut(m, f, secToFrames(0.3));
    this.tails.push(m);
    const startFrame = f - secToFrames(target);
    this.main = {
      ...m,
      deck,
      startFrame,
      endFrame: startFrame + secToFrames(m.durationSec),
      fadeInStart: f,
      fadeInFrames: secToFrames(0.3),
      fadeOutStart: null,
      fadeOutFrames: 1,
    };
    this.announce(() => {
      this.trackStartedAt = new Date(Date.now() - target * 1000).toISOString();
      this.emitStatus(true);
    });
  }

  testTransition(): void {
    void this.seekToOutro(false);
  }

  testMidsong(): void {
    void this.seekToOutro(true);
  }

  async removeFromQueue(uuid: string): Promise<boolean> {
    let found = false;
    if (this.next?.uuid === uuid) {
      this.disposePrepared(this.next);
      this.next = null;
      found = true;
    }
    if (this.requests.includes(uuid)) {
      this.requests = this.requests.filter((id) => id !== uuid);
      found = true;
    }
    if (this.queue.includes(uuid)) {
      this.queue = this.queue.filter((id) => id !== uuid);
      found = true;
    }
    if (!found) return false;
    await this.refillQueue();
    void this.prepareNext();
    void this.persistRotation();
    this.emitStatus(true);
    return true;
  }

  async getUpcoming(limit = QUEUE_TARGET_SIZE): Promise<RadioNowPlaying[]> {
    await this.refreshProgramCache();
    return this.upcomingCache.slice(0, limit);
  }

  async getQueuePreview(limit = QUEUE_DISPLAY_SIZE) {
    await this.refreshProgramCache();
    const displayLimit = Math.min(Math.max(1, limit), QUEUE_DISPLAY_SIZE);
    return {
      upcoming: this.upcomingCache.slice(0, displayLimit),
      schedule: sliceScheduleForDisplay(this.scheduleCache, displayLimit),
      nextUp: this.scheduleCache[0] ?? null,
      queueRemaining: this.queueRemaining,
      reserved: this.next?.uuid ?? null,
    };
  }

  /** Celá fronta pro studio — připravená skladba, přání, rotace. */
  async getStudioQueue(): Promise<StudioQueueItem[]> {
    const catalog = await getCatalog();
    const items: StudioQueueItem[] = [];
    const add = (id: string | null | undefined, source: QueueItemSource, stinger = false) => {
      if (!id) return;
      const entry = catalog.get(id);
      if (!entry) return;
      items.push({
        ...toPublic(entry, source === "request"),
        source,
        ...(stinger ? { stingerBefore: true } : {}),
      });
    };
    add(this.next?.uuid ?? this.preparingUuid, "prepared", Boolean(this.next?.stinger));
    for (const id of this.requests) add(id, "request");
    for (const id of this.queue) add(id, "rotation");
    return items;
  }

  async getLibraryStats(): Promise<LibraryStats> {
    const tracks = await listTracks();
    const rows: LibraryStatsRow[] = tracks.map((t) => {
      const s = this.playStats[t.uuid];
      const failed = t.status === "failed";
      return {
        uuid: t.uuid,
        title: t.title,
        artist: t.artist,
        thumbnail: t.thumbnail,
        plays: s?.plays ?? 0,
        lastPlayedAt: s?.lastPlayedAt ?? null,
        lufs: t.mixAnalysis?.lufs ?? null,
        broken:
          this.brokenInfo[t.uuid] ??
          (failed
            ? { reason: t.error ?? "Stažení selhalo", at: t.updatedAt }
            : null),
      };
    });
    const totalPlays = Object.values(this.playStats).reduce((a, s) => a + s.plays, 0);
    const libraryHours =
      tracks.reduce((a, t) => a + (t.playDuration ?? t.duration ?? 0), 0) / 3600;
    const groups = new Map<string, DuplicateTrack[]>();
    for (const t of tracks) {
      if (t.status !== "ready") continue;
      const key = trackMatchKey(t.title, t.artist);
      const list = groups.get(key) ?? [];
      list.push({
        uuid: t.uuid,
        title: t.title,
        artist: t.artist,
        album: t.album,
        thumbnail: t.thumbnail,
        createdAt: t.createdAt,
        plays: this.playStats[t.uuid]?.plays ?? 0,
      });
      groups.set(key, list);
    }
    const duplicates = [...groups.values()]
      .filter((g) => g.length > 1)
      .map((g) => g.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    return { rows, totalPlays, libraryHours, duplicates };
  }

  // ───────────────────────── requesty ─────────────────────────

  private blockedForRequest(exceptRequestId?: string): string[] {
    return [
      this.nowPlaying?.uuid,
      this.main?.uuid,
      this.next?.uuid,
      this.preparingUuid,
      ...this.requests,
      ...this.pendingRequests
        .filter((r) => r.id !== exceptRequestId)
        .map((r) => r.uuid),
      ...this.history.slice(0, REQUEST_COOLDOWN),
      ...this.broken,
    ].filter((id): id is string => Boolean(id));
  }

  async getRequestableTracks(search?: string, limit = 40) {
    return getRequestableTracks({
      search,
      limit,
      excludeUuids: this.blockedForRequest(),
    });
  }

  /** Neschválená přání po čase propadnou (moderátor nebyl u studia). */
  private expireRequests(): void {
    const cutoff = Date.now() - PENDING_REQUEST_TTL_MS;
    let changed = false;
    for (const r of this.requestLog) {
      if (r.status === "pending" && Date.parse(r.createdAt) < cutoff) {
        r.status = "expired";
        r.decidedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) void this.persistRotation();
  }

  private get pendingRequests(): ListenerRequest[] {
    return this.requestLog.filter((r) => r.status === "pending");
  }

  async submitListenerRequest(input: {
    uuid: string;
    from?: unknown;
    message?: unknown;
    /** Hlasovka jako base64 (webm/ogg/mp4 z prohlížeče). */
    voice?: unknown;
  }): Promise<{
    ok: boolean;
    error?: string;
    id?: string;
    status?: RequestStatus;
    position?: number;
  }> {
    if (!areSongRequestsEnabled()) {
      return { ok: false, error: "Přání jsou teď vypnutá." };
    }
    this.expireRequests();
    const uuid = input.uuid.trim();
    const catalog = await getCatalog();
    const entry = catalog.get(uuid);
    if (!entry) {
      return { ok: false, error: "Tuhle skladbu v knihovně nemáme." };
    }
    if (this.pendingRequests.some((r) => r.uuid === uuid) || this.requests.includes(uuid)) {
      return { ok: false, error: "Tuhle si už někdo přeje — počkej, až zazní." };
    }
    if (this.blockedForRequest().includes(uuid)) {
      return { ok: false, error: "Tahle hrála nedávno nebo jde na řadu. Zkus jinou." };
    }
    if (this.pendingRequests.length >= MAX_PENDING_REQUESTS) {
      return { ok: false, error: "Moderátor má teď hodně přání ke schválení, zkus to za chvíli." };
    }

    const fromRaw = cleanInput(input.from, 40);
    const messageRaw = cleanInput(input.message, 200);
    if (containsLink(fromRaw) || containsLink(messageRaw)) {
      return { ok: false, error: "Odkazy do vzkazu dávat nejdou." };
    }
    const from = censor(fromRaw);
    const message = censor(messageRaw);

    const request: ListenerRequest = {
      id: randomUUID(),
      uuid,
      title: entry.title,
      artist: entry.artist,
      thumbnail: entry.thumbnail,
      from: from.text || null,
      message: message.text || null,
      flagged: from.flagged || message.flagged,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    // Hlasovku nejde cenzurovat — o tom, jestli zazní, rozhoduje moderátor.
    if (input.voice) {
      if (!this.ffmpegPath) return { ok: false, error: "Hlasovky teď nejdou zpracovat." };
      try {
        const saved = await saveVoiceNote(request.id, input.voice, this.ffmpegPath);
        request.hasVoice = true;
        request.voiceSec = Math.round(saved.durationSec);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Hlasovku se nepodařilo uložit." };
      }
    }

    this.requestLog.unshift(request);
    if (this.requestLog.length > REQUEST_LOG_LIMIT) {
      this.requestLog.length = REQUEST_LOG_LIMIT;
    }
    console.info(
      `[radio] Nové přání: ${entry.artist} — ${entry.title}` +
        (request.from ? ` (od ${request.from})` : ""),
    );

    if (!isRequestModerationEnabled()) {
      const decided = await this.decideRequest(request.id, true);
      if (!decided.ok) return decided;
    } else {
      void this.persistRotation();
      this.emitStatus(true);
    }
    const view = this.requestView(request);
    return { ok: true, id: request.id, status: view.status, position: view.position ?? undefined };
  }

  /** Moderátor schválí / zamítne přání. */
  async decideRequest(
    id: string,
    approve: boolean,
  ): Promise<{ ok: boolean; error?: string }> {
    this.expireRequests();
    const request = this.requestLog.find((r) => r.id === id);
    if (!request) return { ok: false, error: "Přání nenalezeno." };
    if (request.status !== "pending") {
      return { ok: false, error: "O tomhle přání už je rozhodnuto." };
    }

    if (approve) {
      const blocked = this.blockedForRequest(request.id);
      if (blocked.includes(request.uuid)) {
        return { ok: false, error: "Skladba mezitím hrála nebo už je ve frontě." };
      }
      if (this.requests.length >= getMaxRequestQueue()) {
        return { ok: false, error: "Fronta přání je plná." };
      }
      this.requests.push(request.uuid);
      this.queue = this.queue.filter((q) => q !== request.uuid);
      await this.refillQueue();
    }
    request.status = approve ? "approved" : "rejected";
    request.decidedAt = new Date().toISOString();
    void this.persistRotation();
    this.emitStatus(true);
    return { ok: true };
  }

  private requestView(r: ListenerRequest): RequestStatusView {
    let position: number | null = null;
    if (r.status === "approved") {
      if (this.next?.uuid === r.uuid) position = 1;
      else {
        const idx = this.requests.indexOf(r.uuid);
        if (idx >= 0) position = idx + 1 + (this.next ? 1 : 0);
      }
    }
    return { id: r.id, status: r.status, title: r.title, artist: r.artist, position };
  }

  /** Stav přání pro posluchače (jen podle id, která zná). */
  getRequestStatuses(ids: string[]): RequestStatusView[] {
    this.expireRequests();
    const wanted = new Set(ids.slice(0, 20));
    return this.requestLog.filter((r) => wanted.has(r.id)).map((r) => this.requestView(r));
  }

  /** Pro studio: čekající přání (nejstarší první) + pár posledních rozhodnutých. */
  getModerationList(): { pending: ListenerRequest[]; recent: ListenerRequest[] } {
    this.expireRequests();
    return {
      pending: [...this.pendingRequests].reverse(),
      recent: this.requestLog.filter((r) => r.status !== "pending").slice(0, 12),
    };
  }

  // ───────────────────────── náhled přechodu (studio) ─────────────────────────

  async renderTransitionPreview(
    fromUuid?: string | null,
    toUuid?: string | null,
  ): Promise<string | null> {
    if (!this.ffmpegPath) return null;
    const currentUuid = fromUuid ?? this.nowPlaying?.uuid ?? null;
    const nextUuid = toUuid ?? this.next?.uuid ?? this.queue[0] ?? null;
    if (!currentUuid || !nextUuid || currentUuid === nextUuid) return null;

    const [pathA, pathB] = await Promise.all([
      ensureBroadcastFile(currentUuid),
      ensureBroadcastFile(nextUuid),
    ]);
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
          "-i", pathA,
          "-i", pathB,
          "-filter_complex",
          buildTransitionPreviewFilterGraph(timing.startA, durA, durB, fadeSec),
          "-t", String(timing.duration),
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
}

let engineInstance: RadioEngine | null = null;

export function getRadioEngine(): RadioEngine {
  if (!engineInstance) {
    engineInstance = new RadioEngine();
  }
  return engineInstance;
}
