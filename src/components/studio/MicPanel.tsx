"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRadio } from "@/components/RadioProvider";

type MicState = "off" | "connecting" | "live" | "error";

const TARGET_RATE = 44_100;
const SETTINGS_KEY = "ai-radio-mic";

const DUCK_OPTIONS: [number, string][] = [
  [-8, "Trochu (−8 dB)"],
  [-14, "Středně (−14 dB)"],
  [-20, "Hodně (−20 dB)"],
  [-60, "Úplně"],
];

function readSettings(): { duckDb: number; micGainDb: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as {
      duckDb?: number;
      micGainDb?: number;
    };
    return {
      duckDb: Number.isFinite(raw.duckDb) ? raw.duckDb! : -14,
      micGainDb: Number.isFinite(raw.micGainDb) ? raw.micGainDb! : 0,
    };
  } catch {
    return { duckDb: -14, micGainDb: 0 };
  }
}

/** Převzorkování proudu vzorků na 44.1 kHz (lineární, s přenosem mezi bloky). */
function createResampler(fromRate: number) {
  const ratio = fromRate / TARGET_RATE;
  let carry = 0;
  let phase = 1;
  return (input: Float32Array): Int16Array => {
    const data = new Float32Array(input.length + 1);
    data[0] = carry;
    data.set(input, 1);
    const out: number[] = [];
    let t = phase;
    while (t < data.length - 1) {
      const i = Math.floor(t);
      const f = t - i;
      out.push(data[i]! * (1 - f) + data[i + 1]! * f);
      t += ratio;
    }
    phase = t - input.length;
    carry = input[input.length - 1] ?? 0;
    const pcm = new Int16Array(out.length);
    for (let k = 0; k < out.length; k++) {
      const s = Math.max(-1, Math.min(1, out[k]!));
      pcm[k] = s < 0 ? s * 32768 : s * 32767;
    }
    return pcm;
  };
}

/** Jméno moderátora — posluchači ho vidí v přehrávači („Moderuje: …“). */
function ModeratorName({ current }: { current: string | null }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const value = draft ?? current ?? "";

  async function save() {
    if (draft === null || draft.trim() === (current ?? "")) return;
    setState("saving");
    try {
      const res = await fetch("/api/radio/moderator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft }),
      });
      setState(res.ok ? "saved" : "error");
      if (res.ok) setDraft(null);
    } catch {
      setState("error");
    }
  }

  return (
    <label className="mt-5 block text-xs text-[var(--ink-muted)]">
      Moderuje <span className="text-[var(--ink-faint)]">(vidí posluchači; prázdné = skrýt)</span>
      <input
        value={value}
        maxLength={40}
        placeholder="Tvoje jméno ve vysílání"
        onChange={(e) => {
          setDraft(e.target.value);
          setState("idle");
        }}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        className="mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
      />
      {state === "saved" ? <span className="mt-1 block text-[var(--ok)]">Uloženo</span> : null}
      {state === "error" ? <span className="mt-1 block text-[var(--danger)]">Nepodařilo se uložit.</span> : null}
    </label>
  );
}

export function MicPanel() {
  const { playing, pause, micLive, moderator } = useRadio();
  const [state, setState] = useState<MicState>("off");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [duckDb, setDuckDb] = useState(-14);
  const [micGainDb, setMicGainDb] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(false);
  const levelRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      const s = readSettings();
      setDuckDb(s.duckDb);
      setMicGainDb(s.micGainDb);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const sendSettings = useCallback((duck: number, gain: number) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ duckDb: duck, micGainDb: gain }));
    }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ duckDb: duck, micGainDb: gain }));
    } catch {
      // storage nedostupný
    }
  }, []);

  const stop = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setLevel(0);
    setState((s) => (s === "error" ? s : "off"));
  }, []);

  useEffect(() => stop, [stop]);

  // Měřák úrovně — aktualizace ~12× za sekundu stačí.
  useEffect(() => {
    if (state !== "live") return;
    const timer = setInterval(() => setLevel(levelRef.current), 80);
    return () => clearInterval(timer);
  }, [state]);

  async function start() {
    setError(null);
    setState("connecting");
    // Odposlech streamu by se ozýval se zpožděním do mikrofonu.
    if (playing) pause();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const res = await fetch("/api/radio/mic-ticket", { method: "POST" });
      if (!res.ok) throw new Error("Nepodařilo se získat přístup k vysílání.");
      const data = (await res.json()) as { url?: string; path?: string };
      const url =
        data.url ??
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${data.path ?? "/mic"}`;

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("Broadcaster nepřijal spojení (běží?)."));
      });
      ws.onclose = (e) => {
        if (wsRef.current !== ws) return;
        setError(
          e.code === 4000
            ? "Mikrofon převzal někdo jiný."
            : "Spojení s vysíláním se přerušilo.",
        );
        setState("error");
        stop();
      };
      sendSettings(duckDb, micGainDb);

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      const resample = createResampler(ctx.sampleRate);

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
        const rms = Math.sqrt(sum / input.length);
        levelRef.current = mutedRef.current ? 0 : rms;
        if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
        ws.send(resample(input).buffer);
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(ctx.destination);

      setState("live");
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Prohlížeč nepovolil mikrofon."
          : err instanceof Error
            ? err.message
            : "Mikrofon se nepodařilo zapnout.";
      setError(msg);
      setState("error");
      stop();
    }
  }

  function toggleMute() {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  }

  const levelDb = level > 0 ? 20 * Math.log10(level) : -90;
  const levelPct = Math.max(0, Math.min(100, ((levelDb + 60) / 60) * 100));
  const live = state === "live";

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="label">Mikrofon</h2>
        {live ? (
          <span className={`text-xs ${micLive && !muted ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"}`}>
            {muted ? "ztlumeno" : micLive ? "posluchači tě slyší" : "připojuji do mixu…"}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => (live ? stop() : void start())}
          disabled={state === "connecting"}
          className={`inline-flex h-11 items-center gap-2.5 rounded-full px-5 font-[family-name:var(--font-display)] text-sm font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 ${
            live
              ? "bg-[var(--ink)] text-[var(--bg-deep)] hover:bg-[var(--ink-muted)]"
              : "bg-[var(--accent)] text-[var(--ink)] hover:bg-[var(--accent-soft)]"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0014 0M12 18v3" />
          </svg>
          {state === "connecting" ? "Připojuji…" : live ? "Odejít z éteru" : "Do éteru"}
        </button>
        {live ? (
          <button
            type="button"
            onClick={toggleMute}
            className={`h-11 rounded-full border px-4 text-sm transition-colors ${
              muted
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-[var(--line-strong)] text-[var(--ink)] hover:border-[var(--ink)]"
            }`}
          >
            {muted ? "Zapnout mikrofon" : "Ztlumit"}
          </button>
        ) : null}
      </div>

      {live ? (
        <div className="mt-4" aria-hidden>
          <div className="h-2 bg-[var(--line)]">
            <div
              className={`h-full transition-[width] duration-75 ${levelDb > -6 ? "bg-[var(--accent)]" : "bg-[var(--ink)]"}`}
              style={{ width: `${levelPct}%` }}
            />
          </div>
        </div>
      ) : null}

      <ModeratorName current={moderator} />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-[var(--ink-muted)]">
          Hudba když mluvíš
          <select
            value={duckDb}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDuckDb(v);
              sendSettings(v, micGainDb);
            }}
            className="mt-1 block w-full border-b border-[var(--line-strong)] bg-transparent py-1 text-sm text-[var(--ink)] outline-none"
          >
            {DUCK_OPTIONS.map(([v, label]) => (
              <option key={v} value={v} className="bg-[var(--bg-panel)]">
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--ink-muted)]">
          Hlasitost hlasu {micGainDb > 0 ? "+" : ""}
          {micGainDb} dB
          <input
            type="range"
            min={-12}
            max={12}
            step={1}
            value={micGainDb}
            onChange={(e) => {
              const v = Number(e.target.value);
              setMicGainDb(v);
              sendSettings(duckDb, v);
            }}
            className="broadcast-range mt-3 block w-full"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{error}</p>
      ) : (
        <p className="mt-3 text-xs text-[var(--ink-faint)]">
          Používej sluchátka. Hudba se sama ztlumí, když mluvíš, a vrátí se po chvilce ticha.
          Posluchači tě slyší se zpožděním pár sekund.
        </p>
      )}
    </section>
  );
}
