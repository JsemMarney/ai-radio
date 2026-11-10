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
import { c, formatDuration, radioLog } from "@/lib/radio-log";
import { ListenerStats, type ListenerStatsSummary } from "@/lib/listener-stats";
import {
  AiDj,
  czechTime,
  isNightHour,
  pickFocus,
  type AiDjFocus,
  type AiDjState,
  type DjContext,
} from "@/lib/ai-dj";
import { stationClock } from "@/lib/station-time";
import { sendAlert } from "@/lib/alerts";
import {
  genreOf,
  genrePrompt,
  loadGenres,
  parseGenreReply,
  saveGenres,
  type GenreInfo,
} from "@/lib/genres";
import { listMessages } from "@/lib/messages";
import { getStationConfig } from "@/lib/station-config";
import {
  dueEntries,
  loadSchedule,
  sanitizeSchedule,
  saveSchedule,
  type ScheduleEntry,
} from "@/lib/scheduler";
import {
  getDownloadsDir,
  getTrack,
  listTracks,
  trackMatchKey,
} from "@/lib/library";
import {
  getMixAnalysis,
  loudnessGain,
  planTransition,
  type MixAnalysis,
} from "@/lib/mix-analysis";
import { MicInput } from "@/lib/mic-input";
import {
  cleanupVoiceNotes,
  saveVoiceNote,
  voiceNotePath,
} from "@/lib/voice-notes";
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
  getLibraryList,
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
  /** Moderátor se nedávno ozval (mikrofon / nastavil jméno) — jinak posluchači vidí AutoDJ. */
  moderatorOnAir: boolean;
  /** AI moderátor(ři), kteří mají teď směnu („Anna & Petr“) — null = AutoDJ. */
  aiHost: string | null;
  /** Vlastní texty do běžícího pruhu. */
  tickerMessages: string[];
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

/** Po kolika minutách se nevyřízené přání schválí samo (0 = nikdy, jen propadne). */
function getAutoApproveMs(): number {
  const raw = Number(process.env.RADIO_REQUEST_AUTO_APPROVE_MIN ?? 15);
  return Number.isFinite(raw) && raw > 0 ? raw * 60 * 1000 : 0;
}
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
      const resolved = existsSync(p)
        ? path.resolve(p)
        : path.join(process.cwd(), p);
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
/** Kolik minut před předávkou směny AI mlčí (běžné vstupy, zprávy). */
const HANDOVER_QUIET_MIN = 15;

export class RadioEngine {
  private outputs = new Map<StreamFormat, Output>();
  private sinks = new Set<BroadcastSink>();
  private ffmpegPath: string | null = null;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private requestTimer: ReturnType<typeof setInterval> | null = null;
  /** Plánovač + vzorkování posluchačů (každých 20 s). */
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private clockTicks = 0;
  private listenerStats = new ListenerStats();
  /** AI moderátor — vstup připravený dopředu pro začátek další skladby. */
  private aiDj = new AiDj();
  private djTracks = 0;
  /** Po kolika skladbách přijde další AI vstup (losuje se v rozsahu z nastavení). */
  private djGap: number | null = null;
  /** Předem vylosované další rozestupy AI vstupů — fronta ve studiu ukazuje přesný plán. */
  private djPlan: number[] = [];
  private djRound = 0;
  private djClip: { id: string; forUuid: string; outroSec?: number } | null =
    null;
  /** Hodina, ve které už zazněly zprávy v celou („2026-11-06 20“). */
  private djHourlyKey: string | null = null;
  /** Od kdy čeká předávka směny, než bude moct AI mluvit. */
  private shiftPendingSince: number | null = null;
  private djUsedNotes = new Set<string>();
  private djClipLabel: string | null = null;
  private schedule: ScheduleEntry[] = [];
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
  /** Hlasitost a ztlumení hudby pro aktuální klip (AI v noci tišeji, hudba níž). */
  private clipGain = 1;
  private clipNight = false;
  /**
   * Přání s hlasovkou: skladba počká — nejdřív hlasovka, pak odpověď AI a skladba
   * pomalu naběhne pod konec odpovědi.
   */
  private voiceIntro: {
    uuid: string;
    requestId: string;
    stage: "wait" | "voice" | "reply";
    busy: boolean;
    since: number;
    voiceEndedAt: number | null;
    replyEndFrame: number | null;
  } | null = null;
  /** Připravené odpovědi AI na hlasovky přání (id přání → vstup). */
  private voiceReplies = new Map<
    string,
    {
      done: boolean;
      seg: { id: string; label: string; durationSec: number } | null;
    }
  >();
  /** Hlasovky, které už zazněly před skladbou (nepouštět znovu na začátku). */
  private introHandled = new Set<string>();
  private moderator: string | null = null;
  /** Kdy moderátor naposledy mluvil nebo se přihlásil jménem (0 = od startu ne). */
  private hostActiveAt = 0;
  /** Popis přechodu do řádku další skladby v konzoli. */
  private transitionNote: string | null = null;
  /** Přímý odposlech pro studio (mono PCM bez mikrofonu — moderátor se neslyší s ozvěnou). */
  private monitors = new Set<(pcm: Int16Array) => void>();
  private tickerMessages: string[] = [];

  private durationCache = new Map<string, number>();
  private midsongConfig: MidsongConfig = {
    paths: [],
    minTracks: 3,
    maxTracks: 6,
    chance: 1,
    fadeSec: 4,
  };
  private midsongCountdown = 0;
  /** Předem vylosované další rozestupy jinglů. */
  private midsongPlan: number[] = [];
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
      moderatorOnAir: this.isModeratorOnAir(),
      aiHost: this.currentAiHost(),
      tickerMessages: this.tickerMessages,
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
      this.currentAiHost() ?? "",
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
              if (
                controller.desiredSize !== null &&
                controller.desiredSize < -1500
              ) {
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
    while (
      out.burst.length > 1 &&
      out.burstBytes - out.burst[0]!.length >= limit
    ) {
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
    await this.listenerStats.load();
    this.aiDj.listenedShare = (hour) => this.listenerStats.listenedShare(hour);
    await this.aiDj.load();
    await loadGenres();
    // Žánry: první dávka po minutě, pak každých 10 minut, dokud knihovna nemá všechno.
    setTimeout(() => void this.classifyGenresTick(), 60_000);
    setInterval(() => void this.classifyGenresTick(), 10 * 60_000).unref?.();
    this.schedule = await loadSchedule();
    this.tickerMessages = boot.tickerMessages ?? [];
    void cleanupVoiceNotes().catch(() => {});

    const catalog = await getCatalog();
    this.requests = (boot.listenerRequests ?? []).filter((id) =>
      catalog.has(id),
    );
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
    const resumed = await this.tryResume(
      boot.nowPlaying?.uuid,
      boot.trackStartedAt,
    );
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
    if (this.requestTimer) clearInterval(this.requestTimer);
    this.requestTimer = null;
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
    void this.listenerStats.save().catch(() => {});
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
    // Přání čekající na moderátora hlídat i bez dotazů z webu (automatické schválení).
    if (this.requestTimer) clearInterval(this.requestTimer);
    this.requestTimer = setInterval(() => this.expireRequests(), 30_000);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = setInterval(() => this.clockTick(), 20_000);
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

    const monitor = this.monitors.size ? new Float32Array(n) : null;
    this.mixMic(acc, n, f0, monitor);
    if (monitor) {
      const mono = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const s = monitor[i]!;
        mono[i] = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
      }
      for (const send of this.monitors) send(mono);
    }

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
  private mixMic(
    acc: Float32Array,
    n: number,
    f0: number,
    monitor: Float32Array | null,
  ): void {
    const mic = this.mic?.active ? this.mic : null;
    const live = Boolean(mic);
    if (live !== this.micMixedLive) {
      this.micMixedLive = live;
      this.hostActiveAt = Date.now();
      if (live)
        radioLog(
          "🎙",
          c.boldRed("MIKROFON ZAPNUT") +
            (this.moderator ? c.red(` — ${this.moderator}`) : ""),
        );
      else radioLog("🎙", c.dim("mikrofon vypnut"));
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

    if (!mic && !clipPcm && this.duckGain > 0.999) {
      if (monitor)
        for (let i = 0; i < n; i++)
          monitor[i] = (acc[i * 2]! + acc[i * 2 + 1]!) / 2;
      return;
    }

    const voice = mic ? mic.read(n) : null;
    if (voice) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += voice[i]! * voice[i]!;
      if (Math.sqrt(sum / n) > VAD_THRESHOLD) {
        this.duckHoldUntil = f0 + n + secToFrames(DUCK_HOLD_SEC);
      }
    }
    if (clipPcm) this.duckHoldUntil = f0 + n + secToFrames(DUCK_HOLD_SEC);
    const duck =
      clipPcm && !voice && this.clipNight
        ? this.duckLevel * 0.5
        : this.duckLevel;
    const target = (voice || clipPcm) && f0 < this.duckHoldUntil ? duck : 1;
    const attack = 1 - Math.exp(-1 / (DUCK_ATTACK_SEC * SAMPLE_RATE));
    const release = 1 - Math.exp(-1 / (DUCK_RELEASE_SEC * SAMPLE_RATE));
    const micScale = 32767 * this.micGain;

    for (let i = 0; i < n; i++) {
      this.duckGain +=
        (target - this.duckGain) * (target < this.duckGain ? attack : release);
      const clipSample = clipPcm ? clipPcm[i * 2]! * this.clipGain : 0;
      const v = (voice ? voice[i]! * micScale : 0) + clipSample;
      if (monitor) {
        monitor[i] =
          ((acc[i * 2]! + acc[i * 2 + 1]!) / 2) * this.duckGain + clipSample;
      }
      acc[i * 2] = acc[i * 2]! * this.duckGain + v;
      acc[i * 2 + 1] = acc[i * 2 + 1]! * this.duckGain + v;
    }
  }

  // ───────────────────────── plánovač + statistika posluchačů ─────────────────────────

  private clockTick(): void {
    this.clockTicks++;
    // Posluchači: vzorek jednou za minutu, na disk každých 10 minut.
    if (this.clockTicks % 3 === 0)
      this.listenerStats.record(this.listenerCount);
    if (this.clockTicks % 30 === 0) {
      void this.listenerStats
        .save()
        .catch((err: unknown) => console.warn("[stats] Uložení selhalo:", err));
    }
    void this.runSchedule();
    // Začátek / konec směny AI moderátora → posluchači hned vidí, kdo moderuje.
    this.emitStatus();
  }

  /** Jména AI moderátorů se směnou, když AI moderátor běží (jinak null = AutoDJ). */
  private currentAiHost(): string | null {
    if (!this.aiDj.config.enabled || !this.aiDj.isConfigured()) return null;
    const names = this.aiDj
      .hostsAt(new Date(), this.djFallbackName())
      .map((h) => h.name);
    return names.length ? names.join(" & ") : null;
  }

  private djFallbackName(): string {
    return process.env.AI_DJ_NAME?.trim() || this.moderator || "AI moderátor";
  }

  private async runSchedule(): Promise<void> {
    const due = dueEntries(this.schedule);
    if (!due.length) return;
    await saveSchedule(this.schedule).catch(() => {});
    for (const e of due) {
      const label = e.label ? ` — ${e.label}` : "";
      if (e.action === "track" && e.trackUuid) {
        const ok = await this.playNext(e.trackUuid);
        radioLog(
          "⏰",
          c.blue(`Plán ${e.time}: skladba jako další${label}`),
          ok ? undefined : "nepodařilo se",
        );
      } else {
        const res = await this.controlBreak(
          e.action === "break-now" ? "now" : "arm",
        );
        radioLog(
          "⏰",
          c.blue(
            `Plán ${e.time}: ${e.action === "break-now" ? "pauza hned" : "pauza po skladbě"}${label}`,
          ),
          res.ok ? undefined : res.error,
        );
      }
    }
  }

  getListenerStats(): ListenerStatsSummary {
    return this.listenerStats.summary();
  }

  getSchedule(): ScheduleEntry[] {
    return this.schedule;
  }

  async setSchedule(
    input: unknown,
  ): Promise<{ ok: boolean; error?: string; entries?: ScheduleEntry[] }> {
    const clean = sanitizeSchedule(input, this.schedule);
    if (typeof clean === "string") return { ok: false, error: clean };
    this.schedule = clean;
    await saveSchedule(clean);
    return { ok: true, entries: clean };
  }

  /** Přihlásí přímý odposlech; vrací funkci pro odhlášení. */
  addMonitor(send: (pcm: Int16Array) => void): () => void {
    this.monitors.add(send);
    return () => this.monitors.delete(send);
  }

  /** O kolik později slyší posluchači to, co jde do odposlechu (sekundy). */
  getListenerDelaySec(): number {
    return getBurstSec() + LEAD_SEC + 0.3;
  }

  /** Pustí hlasovku posluchače do éteru (přes hudbu, ta se ztlumí). */
  async playVoiceNote(
    requestId: string,
    label?: string,
    opts?: { noReply?: boolean },
  ): Promise<{ ok: boolean; error?: string }> {
    const request = this.requestLog.find((r) => r.id === requestId);
    // Bez přání = hlasovka ze vzkazu do studia (stejná složka _voice).
    const file = !request || request.hasVoice ? voiceNotePath(requestId) : null;
    if (!file || !this.ffmpegPath)
      return { ok: false, error: "Hlasovka nenalezena." };
    const deck = new PcmDeck(this.ffmpegPath, file).start();
    await deck.waitReady();
    this.voiceClip?.dispose();
    this.voiceClip = deck;
    // AI v noci: hlas o 2,5 dB tišší a hudba pod ním ztlumená o dalších 6 dB.
    this.clipNight = !!label && isNightHour(stationClock().hour);
    this.clipGain = this.clipNight ? Math.pow(10, -2.5 / 20) : 1;
    if (label) radioLog("🤖", c.cyan(`${label} mluví`));
    else
      radioLog(
        "🔊",
        c.magenta(`Hlasovka do éteru — ${request?.from ?? "posluchač"}`),
        request ? `k „${request.title}“` : "vzkaz do studia",
      );
    // Hlasovka posluchače → AI na ni po přehrání krátce odpoví.
    if (!label && !opts?.noReply)
      void this.replyToVoice(
        file,
        request?.from ?? null,
        request ? undefined : requestId,
      );
    return { ok: true };
  }

  private async replyToVoice(
    file: string,
    from: string | null,
    messageId?: string,
  ): Promise<void> {
    const s = this.aiDj.config;
    const ffmpegPath = this.ffmpegPath;
    if (
      !s.enabled ||
      !ffmpegPath ||
      !this.aiDj.isConfigured() ||
      this.aiDj.isBusy ||
      !this.aiDj.budget().canSpeak
    )
      return;
    if (!this.aiDj.hostsAt(new Date(), this.djFallbackName()).length) return;
    if (!this.hasListeners()) return;
    try {
      const text = await this.aiDj.transcribe(file);
      if (!text) return;
      const ctx = await this.buildDjContext(
        this.nowPlaying,
        null,
        "voice-reply",
        { id: messageId, from, text },
      );
      const seg = await this.aiDj.createSegment(ctx, ffmpegPath, true);
      // Počkat, až hlasovka dohraje (max. minuta).
      for (let i = 0; i < 120 && this.voiceClip; i++)
        await new Promise((r) => setTimeout(r, 500));
      if (
        !this.started ||
        this.voiceClip ||
        !this.canDjSpeak() ||
        !this.hasListeners()
      )
        return;
      const played = await this.playVoiceNote(
        seg.id,
        seg.hosts.join(" & ") || "AI moderátor",
      );
      // Odpověď je vstup jako každý jiný → mezera se počítá znovu od ní.
      if (played.ok) this.resetDjGap();
    } catch (err) {
      console.warn(
        "[ai-dj] odpověď na hlasovku:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  stopVoiceNote(): void {
    this.voiceClip?.dispose();
    this.voiceClip = null;
  }

  /**
   * Moderátor je „ve studiu“, když mluví nebo mluvil před méně než RADIO_MODERATOR_IDLE_MIN
   * (výchozí 30 min). Jinak posluchači místo jména vidí AutoDJ.
   */
  private isModeratorOnAir(): boolean {
    if (!this.moderator) return false;
    if (this.micLive || this.mic?.active) return true;
    const raw = Number(process.env.RADIO_MODERATOR_IDLE_MIN ?? 30);
    const idleMin = Number.isFinite(raw) && raw > 0 ? raw : 30;
    return (
      this.hostActiveAt > 0 && Date.now() - this.hostActiveAt < idleMin * 60_000
    );
  }

  /** Jméno moderátora, které vidí posluchači (prázdné = skrýt). */
  setModerator(name: unknown): { ok: boolean; error?: string } {
    const clean = cleanInput(name, 40);
    if (containsLink(clean))
      return { ok: false, error: "Odkaz do jména nepatří." };
    this.moderator = censor(clean).text || null;
    this.hostActiveAt = this.moderator ? Date.now() : 0;
    void this.persistRotation();
    this.emitStatus(true);
    return { ok: true };
  }

  /** Vlastní texty do běžícího pruhu (max 5 řádků po 140 znacích). */
  setTickerMessages(messages: unknown): { ok: boolean; error?: string } {
    const list = Array.isArray(messages) ? messages : [];
    const clean = list
      .map((m) => cleanInput(m, 140))
      .filter(Boolean)
      .slice(0, 5);
    if (clean.some(containsLink))
      return { ok: false, error: "Odkazy do pruhu nepatří." };
    this.tickerMessages = clean.map((m) => censor(m).text);
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
      this.duckLevel =
        duck <= -60 ? 0 : Math.pow(10, Math.min(0, Math.max(-60, duck)) / 20);
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

  /** Je další skladba přání s hlasovkou, která má zaznít před ní? */
  private voiceIntroFor(nxt: PreparedTrack): boolean {
    if (this.voiceIntro?.uuid === nxt.uuid) return true;
    if (nxt.source !== "request" || this.breakState !== "none") return false;
    const req = [...this.requestLog]
      .reverse()
      .find((r) => r.uuid === nxt.uuid && r.status === "approved");
    if (!req?.hasVoice || !req.autoApproved || this.introHandled.has(req.id))
      return false;
    this.voiceIntro = {
      uuid: nxt.uuid,
      requestId: req.id,
      stage: "wait",
      busy: false,
      since: Date.now(),
      voiceEndedAt: null,
      replyEndFrame: null,
    };
    return true;
  }

  /**
   * Hlasovka před přáním: ticho → hlasovka → odpověď AI → skladba naběhne
   * (pomalu, pod posledními vteřinami odpovědi). Vrací true, dokud skladba čeká.
   */
  private runVoiceIntro(nxt: PreparedTrack, f: number): boolean {
    const intro = this.voiceIntro;
    if (!intro || intro.uuid !== nxt.uuid) return false;
    const start = (fadeSec: number) => {
      this.introHandled.add(intro.requestId);
      this.voiceIntro = null;
      this.startTrack(nxt, f, fadeSec);
      return true;
    };
    // Pojistka: nic nesmí držet vysílání v tichu déle než 3 minuty.
    if (Date.now() - intro.since > 3 * 60_000) return start(1);
    if (intro.busy) return true;
    if (intro.stage === "wait") {
      intro.busy = true;
      this.introHandled.add(intro.requestId);
      void this.playVoiceNote(intro.requestId, undefined, { noReply: true })
        .then((r) => {
          intro.stage = "voice";
          if (!r.ok) intro.voiceEndedAt = Date.now();
        })
        .catch(() => {
          intro.stage = "voice";
        })
        .finally(() => (intro.busy = false));
      return true;
    }
    if (intro.stage === "voice") {
      if (this.voiceClip) return true;
      intro.voiceEndedAt ??= Date.now();
      const reply = this.voiceReplies.get(intro.requestId);
      // Odpověď se ještě píše → počkat nejvýš 10 s, pak radši hudba.
      if (reply && !reply.done && Date.now() - intro.voiceEndedAt < 10_000)
        return true;
      this.voiceReplies.delete(intro.requestId);
      const seg = reply?.seg;
      if (!seg || !this.canDjSpeak()) return start(2.5);
      intro.busy = true;
      void this.playVoiceNote(seg.id, seg.label)
        .then((r) => {
          intro.stage = "reply";
          if (r.ok) this.resetDjGap();
          intro.replyEndFrame = r.ok
            ? this.frame + secToFrames(seg.durationSec)
            : this.frame;
        })
        .catch(() => {
          intro.stage = "reply";
          intro.replyEndFrame = this.frame;
        })
        .finally(() => (intro.busy = false));
      return true;
    }
    // Odpověď běží: skladba naběhne pomalu ~6 s před jejím koncem.
    const lead = secToFrames(6);
    if (intro.replyEndFrame !== null && f >= intro.replyEndFrame - lead)
      return start(6);
    if (!this.voiceClip) return start(2);
    return true;
  }

  /** Hned po schválení přání s hlasovkou: přepis + odpověď AI, ať je hotová, než přání pojede. */
  private prepareVoiceReply(
    req: ListenerRequest,
    transcript: string | null,
  ): void {
    const s = this.aiDj.config;
    const ffmpegPath = this.ffmpegPath;
    if (
      !req.hasVoice ||
      !s.enabled ||
      !ffmpegPath ||
      !this.aiDj.isConfigured() ||
      !this.aiDj.budget().canSpeak ||
      !this.hasListeners() ||
      !this.aiDj.hostsAt(new Date(), this.djFallbackName()).length
    )
      return;
    const slot: {
      done: boolean;
      seg: { id: string; label: string; durationSec: number } | null;
    } = { done: false, seg: null };
    this.voiceReplies.set(req.id, slot);
    void (async () => {
      try {
        const text =
          transcript ??
          (await this.aiDj.transcribe(voiceNotePath(req.id) ?? ""));
        if (!text) return;
        // Počkat, až AI dokončí rozpracovaný vstup (jeden hlas najednou).
        for (let i = 0; i < 90 && this.aiDj.isBusy; i++)
          await new Promise((r) => setTimeout(r, 1000));
        const ctx = await this.buildDjContext(
          this.nowPlaying,
          null,
          "voice-reply",
          {
            from: req.from,
            text: `${text}
(Posluchač si k tomu přeje: ${req.artist} — ${req.title}. Ta písnička začne hned po tvé odpovědi — na konci ji krátce uveď.)`,
          },
        );
        const seg = await this.aiDj.createSegment(ctx, ffmpegPath, true);
        slot.seg = {
          id: seg.id,
          label: seg.hosts.join(" & ") || "AI moderátor",
          durationSec: seg.durationSec,
        };
      } catch (err) {
        console.warn(
          "[ai-dj] odpověď na hlasovku přání:",
          err instanceof Error ? err.message : err,
        );
      } finally {
        slot.done = true;
      }
    })();
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
      radioLog("⏵", c.yellow("Konec pauzy — zpátky hudba"));
      this.startTrack(nxt, f, 0.4);
      this.emitStatus(true);
      return;
    }
    const loopFade = secToFrames(2.5);
    if ((remaining <= loopFade || m.deck.ended) && this.bedPrepared) {
      this.fadeOut(
        m,
        f,
        Math.max(secToFrames(0.3), Math.min(remaining, loopFade)),
      );
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
    if (
      typeof options.bed === "string" &&
      options.bed &&
      options.bed !== this.bedChoice
    ) {
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
          return {
            ok: false,
            error: "Podkres se nepodařilo připravit (ffmpeg?).",
          };
        }
        break;
      case "cancel":
        if (this.breakState === "armed") {
          this.breakState = "none";
          this.breakNow = false;
        }
        break;
      case "resume":
        if (this.breakState !== "on")
          return { ok: false, error: "Pauza neběží." };
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
        if (this.runVoiceIntro(nxt, f)) return;
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
        radioLog(
          "⏸",
          c.boldYellow("PAUZA NA SLOVO") + c.yellow(" — hraje podkres"),
        );
        this.emitStatus(true);
      }
      return;
    }

    if (!nxt) {
      // Nic připraveno (prázdná knihovna / chyba) — dohrát; pak záložní jingle.
      if (ended) this.retireMain(f, 0.05);
      return;
    }

    // AI vstup přes konec dohrávající skladby (hudba se pod hlasem ztlumí, přechod proběhne pod ním).
    const dj = this.djClip;
    if (
      dj?.outroSec &&
      dj.forUuid === nxt.uuid &&
      m.kind === "track" &&
      !this.voiceClip &&
      remaining <= secToFrames(dj.outroSec)
    ) {
      this.djClip = null;
      if (this.canDjSpeak() && this.hasListeners())
        void this.playVoiceNote(dj.id, this.djClipLabel ?? "AI moderátor");
    }

    // Další je přání s hlasovkou → skladba dohraje do ticha a další počká na hlasovku.
    if (
      (m.kind === "track" || m.filler) &&
      !nxt.stinger &&
      this.voiceIntroFor(nxt)
    ) {
      const fade = secToFrames(m.filler ? 1 : 3);
      if (m.filler || remaining <= fade || ended)
        this.retireMain(
          f,
          Math.max(0.05, Math.min(remaining, fade) / SAMPLE_RATE),
        );
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
      this.fadeOut(
        m,
        fadeStart,
        Math.max(secToFrames(0.05), m.endFrame - fadeStart),
      );
      this.transitionNote = `přechod ${Math.round(plan.overlapSec)} s`;
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
    radioLog("♪", c.dim(`jingle ${path.basename(st.path)}`));
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
    void sendAlert(
      "fallback",
      "⚠️ Rádio nemá co hrát (prázdná fronta / chyba knihovny) — hraje záložní jingle nebo ticho.",
    );
    if (!this.ffmpegPath || !this.fallbackPaths.length) {
      this.silentSince = f;
      return;
    }
    const file =
      this.fallbackPaths[
        Math.floor(Math.random() * this.fallbackPaths.length)
      ]!;
    const deck = new PcmDeck(this.ffmpegPath, file).start();
    // Délku neznáme synchronně — konec určí dekodér (deck.ended).
    this.main = {
      ...this.stingerVoice({ path: file, durationSec: 3600, deck, gain: 1 }, f),
      filler: true,
    };
    radioLog(
      "⚠",
      c.yellow(`Není co hrát — záložní jingle ${path.basename(file)}`),
    );
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
      if (this.history.length > HISTORY_LIMIT)
        this.history.length = HISTORY_LIMIT;
    }
    this.lastPlayedUuid = item.uuid;
    if (item.offsetSec === 0) {
      const prev = this.playStats[item.uuid];
      this.playStats[item.uuid] = {
        ...prev,
        plays: (prev?.plays ?? 0) + 1,
        lastPlayedAt: new Date().toISOString(),
      };
    }
    delete this.brokenInfo[item.uuid];
    {
      const tag =
        item.source === "request"
          ? c.magenta(" PŘÁNÍ")
          : item.source === "rotation"
            ? ""
            : c.cyan(" ZAŘAZENO");
      const details = [formatDuration(item.durationSec), this.transitionNote]
        .filter(Boolean)
        .join(" · ");
      this.transitionNote = null;
      radioLog(
        c.green("▶"),
        `${c.bold(item.meta.artist)} — ${item.meta.title}${tag}`,
        details,
      );
    }

    // Schválené přání → věnování, které moderátor přečte a posluchači uvidí.
    let dedication: RadioNowPlaying["dedication"];
    let voiceQueued = false;
    if (item.source === "request") {
      const req = [...this.requestLog]
        .reverse()
        .find((r) => r.uuid === item.uuid && r.status === "approved");
      if (req) {
        req.status = "played";
        req.playedAt = new Date().toISOString();
        // Bez moderátora pustí hlasovku samo rádio — chvilku po začátku skladby (po přechodu).
        if (this.introHandled.has(req.id)) {
          // Hlasovka i odpověď už zazněly před skladbou — teď jen hudba.
          this.introHandled.delete(req.id);
          voiceQueued = true;
        } else if (req.autoApproved && req.hasVoice) {
          voiceQueued = true;
          const voiceId = req.id;
          setTimeout(() => {
            if (this.started && this.main?.uuid === item.uuid)
              void this.playVoiceNote(voiceId);
          }, 2500);
        }
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

    if (item.meta.artist)
      this.aiDj.recordPlay(item.meta.artist, item.meta.title);
    this.onTrackStartedDj(item, voiceQueued);

    void this.refillQueue()
      .then(() => this.persistRotation())
      .finally(() => void this.prepareNext());
  }

  // ───────────────────────── AI moderátor ─────────────────────────

  /** Mluví živý moderátor / je pauza na slovo → AI mlčí. */
  private canDjSpeak(): boolean {
    return !this.mic?.active && this.breakState === "none";
  }

  /** Nikdo neposlouchá → AI moderátor mlčí (nic negeneruje ani nepouští, šetří kredity). */
  private hasListeners(): boolean {
    return this.listenerCount > 0;
  }

  private onTrackStartedDj(item: PreparedTrack, voiceQueued: boolean): void {
    const label = this.djClipLabel;
    const clip = this.djClip;
    this.djClip = null;
    // Vstup připravený pro tuhle skladbu → přes její začátek (po přechodu).
    if (clip && clip.forUuid === item.uuid && !voiceQueued) {
      setTimeout(() => {
        if (
          this.started &&
          this.main?.uuid === item.uuid &&
          !this.voiceClip &&
          this.canDjSpeak() &&
          this.hasListeners()
        ) {
          void this.playVoiceNote(clip.id, label ?? "AI moderátor");
        }
      }, 1500);
    }

    this.djTracks++;
    const s = this.aiDj.config;
    this.djGap ??= this.aiDj.nextGap();
    // Předávka směny: na začátku první skladby po změně směny se moderátoři rozloučí / představí.
    if (s.enabled && this.aiDj.isConfigured() && this.handleShiftChange(item))
      return;
    // Zprávy v celou: skladba začala chvíli před celou → vstup se zprávami k začátku té další.
    const airAt = this.nextTrackStartsAt();
    const clk = stationClock(airAt);
    // Kolem celé: zazní mezi :56 a :07 (hodina = ta celá, ke které patří).
    const nearHour = clk.minute >= 56 || clk.minute <= 7;
    const hourOf = stationClock(new Date(airAt.getTime() + 10 * 60_000));
    const hourKey = `${hourOf.date} ${hourOf.hour}`;
    const everyH = Math.max(
      1,
      Number(process.env.AI_DJ_NEWS_EVERY_H ?? 3) || 3,
    );
    if (
      s.enabled &&
      s.news &&
      nearHour &&
      hourOf.hour % everyH === 0 &&
      this.djHourlyKey !== hourKey &&
      !this.aiDj.shiftChangeWithin(airAt, HANDOVER_QUIET_MIN) &&
      this.aiDj.isConfigured() &&
      this.canDjSpeak() &&
      !this.aiDj.isBusy &&
      this.aiDj.budget().canSpeak &&
      this.hasListeners() &&
      this.aiDj.hostsAt(new Date(), this.djFallbackName()).length
    ) {
      this.djHourlyKey = hourKey;
      this.resetDjGap();
      void this.prepareDjFor(item, "hourly-news");
      return;
    }
    // Denní shrnutí: jednou za den, vstup k první skladbě po AI_DJ_SUMMARY_HOUR (výchozí 20 h).
    const sumHour = Number(process.env.AI_DJ_SUMMARY_HOUR ?? 20);
    if (
      s.enabled &&
      Number.isFinite(sumHour) &&
      clk.hour === sumHour &&
      this.aiDj.summarySaidOn !== clk.date &&
      this.aiDj.isConfigured() &&
      this.canDjSpeak() &&
      !this.aiDj.isBusy &&
      this.aiDj.budget().canSpeak &&
      this.hasListeners() &&
      this.aiDj.hostsAt(airAt, this.djFallbackName()).length
    ) {
      this.aiDj.markSummary(clk.date);
      this.resetDjGap();
      void this.prepareDjFor(item, "daily-summary", {
        summary: this.dailySummary(),
      });
      return;
    }
    if (!s.enabled || !this.aiDj.isConfigured()) return;
    if (this.djTracks < this.djGap) {
      // Rozestup ještě nedošel — přání posluchače ale AI uvede vždy (když mezi tím hrála aspoň jedna písnička bez slova).
      if (this.djTracks >= 2) void this.maybeAnnounceRequest(item);
      return;
    }
    if (!this.canDjSpeak() || this.aiDj.isBusy) return;
    if (!this.hasListeners()) return;
    // Měsíční rozpočet znaků — když dnes nezbývá, mlčí (nespouští zbytečně model).
    if (!this.aiDj.budget().canSpeak) return;
    // Nikdo nemá směnu → AutoDJ, nic se nechystá (rozestup se nepočítá znovu).
    if (!this.aiDj.hostsAt(new Date(), this.djFallbackName()).length) return;
    // Za chvíli je předávka směny → teď mlčet (dva vstupy pár minut po sobě zní hloupě
    // a stojí kredity). Rozestup zůstává naplněný, předávka ho pak vynuluje.
    if (this.aiDj.shiftChangeWithin(airAt, HANDOVER_QUIET_MIN)) return;
    this.resetDjGap();
    void this.prepareDjFor(item);
  }

  /** Změnila se směna k začátku další skladby? → vstup s předávkou. Vrací true, když se vstup chystá. */
  private handleShiftChange(item: PreparedTrack): boolean {
    const fallback = this.djFallbackName();
    // Směna platí ve chvíli, kdy vstup zazní — na začátku další skladby.
    let at = this.nextTrackStartsAt();
    // Předávka patří na hranici skladeb, která je změně směny nejblíž: když směna končí
    // za 2 minuty a další hranice bude až za 4, předávka zazní už teď (nejvýš 15 min předem).
    let early = false;
    {
      const after = new Date(at.getTime() + (item.durationSec || 210) * 1000);
      const change = this.aiDj.shiftChangeBetween(at, after);
      if (change) {
        const before = change.getTime() - at.getTime();
        if (before <= HANDOVER_QUIET_MIN * 60_000 && before < after.getTime() - change.getTime()) {
          at = new Date(change.getTime() + 60_000);
          early = true;
        }
      }
    }
    const arrivingHosts = this.aiDj.hostsAt(at, fallback);
    const names = arrivingHosts.map((h) => h.name);
    const prev = this.aiDj.shiftNames();
    if (prev === null) {
      // Po startu rádia se nikdo znovu nepředstavuje (čas nástupu se vezme ze směny).
      this.aiDj.setShiftNames(names, null);
      return false;
    }
    const same =
      prev.length === names.length && prev.every((n) => names.includes(n));
    if (same) return false;
    const leaving = prev.filter((n) => !names.includes(n));
    const arriving = names.filter((n) => !prev.includes(n));
    const staying = names.filter((n) => prev.includes(n));
    const silently = () => {
      this.shiftPendingSince = null;
      this.aiDj.setShiftNames(names, at.getTime());
      return false;
    };
    // Nikdo neposlouchá → směna se přepne potichu (nikdo pak netvrdí, že právě nastoupil).
    if (!this.hasListeners()) return silently();
    // Nejde mluvit teď → zkusí to u další skladby; po 20 minutách už jen potichu přepne
    // (předávka o hodinu později by zněla divně).
    if (
      !this.canDjSpeak() ||
      this.aiDj.isBusy ||
      !this.aiDj.budget().canSpeak
    ) {
      this.shiftPendingSince ??= Date.now();
      if (Date.now() - this.shiftPendingSince > 20 * 60_000) return silently();
      return false;
    }
    this.shiftPendingSince = null;
    this.aiDj.setShiftNames(names, at.getTime());
    if (!leaving.length && !arriving.length) return false;
    // Hlasy podle aktuálních nastavení (stejné jméno = stejný hlas).
    const all = this.aiDj.config.hosts ?? [];
    const voiceOf = (n: string) =>
      all.find((h) => h.name === n && h.enabled !== false && h.voiceId)
        ?.voiceId;
    const leaver = leaving
      .map((n) => ({ name: n, voiceId: voiceOf(n) ?? "" }))
      .filter((h) => h.voiceId)
      .slice(0, 1);
    const newcomers = arrivingHosts.filter((h) => arriving.includes(h.name));
    const stayer = arrivingHosts.find((h) => staying.includes(h.name));
    // Kdo mluví (nejvýš dva):
    //  - jen příchod k někomu, kdo už vysílá → ten ho přivítá, nový se představí,
    //  - jen odchod, někdo zůstává → odcházející se rozloučí, kolega pokračuje,
    //  - jinak odcházející předá příchozímu (kdo zůstává, se jen zmíní).
    const speakers =
      stayer && !leaving.length
        ? [stayer, ...newcomers.slice(0, 1)]
        : stayer && !arriving.length
          ? [...leaver, stayer]
          : leaver.length
            ? [...leaver, ...newcomers.slice(0, 1)]
            : newcomers.slice(0, 2);
    if (!speakers.length) return false;
    this.resetDjGap();
    // Předávka kolem celé nahradí i zprávy v celou (dva vstupy za sebou by byly moc).
    const hourOf = stationClock(new Date(at.getTime() + 10 * 60_000));
    this.djHourlyKey = `${hourOf.date} ${hourOf.hour}`;
    radioLog(
      "🤖",
      c.cyan(
        `Předávka směny: ${leaving.join(", ") || "—"} → ${arriving.join(", ") || "jen hudba"}${staying.length ? ` (zůstává ${staying.join(", ")})` : ""} · mluví ${speakers.map((h) => h.name).join(" & ")}`,
      ),
    );
    void this.prepareDjFor(item, "handover", {
      hosts: speakers,
      handover: {
        leaving,
        arriving,
        staying,
        ...(early ? { at: at.toISOString() } : {}),
      },
    });
    return true;
  }

  /**
   * Každý vstup (běžný, předávka, zprávy v celou, přání) se počítá stejně:
   * počítadlo od nuly a nový rozestup — další běžný vstup až po celé mezeře.
   */
  private genreBusy = false;

  private resetDjGap(): void {
    this.djTracks = 0;
    this.djGap = this.djPlan.shift() ?? this.aiDj.nextGap();
    // V noci mluví AI méně — rozestup o 2 skladby delší.
    if (isNightHour(stationClock().hour)) this.djGap += 2;
  }

  /** Další skladba je přání posluchače → AI ho uvede mimo běžný rozestup. */
  private async maybeAnnounceRequest(current: PreparedTrack): Promise<void> {
    for (let i = 0; i < 30 && !this.next && this.started; i++) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    const next = this.next;
    if (
      !next ||
      next.source !== "request" ||
      this.djClip ||
      this.main?.uuid !== current.uuid
    )
      return;
    const req = [...this.requestLog]
      .reverse()
      .find((r) => r.uuid === next.uuid && r.status === "approved");
    // Přání s hlasovkou: pustí se hlasovka a AI pak odpoví na ni.
    if (!req || req.hasVoice) return;
    if (!this.canDjSpeak() || this.aiDj.isBusy || !this.aiDj.budget().canSpeak)
      return;
    if (!this.hasListeners()) return;
    if (!this.aiDj.hostsAt(new Date(), this.djFallbackName()).length) return;
    this.resetDjGap();
    radioLog(
      "🤖",
      c.cyan(`AI uvede přání${req.from ? ` od ${req.from}` : ""}`),
    );
    await this.prepareDjFor(current, "request");
  }

  /** Počká na připravenou další skladbu a napíše + namluví vstup k jejímu začátku. */
  private async prepareDjFor(
    current: PreparedTrack,
    focus?: AiDjFocus,
    extra?: Partial<Pick<DjContext, "hosts" | "handover" | "summary">>,
  ): Promise<void> {
    for (let i = 0; i < 30 && !this.next && this.started; i++) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    const next = this.next;
    if (!next || !this.ffmpegPath || !this.hasListeners()) return;
    try {
      const ctx = {
        ...(await this.buildDjContext(current.meta, next, focus)),
        ...extra,
      };
      const seg = await this.aiDj.createSegment(ctx, this.ffmpegPath);
      // Vstup patří jen k téhle skladbě — po skipu nebo změně fronty se nepustí.
      // Polovina krátkých vstupů začne už přes konec dohrávající skladby (zprávy ne — ty patří k celé).
      const outro =
        focus !== "hourly-news" &&
        focus !== "handover" &&
        seg.durationSec > 0 &&
        seg.durationSec <= 14 &&
        Math.random() < 0.5
          ? Math.min(8, seg.durationSec * 0.6) + getCrossfadeSec() * 0.5
          : undefined;
      this.djClip = { id: seg.id, forUuid: next.uuid, outroSec: outro };
      this.djClipLabel = seg.hosts.join(" & ") || null;
      radioLog(
        "🤖",
        c.cyan(`AI vstup připraven (${ctx.focus})`),
        seg.text.slice(0, 90),
      );
    } catch (err) {
      console.warn("[ai-dj]", err instanceof Error ? err.message : err);
    }
  }

  private async buildDjContext(
    justPlayed: RadioNowPlaying | null,
    next: PreparedTrack | null,
    forceFocus?: AiDjFocus,
    voiceReply?: { id?: string; from: string | null; text: string },
  ): Promise<DjContext> {
    const notes = (await listMessages().catch(() => []))
      .filter(
        (m) =>
          m.text &&
          !this.djUsedNotes.has(m.id) &&
          Date.now() - Date.parse(m.createdAt) < 60 * 60_000,
      )
      .slice(0, 2);
    const s = this.aiDj.config;
    const focus =
      forceFocus ??
      // Přání posluchače má vždy přednost — AI ho uvede a poděkuje.
      (next?.source === "request" ? "request" : null) ??
      pickFocus(this.djRound++, {
        news: s.news,
        weather: s.weather,
        hasNotes: notes.length > 0,
        quiz: !!next?.meta.year,
      });
    if (focus === "listeners") notes.forEach((n) => this.djUsedNotes.add(n.id));
    const req =
      next?.source === "request"
        ? [...this.requestLog]
            .reverse()
            .find((r) => r.uuid === next.uuid && r.status === "approved")
        : undefined;
    return {
      stationName: getStationConfig().name,
      hosts: this.aiDj.pickHosts(this.djFallbackName()),
      focus,
      justPlayed: justPlayed
        ? {
            artist: justPlayed.artist,
            title: justPlayed.title,
            album: justPlayed.album,
            year: justPlayed.year,
            genre: genreOf(justPlayed.uuid)?.genre ?? null,
            energy: genreOf(justPlayed.uuid)?.energy ?? null,
          }
        : null,
      next: next
        ? {
            artist: next.meta.artist,
            title: next.meta.title,
            album: next.meta.album,
            year: next.meta.year,
            genre: genreOf(next.uuid)?.genre ?? null,
            energy: genreOf(next.uuid)?.energy ?? null,
            requestFrom: req?.from,
            requestMessage: req?.message,
          }
        : null,
      listenerNotes:
        focus === "listeners"
          ? notes.map((n) => ({ id: n.id, from: n.from, text: n.text }))
          : [],
      recentHour: this.aiDj.plays
        .filter((p) => Date.now() - p.at < 3600_000)
        .reverse()
        .map(({ artist, title }) => ({ artist, title })),
      nextArtistToday: next ? this.artistPlaysToday(next.meta.artist) : 0,
      stats: {
        listeners: this.listenerCount,
        nextPlaysRecent: next
          ? this.history.filter((u) => u === next.uuid).length
          : 0,
      },
      voiceReply: voiceReply ?? null,
      upcoming: this.djUpcoming(next?.uuid ?? null),
      // Vstup k další skladbě zazní až na jejím začátku; odpověď na hlasovku hned.
      airAt: (next && !voiceReply
        ? this.nextTrackStartsAt()
        : new Date()
      ).toISOString(),
    };
  }

  getAiDjState(): AiDjState {
    return this.aiDj.state();
  }

  async setAiDjSettings(input: unknown): Promise<AiDjState> {
    const r = (input && typeof input === "object" ? input : {}) as {
      rate?: { id?: unknown; value?: unknown };
    };
    if (r.rate) {
      await this.aiDj.rate(r.rate.id, r.rate.value);
      return this.aiDj.state();
    }
    await this.aiDj.update(input);
    // Nový rozsah platí hned, ne až po dalším vstupu.
    this.djGap = null;
    this.djPlan = [];
    return this.aiDj.state();
  }

  /**
   * Studio: vstup na vyžádání. Píše se a namlouvá hned na pozadí, ale zazní až
   * mezi písničkami — na začátku té další (ne přes rozehranou skladbu).
   */
  async aiDjNow(): Promise<{ ok: boolean; error?: string; pending?: boolean }> {
    const ffmpegPath = this.ffmpegPath;
    if (!ffmpegPath) return { ok: false, error: "Chybí ffmpeg." };
    if (!this.canDjSpeak())
      return { ok: false, error: "Teď mluví moderátor nebo je pauza." };
    if (this.aiDj.isBusy)
      return { ok: false, error: "Vstup se už připravuje." };
    if (!this.aiDj.isConfigured())
      return { ok: false, error: "AI moderátor není nastavený." };
    if (!this.aiDj.hostsAt(new Date(), this.djFallbackName()).length) {
      return {
        ok: false,
        error: "Teď nemá směnu žádný AI moderátor (studio → Moderátoři).",
      };
    }
    if (this.djClip && this.djClip.forUuid === this.next?.uuid)
      return { ok: false, error: "Vstup už je připravený na další písničku." };
    // Vstup se připraví hned, ale zazní až mezi písničkami — na začátku té další.
    this.resetDjGap();
    void (async () => {
      try {
        for (let i = 0; i < 30 && !this.next && this.started; i++)
          await new Promise((r) => setTimeout(r, 2000));
        const next = this.next;
        if (!next) return;
        const ctx = await this.buildDjContext(this.nowPlaying, next);
        const seg = await this.aiDj.createSegment(ctx, ffmpegPath, true);
        if (this.next?.uuid !== next.uuid) {
          radioLog(
            "🤖",
            c.dim("AI vstup hotový, ale písnička mezitím začala — zahozen"),
          );
          return;
        }
        this.djClip = { id: seg.id, forUuid: next.uuid };
        this.djClipLabel = seg.hosts.join(" & ") || null;
        radioLog(
          "🤖",
          c.cyan("AI vstup ze studia připraven na další písničku"),
          seg.text.slice(0, 90),
        );
      } catch (err) {
        console.warn("[ai-dj]", err instanceof Error ? err.message : err);
      }
    })();
    return { ok: true, pending: true };
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

  private async getPlayableDuration(
    uuid: string,
    filepath: string,
  ): Promise<number> {
    const cached = this.durationCache.get(uuid);
    if (cached) return cached;
    let dur = 0;
    if (this.ffmpegPath) {
      dur = await probePlayableDuration(filepath, this.ffmpegPath).catch(
        () => 0,
      );
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
    const dur = analysis?.playEnd || ((await probeDuration(stingerPath)) ?? 0);
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
      for (
        let attempt = 0;
        attempt < 6 && this.started && !this.next;
        attempt++
      ) {
        if (!this.queue.length) await this.refillQueue();
        const candidate = this.takeNextCandidate();
        if (!candidate) break;

        this.preparingUuid = candidate.uuid;
        const prepared = await this.prepareTrack(
          candidate.uuid,
          candidate.source,
          0,
        );
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
            this.midsongCountdown =
              this.midsongPlan.shift() ??
              randomMidsongInterval(this.midsongConfig);
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

  /**
   * Vynuluje statistiky přehrání (počty a přeskočení, přání zůstávají) a zapomene
   * historii kromě posledních písniček — rotace pak míchá celou knihovnu rovnoměrně.
   */
  async resetPlayStats(): Promise<{ ok: true; tracks: number }> {
    let n = 0;
    for (const [id, s] of Object.entries(this.playStats)) {
      if (s.requests) this.playStats[id] = { requests: s.requests } as TrackPlayStats;
      else delete this.playStats[id];
      n++;
    }
    // Posledních 40 si nechá, ať se hned neopakuje, co právě hrálo.
    this.history = this.history.slice(0, 40);
    // Připravené pořadí rotace zahodit a namíchat znovu (přání a „zařazené“ zůstávají).
    this.queue = [];
    await this.refillQueue();
    void this.persistRotation();
    this.emitStatus(true);
    radioLog("↺", c.cyan(`Statistiky přehrání vynulovány (${n} skladeb) — rotace míchá znovu`));
    return { ok: true, tracks: n };
  }

  private async refillQueue(): Promise<void> {
    const catalog = await getCatalog();
    const current =
      this.main?.kind === "track" ? this.main.uuid : this.nowPlaying?.uuid;
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
      this.playStats,
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
      tickerMessages: this.tickerMessages,
    }).catch((err: unknown) =>
      console.warn("[radio] Uložení stavu selhalo:", err),
    );
  }

  /** Vrátí nepoužitou připravenou skladbu zpět, odkud přišla. */
  private requeue(item: PreparedTrack): void {
    if (item.offsetSec > 0) return;
    if (item.source === "rotation") this.queue.unshift(item.uuid);
    else if (item.source === "request") this.requests.unshift(item.uuid);
  }

  // ───────────────────────── ovládání ze studia ─────────────────────────

  /** Další skladba — rychlý fade, žádné ticho a žádný reconnect posluchačů. */
  /** `dislike` = moderátor ji přeskočil, protože se nehodí (ne „pustit jinou hned“). */
  skip(dislike = true): void {
    if (this.main?.kind === "bed") {
      void this.controlBreak("resume");
      return;
    }
    if (!this.main) return;
    const main = this.main;
    const playedSec = (this.frame - main.startFrame) / SAMPLE_RATE;
    // Přeskočení v první polovině = signál pro AutoDJ, ať ji dává méně.
    if (
      dislike &&
      main.kind === "track" &&
      main.uuid &&
      playedSec < main.durationSec * 0.5
    ) {
      const s = this.playStats[main.uuid];
      if (s) {
        s.skips = (s.skips ?? 0) + 1;
        radioLog(
          "⏭",
          c.dim(`Přeskočeno — AutoDJ ji bude dávat méně (${s.skips}×)`),
          main.meta?.title,
        );
      }
    }
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
      if (ok) this.skip(false);
    });
  }

  async playNext(uuid: string): Promise<boolean> {
    return this.replaceNext(uuid);
  }

  /** Přesune skladbu v rotační frontě (requesty a připravená skladba zůstávají před ní). */
  async moveInQueue(uuid: string, toIndex: number): Promise<boolean> {
    const from = this.queue.indexOf(uuid);
    if (from < 0) {
      // Skladba ve frontě není → přidat ji (studio „Přidat do fronty“).
      const catalog = await getCatalog();
      const playing =
        this.main?.kind === "track" ? this.main.uuid : this.nowPlaying?.uuid;
      if (
        !catalog.has(uuid) ||
        uuid === playing ||
        uuid === this.next?.uuid ||
        this.requests.includes(uuid)
      )
        return false;
    }
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
    const add = (
      id: string | null | undefined,
      source: QueueItemSource,
      stinger = false,
    ) => {
      if (!id) return;
      const entry = catalog.get(id);
      if (!entry) return;
      items.push({
        ...toPublic(entry, source === "request"),
        source,
        ...(stinger ? { stingerBefore: true } : {}),
      });
    };
    add(
      this.next?.uuid ?? this.preparingUuid,
      "prepared",
      Boolean(this.next?.stinger),
    );
    for (const id of this.requests) add(id, "request");
    for (const id of this.queue) add(id, "rotation");
    this.annotateStudioQueue(items);
    return items;
  }

  /**
   * Odhad do studiové fronty: kdy skladba začne, kde padne jingle a kde promluví
   * AI moderátor (a kdo, podle směn). Stejná pravidla jako engine, jen dopředu.
   */
  /** Upoutávky: přání čekající ve frontě (za další skladbou) a nejbližší změna směny do hodiny. */
  private djUpcoming(nextUuid: string | null): string[] {
    const out: string[] = [];
    const wished = this.requests
      .filter((u) => u !== nextUuid)
      .map((u) =>
        [...this.requestLog]
          .reverse()
          .find((r) => r.uuid === u && r.status === "approved"),
      )
      .filter((r): r is NonNullable<typeof r> => !!r)
      .slice(0, 2);
    for (const r of wished)
      out.push(
        `za chvíli přání${r.from ? ` od ${r.from}` : ""}: ${r.artist} — ${r.title}`,
      );
    const fallback = this.djFallbackName();
    const nowNames = this.aiDj
      .hostsAt(new Date(), fallback)
      .map((h) => h.name)
      .sort()
      .join("|");
    for (let min = 10; min <= 60; min += 5) {
      const at = new Date(Date.now() + min * 60_000);
      const names = this.aiDj.hostsAt(at, fallback).map((h) => h.name);
      if (names.slice().sort().join("|") !== nowNames) {
        const c = stationClock(at);
        const when = czechTime(c.hour, c.minute).replace(/^(Je|Jsou) /, "");
        // Konec bez nástupce se neohlašuje (moderátor se rozloučí až při předávce).
        if (names.length) out.push(`${when} přebírá ${names.join(" a ")}`);
        break;
      }
    }
    return out;
  }

  /** Statistiky dneška pro denní shrnutí. */
  private dailySummary(): NonNullable<DjContext["summary"]> {
    const today = stationClock().date;
    const plays = this.aiDj.plays.filter(
      (p) => stationClock(new Date(p.at)).date === today,
    );
    const byArtist = new Map<string, number>();
    for (const p of plays) {
      const a = p.artist.split(/,|&| feat\.?| ft\.?/i)[0]!.trim();
      byArtist.set(a, (byArtist.get(a) ?? 0) + 1);
    }
    const topArtists = [...byArtist]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .filter(([, n]) => n >= 2)
      .map(([artist, count]) => ({ artist, count }));
    const reqs = this.requestLog.filter(
      (r) =>
        (r.status === "played" || r.status === "approved") &&
        stationClock(new Date(r.createdAt)).date === today,
    );
    const byName = new Map<string, number>();
    for (const r of reqs)
      if (r.from) byName.set(r.from, (byName.get(r.from) ?? 0) + 1);
    const top = [...byName].sort((x, y) => y[1] - x[1])[0];
    return {
      tracks: plays.length,
      topArtists,
      requests: reqs.length,
      topRequester: top && top[1] >= 2 ? { name: top[0], count: top[1] } : null,
    };
  }

  /** Žánry do knihovny: po dávkách 40 skladeb, které ještě žánr nemají (AI podle interpreta a názvu). */
  private async classifyGenresTick(): Promise<void> {
    if (this.genreBusy || !this.aiDj.isConfigured()) return;
    this.genreBusy = true;
    try {
      await loadGenres();
      const missing = (await listTracks({ readyOnly: true }))
        .filter((t) => !genreOf(t.uuid))
        .slice(0, 40);
      if (!missing.length) return;
      const reply = await this.aiDj.classifyGenres(genrePrompt(missing));
      const parsed = parseGenreReply(
        reply.replace(/<think>[\s\S]*?<\/think>/g, ""),
        missing.length,
      );
      const add: Record<string, GenreInfo> = {};
      parsed.forEach((g, i) => {
        if (g) add[missing[i]!.uuid] = g;
      });
      if (Object.keys(add).length) {
        await saveGenres(add);
        radioLog(
          "🎼",
          c.dim(`žánry doplněny: ${Object.keys(add).length} skladeb`),
        );
      }
    } catch (err) {
      console.warn("[genres]", err instanceof Error ? err.message : err);
    } finally {
      this.genreBusy = false;
    }
  }

  /** Kolikrát dnes (pražský den) hrál interpret — porovnává hlavního interpreta (před „,“ / „feat“). */
  private artistPlaysToday(artist: string): number {
    const main = (a: string) =>
      a
        .toLowerCase()
        .split(/,|&| feat\.?| ft\.?| x /)[0]!
        .trim();
    const key = main(artist);
    const today = stationClock().date;
    return this.aiDj.plays.filter(
      (p) =>
        main(p.artist) === key && stationClock(new Date(p.at)).date === today,
    ).length;
  }

  /** Odhad, kdy začne další skladba (konec té současné minus přechod). */
  private nextTrackStartsAt(): Date {
    const now = Date.now();
    const elapsed = this.trackStartedAt
      ? (now - Date.parse(this.trackStartedAt)) / 1000
      : 0;
    const left = Math.max(
      0,
      (this.nowPlaying?.durationSec ?? 0) - elapsed - getCrossfadeSec(),
    );
    // + zpoždění streamu u posluchačů + vstup začíná ~1,5 s po startu skladby.
    return new Date(now + (left + this.getListenerDelaySec() + 1.5) * 1000);
  }

  private annotateStudioQueue(items: StudioQueueItem[]): void {
    const now = Date.now();
    const fade = getCrossfadeSec();
    const elapsed = this.trackStartedAt
      ? (now - Date.parse(this.trackStartedAt)) / 1000
      : 0;
    const left = Math.max(0, (this.nowPlaying?.durationSec ?? 0) - elapsed);
    let cursor = now + Math.max(0, left - fade) * 1000;

    // Jingle: songsUntilMidsong = 1 → před další skladbou; další rozestupy z předem vylosovaného plánu.
    const showStingers = this.midsongConfig.paths.length > 0;
    let stingerCounter = this.songsUntilMidsong;
    let stingerPlanAt = 0;
    const nextStingerGap = () => {
      while (this.midsongPlan.length <= stingerPlanAt)
        this.midsongPlan.push(randomMidsongInterval(this.midsongConfig));
      return this.midsongPlan[stingerPlanAt++]!;
    };

    // AI: vstup se chystá při startu skladby č. (gap − djTracks) a hraje přes tu následující.
    const s = this.aiDj.config;
    const aiOn = s.enabled && this.aiDj.isConfigured();
    this.djGap ??= this.aiDj.nextGap();
    let djPlanAt = 0;
    const nextDjGap = () => {
      while (this.djPlan.length <= djPlanAt)
        this.djPlan.push(this.aiDj.nextGap());
      return this.djPlan[djPlanAt++]!;
    };
    let aiIndex = -1;
    if (aiOn) {
      if (this.djClip && this.djClip.forUuid === items[0]?.uuid) aiIndex = 0;
      else if (this.aiDj.isBusy) aiIndex = 0;
      else aiIndex = Math.max(1, this.djGap - this.djTracks);
    }

    // Předávky směn: stejně jako handleShiftChange — směna platí na začátku skladby,
    // předávka se posune na dřívější hranici, když je změně blíž (nejvýš 15 min předem).
    const fallback = this.djFallbackName();
    let shiftNow = (this.aiDj.shiftNames() ?? this.aiDj.hostsAt(new Date(), fallback).map((h) => h.name))
      .slice()
      .sort()
      .join("|");

    items.forEach((item, i) => {
      // Stejně jako buildProgramSchedule; u připravené skladby (i = 0) platí skutečný stav.
      if (showStingers && stingerCounter === 1) {
        if (i > 0) item.stingerBefore = true;
        // +1: hned níž se odečte za tuhle skladbu (engine odečítá až u další).
        stingerCounter = nextStingerGap() + 1;
      }
      stingerCounter -= 1;
      if (item.stingerBefore) cursor += this.midsongDurationSec * 1000;
      item.startsAtMs = Math.round(cursor);
      const durMs =
        (item.durationSec && item.durationSec > 0 ? item.durationSec : 210) * 1000;
      let handover = false;
      if (aiOn) {
        let at = new Date(cursor);
        const change = this.aiDj.shiftChangeBetween(at, new Date(cursor + durMs));
        if (change) {
          const before = change.getTime() - cursor;
          if (before <= HANDOVER_QUIET_MIN * 60_000 && before < cursor + durMs - change.getTime())
            at = new Date(change.getTime() + 60_000);
        }
        const names = this.aiDj.hostsAt(at, fallback).map((h) => h.name);
        const key = names.slice().sort().join("|");
        if (key !== shiftNow) {
          const prev = shiftNow ? shiftNow.split("|") : [];
          const left = prev.filter((n) => !names.includes(n));
          const came = names.filter((n) => !prev.includes(n));
          item.handoverBefore = !came.length
            ? `${left.join(" & ")} končí`
            : !left.length
              ? `+ ${came.join(" & ")}`
              : `${left.join(" & ")} → ${came.join(" & ")}`;
          shiftNow = key;
          handover = true;
          // Předávka počítadlo vynuluje — další běžný vstup až po celé mezeře.
          aiIndex = i + nextDjGap();
        }
      }
      // 15 min před změnou směny běžný vstup nezazní (počká se na předávku).
      if (aiOn && !handover && i === aiIndex && this.aiDj.shiftChangeWithin(new Date(cursor), HANDOVER_QUIET_MIN))
        aiIndex += 1;
      if (aiOn && !handover && i === aiIndex) {
        const hosts = this.aiDj.hostsAt(
          new Date(cursor),
          this.djFallbackName(),
        );
        if (hosts.length) {
          item.aiBefore = hosts.map((h) => h.name).join(" & ");
          aiIndex += nextDjGap();
        } else {
          // Mimo směnu se nemluví — zkusí se u další skladby.
          aiIndex += 1;
        }
      }
      const dur =
        item.durationSec && item.durationSec > 0 ? item.durationSec : 210;
      cursor += Math.max(30, dur - fade) * 1000;
    });
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
        lastPlayedAt: s?.lastPlayedAt || null,
        lufs: t.mixAnalysis?.lufs ?? null,
        broken:
          this.brokenInfo[t.uuid] ??
          (failed
            ? { reason: t.error ?? "Stažení selhalo", at: t.updatedAt }
            : null),
      };
    });
    const totalPlays = Object.values(this.playStats).reduce(
      (a, s) => a + s.plays,
      0,
    );
    const libraryHours =
      tracks.reduce((a, t) => a + (t.playDuration ?? t.duration ?? 0), 0) /
      3600;
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

  /** Celá knihovna pro stránku posluchačů. */
  async getLibrary() {
    return getLibraryList(this.blockedForRequest());
  }

  async getRequestableTracks(search?: string, limit = 40) {
    return getRequestableTracks({
      search,
      limit,
      excludeUuids: this.blockedForRequest(),
    });
  }

  /**
   * Moderátor nerozhodl včas → přání se schválí samo (RADIO_REQUEST_AUTO_APPROVE_MIN).
   * Když schválit nejde (skladba hrála, plná fronta), po 30 min propadne.
   */
  private expireRequests(): void {
    const autoMs = getAutoApproveMs();
    if (autoMs) {
      const autoCutoff = Date.now() - autoMs;
      for (const r of this.requestLog) {
        if (
          r.status === "pending" &&
          !this.autoApproving.has(r.id) &&
          Date.parse(r.createdAt) < autoCutoff
        ) {
          this.autoApproving.add(r.id);
          void this.decideRequest(r.id, true, true)
            .then((res) => {
              if (res.ok)
                radioLog(
                  "✔",
                  c.cyan(
                    `Přání schváleno automaticky: ${r.artist} — ${r.title}`,
                  ),
                );
            })
            .finally(() => this.autoApproving.delete(r.id));
        }
      }
    }
    const cutoff = Date.now() - PENDING_REQUEST_TTL_MS;
    let changed = false;
    for (const r of this.requestLog) {
      if (
        r.status === "pending" &&
        !this.autoApproving.has(r.id) &&
        Date.parse(r.createdAt) < cutoff
      ) {
        r.status = "expired";
        r.decidedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) void this.persistRotation();
  }

  private autoApproving = new Set<string>();

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
    if (
      this.pendingRequests.some((r) => r.uuid === uuid) ||
      this.requests.includes(uuid)
    ) {
      return {
        ok: false,
        error: "Tuhle si už někdo přeje — počkej, až zazní.",
      };
    }
    if (this.blockedForRequest().includes(uuid)) {
      return {
        ok: false,
        error: "Tahle hrála nedávno nebo jde na řadu. Zkus jinou.",
      };
    }
    if (this.pendingRequests.length >= MAX_PENDING_REQUESTS) {
      return {
        ok: false,
        error: "Moderátor má teď hodně přání ke schválení, zkus to za chvíli.",
      };
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
      if (!this.ffmpegPath)
        return { ok: false, error: "Hlasovky teď nejdou zpracovat." };
      try {
        const saved = await saveVoiceNote(
          request.id,
          input.voice,
          this.ffmpegPath,
        );
        request.hasVoice = true;
        request.voiceSec = Math.round(saved.durationSec);
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Hlasovku se nepodařilo uložit.",
        };
      }
    }

    this.requestLog.unshift(request);
    if (this.requestLog.length > REQUEST_LOG_LIMIT) {
      this.requestLog.length = REQUEST_LOG_LIMIT;
    }
    radioLog(
      "✉",
      c.cyan(`Nové přání: ${entry.artist} — ${entry.title}`),
      [
        request.from ? `od ${request.from}` : null,
        request.hasVoice ? "s hlasovkou" : null,
        request.message ? "se vzkazem" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );

    // AI moderátor má kredity a směnu → přání se schválí hned samo
    // (sprosté jméno / vzkaz / hlasovka čeká na člověka).
    let transcript: string | null = null;
    let autoOk = !request.flagged && this.aiCanTakeRequests();
    if (autoOk && request.hasVoice) {
      transcript = await this.aiDj
        .transcribe(voiceNotePath(request.id) ?? "")
        .catch(() => null);
      autoOk = !!transcript && !censor(transcript).flagged;
    }
    if (!isRequestModerationEnabled() || autoOk) {
      const decided = await this.decideRequest(request.id, true, autoOk);
      if (!decided.ok) {
        if (!autoOk) return decided;
        // Automaticky to nešlo (plná fronta…) → necháme na moderátorovi.
        void this.persistRotation();
        this.emitStatus(true);
      } else if (autoOk) {
        radioLog(
          "✔",
          c.cyan(
            `Přání schváleno automaticky (AI): ${entry.artist} — ${entry.title}`,
          ),
        );
        this.prepareVoiceReply(request, transcript);
      }
    } else {
      void this.persistRotation();
      this.emitStatus(true);
    }
    const view = this.requestView(request);
    return {
      ok: true,
      id: request.id,
      status: view.status,
      position: view.position ?? undefined,
    };
  }

  /** AI moderátor teď může přání přijmout sám (zapnutý, má směnu a kredity na dnešek). */
  private aiCanTakeRequests(): boolean {
    const s = this.aiDj.config;
    return (
      s.enabled &&
      this.aiDj.isConfigured() &&
      this.aiDj.budget().canSpeak &&
      this.aiDj.hostsAt(new Date(), this.djFallbackName()).length > 0
    );
  }

  /** Moderátor schválí / zamítne přání. */
  async decideRequest(
    id: string,
    approve: boolean,
    auto = false,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!auto) this.expireRequests();
    const request = this.requestLog.find((r) => r.id === id);
    if (!request) return { ok: false, error: "Přání nenalezeno." };
    if (request.status !== "pending") {
      return { ok: false, error: "O tomhle přání už je rozhodnuto." };
    }

    if (approve) {
      const blocked = this.blockedForRequest(request.id);
      if (blocked.includes(request.uuid)) {
        return {
          ok: false,
          error: "Skladba mezitím hrála nebo už je ve frontě.",
        };
      }
      if (this.requests.length >= getMaxRequestQueue()) {
        return { ok: false, error: "Fronta přání je plná." };
      }
      this.requests.push(request.uuid);
      this.queue = this.queue.filter((q) => q !== request.uuid);
      // Oblíbenost — AutoDJ ji pak v běžné rotaci dává častěji.
      const stats = this.playStats[request.uuid];
      this.playStats[request.uuid] = {
        ...stats,
        plays: stats?.plays ?? 0,
        lastPlayedAt: stats?.lastPlayedAt ?? "",
        requests: (stats?.requests ?? 0) + 1,
      };
      await this.refillQueue();
    }
    request.status = approve ? "approved" : "rejected";
    request.decidedAt = new Date().toISOString();
    if (auto) request.autoApproved = true;
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
    return {
      id: r.id,
      status: r.status,
      title: r.title,
      artist: r.artist,
      position,
    };
  }

  /** Stav přání pro posluchače (jen podle id, která zná). */
  getRequestStatuses(ids: string[]): RequestStatusView[] {
    this.expireRequests();
    const wanted = new Set(ids.slice(0, 20));
    return this.requestLog
      .filter((r) => wanted.has(r.id))
      .map((r) => this.requestView(r));
  }

  /** Pro studio: čekající přání (nejstarší první) + pár posledních rozhodnutých. */
  getModerationList(): {
    pending: ListenerRequest[];
    approved: ListenerRequest[];
    recent: ListenerRequest[];
  } {
    this.expireRequests();
    return {
      pending: [...this.pendingRequests].reverse(),
      // Schválená, ještě nezazněla — v pořadí fronty, ať se moderátor může připravit.
      // (připravená další skladba už ve frontě requestů není → jde první).
      approved: this.requestLog
        .filter((r) => r.status === "approved")
        .sort(
          (a, b) =>
            this.requests.indexOf(a.uuid) - this.requests.indexOf(b.uuid),
        ),
      recent: this.requestLog
        .filter((r) => r.status !== "pending" && r.status !== "approved")
        .slice(0, 12),
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
          "-i",
          pathA,
          "-i",
          pathB,
          "-filter_complex",
          buildTransitionPreviewFilterGraph(timing.startA, durA, durB, fadeSec),
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
}

let engineInstance: RadioEngine | null = null;

export function getRadioEngine(): RadioEngine {
  if (!engineInstance) {
    engineInstance = new RadioEngine();
  }
  return engineInstance;
}
