/** Čistá matematika fade — bez Node závislostí (bezpečné pro client bundle). */

export function computePairFade(
  durA: number,
  durB: number,
  fadeSec: number,
): number {
  return Math.max(
    0,
    Math.min(fadeSec, durA * 0.35, durB * 0.35, durA - 0.25, durB - 0.25),
  );
}

export function computeTailFade(dur: number, fadeSec: number): number {
  return Math.max(0, Math.min(fadeSec, dur * 0.35, dur - 0.25));
}

export function pairCrossfadeStartSec(
  durA: number,
  durB: number,
  fadeSec: number,
): number {
  const fade = computePairFade(durA, durB, fadeSec);
  return Math.max(0, durA - fade);
}
