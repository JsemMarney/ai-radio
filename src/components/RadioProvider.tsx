"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BreakState,
  PlaybackSegment,
  RadioNowPlaying,
  ScheduledTrack,
} from "@/lib/types";
import { buildProgramSchedule, pickNextScheduleTrack, sliceScheduleForDisplay } from "@/lib/program-schedule";
import { STREAM_URL } from "@/lib/types";

function recentKey(tracks: RadioNowPlaying[]): string {
  return tracks.map((t) => t.uuid).join("|");
}

const VOLUME_KEY = "ai-radio-volume";
const DEFAULT_VOLUME = 0.85;

/** mp3 = plná kvalita, aac = střední, lo = úsporná (slabý signál). */
type StreamFormat = "mp3" | "aac" | "lo";
type Formats = { mp3: number; aac: number | null; lo: number | null };
export type StreamQuality = "auto" | "high" | "low";

const QUALITY_KEY = "ai-radio-quality";
const VISUALIZER_KEY = "ai-radio-visualizer";

/** Formát, který si přehrávač právě vybral (sdílí ho resolveStreamUrl). */
let activeFormat: StreamFormat = "mp3";
const streamUrlCache = new Map<StreamFormat, { url: string; expiresAt: number }>();

function withStreamCacheBust(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

function invalidateStreamUrls(): void {
  streamUrlCache.clear();
}

async function resolveStreamUrl(): Promise<string> {
  const format = activeFormat;
  const now = Math.floor(Date.now() / 1000);
  const cached = streamUrlCache.get(format);
  if (cached && cached.expiresAt > now + 120) return cached.url;

  const query = format === "mp3" ? "" : `?format=${format}`;
  const fallback = `${STREAM_URL}${query}`;
  try {
    const res = await fetch(`/api/radio/stream-url${query}`, { cache: "no-store" });
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      url?: string;
      expiresAt?: number | null;
      signed?: boolean;
    };
    if (data.url) {
      streamUrlCache.set(format, {
        url: data.url,
        expiresAt: data.signed && data.expiresAt ? data.expiresAt : now + 86400,
      });
      return data.url;
    }
  } catch {
    // fallback na přímý proxy stream
  }
  streamUrlCache.set(format, { url: fallback, expiresAt: now + 86400 });
  return fallback;
}

type NetInfo = { saveData?: boolean; effectiveType?: string };
function netInfo(): NetInfo | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: NetInfo }).connection;
}

/** Kvality, které stanice nabízí — od nejúspornější po nejlepší. */
function ladder(f: Formats): StreamFormat[] {
  const out: StreamFormat[] = [];
  if (f.lo) out.push("lo");
  if (f.aac) out.push("aac");
  out.push("mp3");
  return out;
}

/** Úvodní kvalita podle toho, co prohlížeč ví o připojení (pak se ladí za běhu). */
function initialFormat(levels: StreamFormat[]): StreamFormat {
  if (typeof window === "undefined") return "mp3";
  const conn = netInfo();
  const lowest = levels[0]!;
  const mid = levels.includes("aac") ? "aac" : lowest;
  if (conn?.saveData || (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType))) return lowest;
  if (conn?.effectiveType === "3g") return mid;
  // Telefon: střední AAC (zní skoro stejně a šetří data).
  if (window.matchMedia?.("(pointer: coarse)").matches) return mid;
  return "mp3";
}

/** Za jak dlouho bez problémů zkusit vyšší kvalitu (prodlužuje se, když to nevyjde). */
let upgradeWaitMs = 3 * 60_000;

/** Kvalitu volí přehrávač sám — staré ruční nastavení se zahodí. */
function readStoredQuality(): StreamQuality {
  if (typeof window === "undefined") return "auto";
  try {
    localStorage.removeItem(QUALITY_KEY);
  } catch {
    // storage nedostupný
  }
  return "auto";
}

/** Posuvník je lineární, ucho ne — kvadratická křivka dá přirozené ztlumení. */
function toGain(volume: number): number {
  return volume * volume;
}

function readStoredVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw == null) return DEFAULT_VOLUME;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_VOLUME;
}

type ConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "offline";

type RadioContextValue = {
  playing: boolean;
  nowPlaying: RadioNowPlaying | null;
  trackStartedAt: string | null;
  recentlyPlayed: RadioNowPlaying[];
  listeners: number;
  broadcasting: boolean;
  stationOnline: boolean;
  queueRemaining: number;
  upcoming: RadioNowPlaying[];
  schedule: ScheduledTrack[];
  nextUp: ScheduledTrack | null;
  segment: PlaybackSegment;
  crossfadeSec: number;
  streamUrl: string;
  shareUrl: string;
  connection: ConnectionState;
  error: string | null;
  statusReady: boolean;
  volume: number;
  setVolume: (value: number) => void;
  quality: StreamQuality;
  setQuality: (value: StreamQuality) => void;
  /** Vizualizér pruhů na pozadí (zapnutý/vypnutý posluchačem). */
  visualizer: boolean;
  setVisualizer: (on: boolean) => void;
  /** Analyzér zvuku pro vizualizér (null = nejde napojit → jen klidná animace). */
  getAnalyser: () => AnalyserNode | null;
  /** Co se právě přehrává — např. "AAC 96 kbps". */
  streamLabel: string;
  aacAvailable: boolean;
  /** Moderátor mluví do vysílání. */
  micLive: boolean;
  /** Přání čekající na moderátora (pro studio). */
  moderationPending: number;
  breakState: BreakState;
  bed: string;
  bedLevelDb: number;
  /** Jméno moderátora (null = nezobrazovat). */
  moderator: string | null;
  /** Moderátor se nedávno ozval — jinak posluchači vidí AutoDJ. */
  moderatorOnAir: boolean;
  /** AI moderátor(ři) se směnou — null = AutoDJ. */
  aiHost: string | null;
  /** Vlastní texty do běžícího pruhu. */
  tickerMessages: string[];
  play: () => void;
  pause: () => void;
  toggle: () => void;
  reconnect: () => void;
};

const RadioContext = createContext<RadioContextValue | null>(null);

type StatusPayload = {
  nowPlaying?: RadioNowPlaying | null;
  trackStartedAt?: string | null;
  recentlyPlayed?: RadioNowPlaying[];
  listeners?: number;
  broadcasting?: boolean;
  queueRemaining?: number;
  sessionId?: string | null;
  upcoming?: RadioNowPlaying[];
  schedule?: ScheduledTrack[];
  nextUp?: ScheduledTrack | null;
  segment?: PlaybackSegment;
  crossfadeSec?: number;
  streamEpoch?: number;
  songsUntilMidsong?: number;
  midsongDurationSec?: number;
  midsongConfigured?: boolean;
  midsongMinTracks?: number;
  midsongMaxTracks?: number;
  formats?: { mp3: number; aac: number | null; lo?: number | null };
  micLive?: boolean;
  moderationPending?: number;
  breakState?: BreakState;
  bed?: string;
  bedLevelDb?: number;
  moderator?: string | null;
  moderatorOnAir?: boolean;
  aiHost?: string | null;
  tickerMessages?: string[];
};

const CONNECTION_DEBOUNCE_MS = 800;

export function RadioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graphRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; gain: GainNode } | null>(null);
  /** Poslední hlasitost (0–1 gain) — po napojení analyzéru se přesune z <audio> do GainNode. */
  const gainRef = useRef(1);
  /**
   * Hlasitost: bez analyzéru na <audio>, s analyzérem až za ním (GainNode) —
   * vizualizér pak vidí plný signál a nereaguje na posuvník hlasitosti.
   */
  const applyGain = useCallback((gain: number) => {
    gainRef.current = gain;
    const el = audioRef.current;
    const graph = graphRef.current;
    if (graph) {
      graph.gain.gain.value = gain;
      if (el) el.volume = 1;
    } else if (el) {
      el.volume = gain;
    }
  }, []);
  const [visualizer, setVisualizerState] = useState(true);
  useEffect(() => {
    // Až po hydrataci (server neví, co je v localStorage).
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem(VISUALIZER_KEY) === "0") setVisualizerState(false);
      } catch {
        // storage nedostupný
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  /**
   * Napojí <audio> na Web Audio analyzér — jen po kliknutí (jinak je AudioContext uspaný)
   * a jen u streamu ze stejného originu (cizí bez CORS by zněl jako ticho).
   * Na iOS ne — tam MediaElementSource u živého streamu umí ztlumit zvuk.
   */
  const ensureGraph = useCallback(() => {
    const el = audioRef.current;
    if (!el || typeof window === "undefined") return;
    if (graphRef.current) {
      void graphRef.current.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return;
    try {
      const src = el.currentSrc || el.src;
      if (src && new URL(src, location.href).origin !== location.origin) return;
      const ctx = new AC();
      const source = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      source.connect(analyser);
      const gain = ctx.createGain();
      analyser.connect(gain);
      gain.connect(ctx.destination);
      graphRef.current = { ctx, analyser, gain };
      applyGain(gainRef.current);
      void ctx.resume().catch(() => {});
    } catch {
      // nejde napojit — vizualizér pojede jen naprázdno
    }
  }, [applyGain]);

  const getAnalyser = useCallback(() => graphRef.current?.analyser ?? null, []);

  const setVisualizer = useCallback(
    (on: boolean) => {
      setVisualizerState(on);
      try {
        localStorage.setItem(VISUALIZER_KEY, on ? "1" : "0");
      } catch {
        // storage nedostupný
      }
      if (on && audioRef.current && !audioRef.current.paused) ensureGraph();
    },
    [ensureGraph],
  );
  const recentKeyRef = useRef("");
  const trackUuidRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [statusReady, setStatusReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<RadioNowPlaying | null>(null);
  const [trackStartedAt, setTrackStartedAt] = useState<string | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<RadioNowPlaying[]>([]);
  const [listeners, setListeners] = useState(0);
  const [broadcasting, setBroadcasting] = useState(false);
  const [stationOnline, setStationOnline] = useState(false);
  const [queueRemaining, setQueueRemaining] = useState(0);
  const [upcoming, setUpcoming] = useState<RadioNowPlaying[]>([]);
  const [schedule, setSchedule] = useState<ScheduledTrack[]>([]);
  const [nextUp, setNextUp] = useState<ScheduledTrack | null>(null);
  const [segment, setSegment] = useState<PlaybackSegment>("song");
  const [crossfadeSec, setCrossfadeSec] = useState(6);
  const [songsUntilMidsong, setSongsUntilMidsong] = useState(4);
  const [midsongDurationSec, setMidsongDurationSec] = useState(6);
  const [midsongConfigured, setMidsongConfigured] = useState(false);
  const [midsongMinTracks, setMidsongMinTracks] = useState(3);
  const [midsongMaxTracks, setMidsongMaxTracks] = useState(6);
  const [streamUrl, setStreamUrl] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [micLive, setMicLive] = useState(false);
  const [moderationPending, setModerationPending] = useState(0);
  const [breakState, setBreakState] = useState<BreakState>("none");
  const [bed, setBed] = useState("builtin");
  const [bedLevelDb, setBedLevelDb] = useState(-10);
  const [moderator, setModerator] = useState<string | null>(null);
  const [moderatorOnAir, setModeratorOnAir] = useState(false);
  const [aiHost, setAiHost] = useState<string | null>(null);
  const [tickerMessages, setTickerMessages] = useState<string[]>([]);
  const [quality, setQualityState] = useState<StreamQuality>("auto");
  const [formats, setFormats] = useState<Formats>({ mp3: 0, aac: null, lo: null });
  const [format, setFormatState] = useState<StreamFormat>("mp3");

  const setVolume = useCallback((value: number) => {
    const next = Math.min(1, Math.max(0, value));
    setVolumeState(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(VOLUME_KEY, String(next));
      // Poslední nenulová hlasitost — na ni se vrátí odtlumení.
      if (next > 0) localStorage.setItem(`${VOLUME_KEY}-last`, String(next));
    }
    if (audioRef.current) {
      applyGain(toGain(next));
    }
  }, [applyGain]);

  // Hlasitost z posuvníku platí vždy — i po načtení uložené hodnoty a před startem.
  useEffect(() => {
    if (audioRef.current) applyGain(toGain(volume));
  }, [volume, applyGain]);

  const applyStatus = useCallback((data: StatusPayload) => {
    if (data.sessionId !== undefined && data.sessionId !== sessionIdRef.current) {
      const hadSession = sessionIdRef.current !== null;
      sessionIdRef.current = data.sessionId;
      if (hadSession && data.sessionId) {
        setError("Stanice restartovala — připojuji znovu…");
        const el = audioRef.current;
        if (el && !el.paused) {
          void resolveStreamUrl().then((url) => {
            el.src = url;
            el.load();
            void el.play().catch(() => {});
          });
        }
      }
    } else if (data.sessionId !== undefined) {
      sessionIdRef.current = data.sessionId;
    }

    if (data.nowPlaying !== undefined) {
      const nextUuid = data.nowPlaying?.uuid ?? null;
      if (nextUuid !== trackUuidRef.current) {
        trackUuidRef.current = nextUuid;
        setNowPlaying(data.nowPlaying);
      }
    }

    if (data.trackStartedAt !== undefined) {
      setTrackStartedAt((prev) =>
        data.trackStartedAt === prev ? prev : data.trackStartedAt ?? null,
      );
    }

    const recent = data.recentlyPlayed ?? [];
    const key = recentKey(recent);
    if (key !== recentKeyRef.current) {
      recentKeyRef.current = key;
      setRecentlyPlayed(recent);
    }

    if (data.listeners !== undefined) setListeners(data.listeners);
    if (data.broadcasting !== undefined) setBroadcasting(data.broadcasting);
    if (data.queueRemaining !== undefined) setQueueRemaining(data.queueRemaining);
    if (data.upcoming !== undefined) setUpcoming(data.upcoming);
    if (data.segment !== undefined) setSegment(data.segment);
    if (data.crossfadeSec !== undefined) setCrossfadeSec(data.crossfadeSec);
    if (data.songsUntilMidsong !== undefined) {
      setSongsUntilMidsong(data.songsUntilMidsong);
    }
    if (data.midsongDurationSec !== undefined) {
      setMidsongDurationSec(data.midsongDurationSec);
    }
    if (data.midsongConfigured !== undefined) {
      setMidsongConfigured(data.midsongConfigured);
    }
    if (data.midsongMinTracks !== undefined) {
      setMidsongMinTracks(data.midsongMinTracks);
    }
    if (data.midsongMaxTracks !== undefined) {
      setMidsongMaxTracks(data.midsongMaxTracks);
    }
    if (data.micLive !== undefined) setMicLive(data.micLive);
    if (data.moderationPending !== undefined) setModerationPending(data.moderationPending);
    if (data.breakState !== undefined) setBreakState(data.breakState);
    if (data.bed !== undefined) setBed(data.bed);
    if (data.bedLevelDb !== undefined) setBedLevelDb(data.bedLevelDb);
    if (data.moderator !== undefined) setModerator(data.moderator);
    if (data.moderatorOnAir !== undefined) setModeratorOnAir(data.moderatorOnAir);
    if (data.aiHost !== undefined) setAiHost(data.aiHost);
    if (data.tickerMessages !== undefined) setTickerMessages(data.tickerMessages);
    if (data.formats) {
      const f = { mp3: data.formats.mp3, aac: data.formats.aac, lo: data.formats.lo ?? null };
      setFormats((prev) =>
        prev.mp3 === f.mp3 && prev.aac === f.aac && prev.lo === f.lo ? prev : f,
      );
    }
  }, []);

  useEffect(() => {
    // Až po mountu — localStorage na serveru není (a hydratace musí sedět).
    const restore = setTimeout(() => {
      setVolumeState(readStoredVolume());
      setQualityState(readStoredQuality());
      setShareUrl(`${window.location.origin}/player`);
    }, 0);

    void resolveStreamUrl().then((url) => {
      setStreamUrl(url);
    });

    void fetch("/api/radio/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        applyStatus(data as StatusPayload);
        setStatusReady(true);
      })
      .catch(() => setStatusReady(true));
    return () => clearTimeout(restore);
  }, [applyStatus]);

  useEffect(() => {
    const recompute = () => {
      const live = buildProgramSchedule({
        nowPlaying,
        trackStartedAt,
        upcoming,
        crossfadeSec,
        songsUntilMidsong,
        stingerEveryAvg: (midsongMinTracks + midsongMaxTracks) / 2,
        stingerSec: midsongDurationSec,
        showStingers: midsongConfigured,
        stingerLabel: "Jingle",
      });
      setSchedule(sliceScheduleForDisplay(live, 5));
      setNextUp(pickNextScheduleTrack(live));
    };

    const first = setTimeout(recompute, 0);
    const timer = setInterval(recompute, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [
    nowPlaying,
    trackStartedAt,
    upcoming,
    crossfadeSec,
    songsUntilMidsong,
    midsongDurationSec,
    midsongConfigured,
    midsongMinTracks,
    midsongMaxTracks,
  ]);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es?.close();
      es = new EventSource("/api/radio/events");

      es.onopen = () => {
        setStationOnline(true);
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          applyStatus(JSON.parse(event.data) as StatusPayload);
        } catch {
          // ignore malformed
        }
      };

      es.onerror = () => {
        setStationOnline(false);
        es?.close();
        es = null;
        reconnectTimer = setTimeout(connect, 4000);
      };
    };

    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [applyStatus]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    let connectionTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;

    const setConnectionSoon = (state: ConnectionState) => {
      if (connectionTimer) clearTimeout(connectionTimer);
      if (state === "live" || state === "idle") {
        setConnection(state);
        return;
      }
      connectionTimer = setTimeout(() => setConnection(state), CONNECTION_DEBOUNCE_MS);
    };

    const scheduleRetry = () => {
      if (retryTimer) return;
      const delay = Math.min(30_000, 2000 * 2 ** retryAttempt);
      retryAttempt += 1;
      setConnectionSoon("reconnecting");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (el.paused) return;
        void resolveStreamUrl().then((url) => {
          el.src = withStreamCacheBust(url);
          el.load();
          void el.play().catch(() => scheduleRetry());
        });
      }, delay);
    };

    const onPlay = () => {
      setPlaying(true);
      setConnection("live");
      setError(null);
      retryAttempt = 0;
    };
    const onPause = () => {
      setPlaying(false);
      setConnection("idle");
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (connectionTimer) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
      }
    };
    const onWaiting = () => setConnectionSoon("connecting");
    const onPlaying = () => {
      setConnection("live");
      setError(null);
      retryAttempt = 0;
      if (connectionTimer) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
      }
    };
    const onStalled = () => setConnectionSoon("reconnecting");
    const onError = () => {
      setError("Stream offline — zkouším znovu…");
      scheduleRetry();
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("stalled", onStalled);
    el.addEventListener("error", onError);
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (connectionTimer) clearTimeout(connectionTimer);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("stalled", onStalled);
      el.removeEventListener("error", onError);
    };
  }, []);

  const connectStream = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return false;
    setConnection("connecting");
    const url = await resolveStreamUrl();
    setStreamUrl(url);
    el.src = url;
    el.load();
    return true;
  }, []);

  const play = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    // Start s ztlumeným posuvníkem by vypadal jako nefunkční rádio.
    if (volume < 0.05) setVolume(DEFAULT_VOLUME);
    applyGain(toGain(volume < 0.05 ? DEFAULT_VOLUME : volume));
    void connectStream().then((ok) => {
      if (!ok) return;
      if (visualizer) ensureGraph();
      else void graphRef.current?.ctx.resume().catch(() => {});
      void el.play().catch(() => {
        setError("Přehrávání zablokováno prohlížečem. Klikni znovu.");
        setConnection("idle");
      });
    });
  }, [connectStream, volume, setVolume, visualizer, ensureGraph, applyGain]);

  /**
   * Přepne kvalitu (nebo jen znovu připojí). `burstSec` = kolik sekund si přehrávač
   * řekne hned — při změně kvality tolik, kolik má v zásobě, ať hudba navazuje.
   */
  const switchFormat = useCallback((next: StreamFormat, burstSec?: number) => {
    activeFormat = next;
    setFormatState(next);
    const el = audioRef.current;
    if (!el || el.paused) return;
    void resolveStreamUrl().then((url) => {
      setStreamUrl(url);
      const burst =
        burstSec !== undefined ? `&burst=${Math.max(1, Math.min(burstSec, 20)).toFixed(1)}` : "";
      el.src = `${withStreamCacheBust(url)}${burst}`;
      el.load();
      void el.play().catch(() => {});
    });
  }, []);

  // Kvalita podle nastavení a toho, co stanice umí (auto: start podle připojení).
  const formatsReady = formats.mp3 > 0;
  useEffect(() => {
    if (!formatsReady) return;
    const levels = ladder(formats);
    const target =
      quality === "high"
        ? "mp3"
        : quality === "low"
          ? levels[0]!
          : levels.includes(activeFormat) && audioRef.current && !audioRef.current.paused
            ? activeFormat
            : initialFormat(levels);
    if (target !== activeFormat) switchFormat(target);
    else setFormatState(target);
  }, [formatsReady, formats, quality, switchFormat]);

  // Automatika za běhu: hlídá zásobu přehrávače a zaseknutí.
  //  - zásoba dlouho pod 2,5 s nebo zaseknutí > 1,5 s → nižší kvalita,
  //  - zaseknuté víc než 8 s (spojení umřelo) → znovu připojit,
  //  - pár minut bez problémů → zkusit vyšší kvalitu.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !playing) return;
    const levels = ladder(formats);
    const auto = quality === "auto";
    let lastSwitch = Date.now();
    let lastUpgrade = 0;
    let goodSince = Date.now();
    let lowSince = 0;
    let stallStart = 0;
    let bufferedWorks = false;

    const ahead = () => {
      const b = el.buffered;
      return b.length ? b.end(b.length - 1) - el.currentTime : 0;
    };
    const step = (dir: -1 | 1) => {
      const i = levels.indexOf(activeFormat);
      const next = levels[i + dir];
      if (!auto || i < 0 || !next) return false;
      if (dir < 0 && Date.now() - lastUpgrade < 90_000) {
        // Vyšší kvalita nevydržela → příště čekat déle (max. 30 min).
        upgradeWaitMs = Math.min(upgradeWaitMs * 2, 30 * 60_000);
      }
      if (dir > 0) lastUpgrade = Date.now();
      switchFormat(next, ahead());
      lastSwitch = Date.now();
      goodSince = Date.now();
      lowSince = 0;
      return true;
    };
    const reconnectNow = () => {
      stallStart = 0;
      lastSwitch = Date.now();
      switchFormat(activeFormat);
    };

    const onWaiting = () => {
      if (!stallStart) stallStart = Date.now();
    };
    const onPlaying = () => {
      const stalled = stallStart ? Date.now() - stallStart : 0;
      stallStart = 0;
      if (stalled > 1500 && Date.now() - lastSwitch > 10_000) step(-1);
    };
    const onOnline = () => {
      if (stallStart) reconnectNow();
    };

    const timer = setInterval(() => {
      if (el.paused) return;
      const now = Date.now();
      if (stallStart && now - stallStart > 8_000) {
        // Spojení se po výpadku samo neobnoví — připojit znovu (a radši níž).
        if (!step(-1)) reconnectNow();
        return;
      }
      const a = ahead();
      if (a > 3) bufferedWorks = true;
      if (!bufferedWorks || now - lastSwitch < 12_000) return;
      if (a < 2.5) {
        lowSince ||= now;
        if (now - lowSince > 4_000) step(-1);
      } else {
        lowSince = 0;
      }
      if (a < 5) goodSince = now;
      if (now - goodSince > upgradeWaitMs && !netInfo()?.saveData) step(1);
    }, 2_000);

    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(timer);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      window.removeEventListener("online", onOnline);
    };
  }, [playing, formats, quality, switchFormat]);

  const setQuality = useCallback((value: StreamQuality) => {
    setQualityState(value);
    try {
      localStorage.setItem(QUALITY_KEY, value);
    } catch {
      // storage nedostupný
    }
  }, []);

  const streamLabel =
    format === "lo" && formats.lo
      ? `AAC ${formats.lo} kbps`
      : format === "aac" && formats.aac
        ? `AAC ${formats.aac} kbps`
        : formats.mp3
          ? `MP3 ${formats.mp3} kbps`
          : "";

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    play();
  }, [play]);

  const reconnect = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    setError(null);
    setConnection("reconnecting");
    el.pause();
    invalidateStreamUrls();
    void resolveStreamUrl().then((url) => {
      setStreamUrl(url);
      el.src = withStreamCacheBust(url);
      el.load();
      void el.play().catch(() => {
        setError("Broadcaster neběží. Spusť start.bat.");
        setConnection("offline");
      });
    });
  }, []);

  return (
    <RadioContext.Provider
      value={{
        playing,
        nowPlaying,
        trackStartedAt,
        recentlyPlayed,
        listeners,
        broadcasting,
        stationOnline,
        queueRemaining,
        upcoming,
        schedule,
        nextUp,
        segment,
        crossfadeSec,
        streamUrl,
        shareUrl,
        connection,
        error,
        statusReady,
        volume,
        setVolume,
        quality,
        setQuality,
        visualizer,
        setVisualizer,
        getAnalyser,
        streamLabel,
        aacAvailable: formats.aac !== null,
        micLive,
        moderationPending,
        breakState,
        bed,
        bedLevelDb,
        moderator,
        moderatorOnAir,
        aiHost,
        tickerMessages,
        play,
        pause,
        toggle,
        reconnect,
      }}
    >
      {children}
      <audio ref={audioRef} preload="none" />
    </RadioContext.Provider>
  );
}

export function useRadio(): RadioContextValue {
  const ctx = useContext(RadioContext);
  if (!ctx) {
    throw new Error("useRadio must be used within RadioProvider");
  }
  return ctx;
}
