"use client";

import { useEffect, useRef, useState } from "react";

const MAX_SEC = 30;

export type RecordedVoice = { base64: string; url: string; sec: number };

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Krátká hlasovka k přání (max. 30 s) — nahrání v prohlížeči, poslech, smazání. */
export function VoiceRecorder({
  value,
  onChange,
}: {
  value: RecordedVoice | null;
  onChange: (voice: RecordedVoice | null) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "error">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function start() {
    setError(null);
    const mimeType = pickMime();
    if (!navigator.mediaDevices?.getUserMedia || mimeType === undefined) {
      setError("Tenhle prohlížeč nahrávání neumí.");
      setState("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        const sec = Math.min(MAX_SEC, Math.round((Date.now() - startedAt) / 1000));
        const blob = new Blob(chunks, { type: mimeType });
        setState("idle");
        if (sec < 1 || blob.size < 1000) {
          setError("Nahrávka je moc krátká.");
          return;
        }
        onChange({ base64: await blobToBase64(blob), url: URL.createObjectURL(blob), sec });
      };
      recorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      setState("recording");
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(s);
        if (s >= MAX_SEC && recorder.state === "recording") recorder.stop();
      }, 250);
    } catch {
      setError("Prohlížeč nepovolil mikrofon.");
      setState("error");
    }
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function remove() {
    if (value) URL.revokeObjectURL(value.url);
    onChange(null);
  }

  return (
    <div className="text-xs text-[var(--ink-muted)]">
      <p>
        Hlasovka <span className="text-[var(--ink-faint)]">(nepovinné, max. {MAX_SEC} s)</span>
      </p>
      {value ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <audio src={value.url} controls preload="metadata" className="h-9 max-w-full" />
          <span className="font-[family-name:var(--font-mono)]">{value.sec} s</span>
          <button type="button" onClick={remove} className="hover:text-[var(--ink)]">
            Smazat
          </button>
        </div>
      ) : state === "recording" ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="live-mic h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-hidden />
          <span className="font-[family-name:var(--font-mono)] text-[var(--ink)]">
            0:{String(seconds).padStart(2, "0")} / 0:{MAX_SEC}
          </span>
          <button
            type="button"
            onClick={stop}
            className="rounded-full bg-[var(--ink)] px-4 py-1.5 text-sm text-[var(--bg-deep)]"
          >
            Hotovo
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--line-strong)] px-4 text-sm text-[var(--ink)] transition-colors hover:border-[var(--accent)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0014 0M12 18v3" />
          </svg>
          Nahrát hlasovku
        </button>
      )}
      {error ? <p className="mt-2 text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
