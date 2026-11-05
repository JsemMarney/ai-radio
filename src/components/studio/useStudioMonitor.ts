"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MonitorState = "off" | "connecting" | "live" | "error";

/** Cílová rezerva přehrávání — menší = rychlejší odezva, větší = méně výpadků. */
const TARGET_LATENCY_SEC = 0.15;
/** Když se odposlech zpozdí víc, zahodí se zbytek a naváže se znovu na „teď“. */
const MAX_LATENCY_SEC = 0.6;

/**
 * Přímý odposlech mixu pro moderátora (bez zpoždění streamu a bez vlastního mikrofonu).
 * Broadcaster posílá mono PCM s16le přes WebSocket /monitor.
 */
export function useStudioMonitor() {
  const [state, setState] = useState<MonitorState>("off");
  const [error, setError] = useState<string | null>(null);
  /** O kolik později slyší totéž posluchači. */
  const [listenerDelaySec, setListenerDelaySec] = useState<number | null>(null);
  const [volume, setVolumeState] = useState(0.9);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const nextTimeRef = useRef(0);
  const sampleRateRef = useRef(44100);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close();
    void ctxRef.current?.close();
    ctxRef.current = null;
    gainRef.current = null;
    setState((s) => (s === "error" ? s : "off"));
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError(null);
    setState("connecting");
    try {
      // AudioContext musí vzniknout přímo z kliknutí, jinak ho prohlížeč nechá ztlumený.
      const ctx = new AudioContext({ sampleRate: 44100, latencyHint: "interactive" });
      ctxRef.current = ctx;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      gainRef.current = gain;

      const res = await fetch("/api/radio/mic-ticket", { method: "POST" });
      if (!res.ok) throw new Error("Nepodařilo se získat přístup k odposlechu.");
      const data = (await res.json()) as { monitorUrl?: string; monitorPath?: string };
      const url =
        data.monitorUrl ??
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${data.monitorPath ?? "/monitor"}`;

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      nextTimeRef.current = 0;

      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          try {
            const info = JSON.parse(e.data) as { sampleRate?: number; listenerDelaySec?: number };
            if (info.sampleRate) sampleRateRef.current = info.sampleRate;
            if (typeof info.listenerDelaySec === "number") setListenerDelaySec(info.listenerDelaySec);
          } catch {
            // neznámá zpráva
          }
          return;
        }
        const c = ctxRef.current;
        const g = gainRef.current;
        if (!c || !g) return;
        const pcm = new Int16Array(e.data as ArrayBuffer);
        if (!pcm.length) return;
        const buffer = c.createBuffer(1, pcm.length, sampleRateRef.current);
        const ch = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 32768;

        const now = c.currentTime;
        let at = nextTimeRef.current;
        // Výpadek nebo začátek → naplánovat s malou rezervou; moc velké zpoždění → dohnat.
        if (at < now || at - now > MAX_LATENCY_SEC) at = now + TARGET_LATENCY_SEC;
        const src = c.createBufferSource();
        src.buffer = buffer;
        src.connect(g);
        src.start(at);
        nextTimeRef.current = at + buffer.duration;
      };
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("Broadcaster nepřijal odposlech (běží?)."));
      });
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        setError("Odposlech se odpojil.");
        setState("error");
        stop();
      };
      if (ctx.state === "suspended") await ctx.resume();
      setState("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Odposlech se nepodařilo zapnout.");
      setState("error");
      stop();
    }
  }, [stop, volume]);

  const toggle = useCallback(() => {
    if (state === "live" || state === "connecting") stop();
    else void start();
  }, [state, start, stop]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    if (gainRef.current) gainRef.current.gain.value = v;
  }, []);

  return { state, error, listenerDelaySec, toggle, volume, setVolume };
}
