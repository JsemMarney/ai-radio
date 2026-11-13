/** Vyhodnocení tipu na interpreta — sdílí vysílač i přehrávač (bez závislostí na Node). */

export function normArtist(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    // „The“ nikdo nepíše („Empire of Sun“ = Empire Of The Sun).
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** Tip na interpreta: celé jméno nebo kterýkoli z interpretů („Topic, A7S“ → stačí „A7S“), drobný překlep projde. */
export function artistGuessMatches(guess: string, artist: string): boolean {
  const g = normArtist(guess);
  if (g.length < 2) return false;
  const parts = [
    artist,
    ...artist.split(/\s*(?:,|&|\+|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bvs\.?|\bx\b|\band\b)\s*/i),
  ]
    .map(normArtist)
    .filter((p) => p.length >= 2);
  return parts.some(
    (p) => p === g || (p.length >= 5 && levenshtein(p, g) <= (p.length >= 10 ? 2 : 1)),
  );
}
