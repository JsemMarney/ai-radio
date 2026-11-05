"use client";

import { useEffect, useState } from "react";

const FALLBACK = "120 70 200";

/**
 * Průměrná „živá“ barva obalu jako "r g b" pro CSS (`rgb(var(--tint) / 0.3)`).
 * Šedé a skoro černé/bílé pixely se ignorují, aby záře nebyla blátivá.
 */
export function useCoverTint(src: string | null | undefined): string {
  const [tint, setTint] = useState(FALLBACK);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i];
          const pg = data[i + 1];
          const pb = data[i + 2];
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          const sat = max === 0 ? 0 : (max - min) / max;
          if (max < 40 || (max > 235 && sat < 0.15)) continue;
          const w = 0.15 + sat * sat;
          r += pr * w;
          g += pg * w;
          b += pb * w;
          weight += w;
        }
        if (!weight) return;
        // Zesvětlit tmavé obaly, ať je záře vidět.
        const boost = Math.max(1, 150 / Math.max(r / weight, g / weight, b / weight));
        const c = (v: number) => Math.min(255, Math.round((v / weight) * boost));
        setTint(`${c(r)} ${c(g)} ${c(b)}`);
      } catch {
        // obal z cizí domény bez CORS — necháme výchozí barvu
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return src ? tint : FALLBACK;
}
