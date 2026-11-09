"use client";

import { useEffect, useRef } from "react";
import { useRadio } from "@/components/RadioProvider";

const BARS = 72;

/**
 * Pruhy spektra u spodního okraje stránky, za obsahem. Kreslí z Web Audio analyzéru;
 * když ho nejde napojit, jen klidně „dýchá“. Když hudba nehraje, pruhy spadnou.
 */
export function AudioVisualizer() {
  const { visualizer, playing, getAnalyser } = useRadio();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!visualizer) return;
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const heights = new Float32Array(BARS);
    let data: Uint8Array<ArrayBuffer> | null = null;
    let raf = 0;
    let colors = { a: "#ff3d6e", b: "#ffb347" };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      const css = getComputedStyle(document.documentElement);
      colors = {
        a: css.getPropertyValue("--accent").trim() || colors.a,
        b: css.getPropertyValue("--accent-2").trim() || colors.b,
      };
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const analyser = getAnalyser();
      const live = playingRef.current;
      if (analyser && live) {
        if (!data || data.length !== analyser.frequencyBinCount) data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
      }
      const w = canvas.width;
      const h = canvas.height;
      g.clearRect(0, 0, w, h);

      // Zrcadlově od středu: basy uprostřed, výšky do stran.
      const half = BARS / 2;
      for (let i = 0; i < BARS; i++) {
        const k = Math.abs(i - half + 0.5) / half; // 0 střed … 1 kraj
        let target = 0;
        if (live) {
          if (analyser && data) {
            // Logaritmicky přes slyšitelné pásmo (nad ~60 % binů je u MP3 skoro ticho),
            // výšky zesílené — ať skáčou i krajní pruhy, ne jen basy uprostřed.
            const lo = 1;
            const hi = data.length * 0.6;
            const pos = lo * Math.pow(hi / lo, k);
            const a = Math.floor(pos);
            const b = Math.min(data.length - 1, Math.max(a + 1, Math.floor(pos * 1.15)));
            let peak = 0;
            for (let j = a; j <= b; j++) peak = Math.max(peak, data[j]!);
            const raw = (peak / 255) * (1 + k * 0.8);
            // Odečíst „podlahu“ a roztáhnout — víc kontrastu, pruhy poskakují.
            // Měkká křivka místo tvrdého stropu — hlasité pruhy se k vršku jen blíží, neusekne je to do stejné výšky.
            target = 1 - Math.exp(-2 * Math.pow(Math.max(0, raw - 0.2) / 0.8, 1.3));
          } else if (!reduced) {
            target = 0.25 + 0.2 * Math.sin(t / 700 + i * 0.45) * Math.sin(t / 1300 + i * 0.17);
          } else {
            target = 0.2;
          }
        }
        // Rychle nahoru, pomalu dolů.
        heights[i] = heights[i]! + (target - heights[i]!) * (target > heights[i]! ? 0.25 : 0.06);
      }

      const gap = Math.max(2, w / BARS / 4);
      const bw = Math.max(1, w / BARS - gap);
      const grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, colors.a);
      grad.addColorStop(1, colors.b);
      g.fillStyle = grad;
      for (let i = 0; i < BARS; i++) {
        const bh = Math.max(2, heights[i]! * h * 0.95);
        const x = i * (bw + gap) + gap / 2;
        const r = Math.max(0, Math.min(bw / 2, 6));
        g.beginPath();
        g.roundRect(x, h - bh, bw, bh + r, r);
        g.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [visualizer, getAnalyser]);

  if (!visualizer) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 z-0 h-[35vh] w-full opacity-30 [mask-image:linear-gradient(to_top,black_30%,transparent)]"
    />
  );
}
