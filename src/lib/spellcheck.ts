import { fork } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import nspell from "nspell";

/**
 * Kontrola českých slov slovníkem (Hunspell cs, config/dict).
 *
 * Slovník zabere ~400 MB a načítá se ~4 s, takže běží v krátkém podprocesu:
 * hlavní proces (mixuje zvuk) se nezasekne a paměť se po kontrole hned vrátí.
 */

const TIMEOUT_MS = 25_000;

function dictDir(): string {
  return path.join(process.cwd(), "config", "dict");
}

/** Hovorové tvary, které slovník nezná („dobrej“ → „dobrý“, „hejbe“ → „hýbe“). */
function variants(word: string): string[] {
  return [
    word,
    word.replace(/ej$/, "ý"),
    word.replace(/ejch$/, "ých"),
    word.replace(/ejm$/, "ým"),
    word.replace(/ej/g, "ý"),
    word.replace(/ý/g, "ej"),
    word.replace(/^vo/, "o"),
  ];
}

/** Běží v podprocesu: načte slovník, vrátí neznámá slova a skončí. */
export function runSpellcheckChild(): void {
  process.once("message", (msg: unknown) => {
    try {
      const words = Array.isArray(msg) ? (msg as string[]) : [];
      const dir = dictDir();
      const spell = nspell(readFileSync(path.join(dir, "cs.aff")), readFileSync(path.join(dir, "cs.dic")));
      const unknown = words.filter((w) => !variants(w).some((v) => spell.correct(v)));
      process.send?.({ unknown }, () => process.exit(0));
    } catch (err) {
      process.send?.({ error: err instanceof Error ? err.message : String(err) }, () => process.exit(0));
    }
  });
}

/** Slova k ověření: malým písmenem (velká = jména), jen písmena, aspoň 3 znaky. */
export function wordsToCheck(text: string, skip: string): string[] {
  const known = new Set(skip.toLowerCase().split(/[^\p{L}]+/u));
  const out = new Set<string>();
  for (const raw of text.replace(/\[[^\]]*\]/g, " ").split(/[^\p{L}-]+/u)) {
    const w = raw.replace(/^-+|-+$/g, "");
    if (w.length < 3 || !/^\p{Ll}[\p{Ll}-]*$/u.test(w)) continue;
    if (known.has(w)) continue;
    out.add(w);
  }
  return [...out];
}

/**
 * Vrátí slova, která čeština nezná. Při chybě (chybí slovník, timeout, AI_DJ_SPELLCHECK=0)
 * vrací prázdné pole — kontrola se jen přeskočí.
 */
export async function unknownWords(words: string[]): Promise<string[]> {
  if (!words.length || process.env.AI_DJ_SPELLCHECK === "0") return [];
  const entry = process.argv[1];
  if (!entry) return [];
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      resolve(v);
    };
    const child = fork(entry, ["--spellcheck"], {
      execArgv: [...process.execArgv, "--max-old-space-size=600"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const timer = setTimeout(() => finish([]), TIMEOUT_MS);
    child.on("message", (msg: { unknown?: string[]; error?: string }) => {
      if (msg.error) console.warn("[spellcheck]", msg.error);
      finish(msg.unknown ?? []);
    });
    child.on("error", () => finish([]));
    child.on("exit", () => finish([]));
    child.send(words);
  });
}
