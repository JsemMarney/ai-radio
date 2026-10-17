/**
 * Jednoduchý filtr sprostých slov (CZ + EN) pro vzkazy posluchačů.
 * Nehledá dokonalost — moderátor stejně každé přání schvaluje. Jen
 * zabrání tomu, aby se nadávka objevila v přehrávači nebo ve studiu naplno.
 */

const ROOTS = [
  // čeština / slovenština
  "kurv", "zkurv", "picus", "picovin", "kokot", "curak", "zmrd", "mrd",
  "srac", "hovn", "prdel", "sukat", "sukan", "osuk", "vysuk", "buzn", "buzerant",
  "jeb", "vyjeb", "ojeb", "zajeb", "posr", "vysr", "zasr", "nasr", "debil", "kreten",
  "hajzl", "cigan", "cikan", "kurevn", "pizd",
  // angličtina
  "fuck", "shit", "bitch", "cunt", "asshole", "nigg", "faggot", "whore", "slut",
  "retard", "motherf",
];

/**
 * Kořeny, které jsou nadávkou jen jako (skoro) celé slovo — jinak by chytaly
 * běžná slova (pick, devkit, fagot, negroni). Hodnota = kolik písmen smí následovat.
 */
const SHORT_ROOTS: Record<string, number> = {
  pica: 0, pico: 0, pice: 0, pici: 0, picu: 0,
  devka: 0, devko: 0, devky: 0, devce: 0,
  negr: 2, dick: 1, fag: 1,
};

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s",
};

/** Normalizace znak po znaku — pozice zůstávají stejné jako v originálu. */
function normalizeChars(text: string): string {
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const leet = LEET[lower];
    if (leet) {
      out += leet;
      continue;
    }
    const base = lower.normalize("NFD").replace(/\p{M}/gu, "");
    out += base.length === 1 ? base : lower.length === 1 ? lower : "?";
  }
  return out;
}

const WORD_RE = /[a-z0-9@$]+/g;

function isBad(word: string): boolean {
  if (ROOTS.some((root) => word.startsWith(root))) return true;
  for (const [root, extra] of Object.entries(SHORT_ROOTS)) {
    if (word.startsWith(root) && word.length <= root.length + extra) return true;
  }
  return false;
}

export type FilterResult = { text: string; flagged: boolean };

/** Nahradí sprostá slova hvězdičkami (první písmeno zůstane). */
export function censor(text: string): FilterResult {
  const chars = Array.from(text);
  const norm = normalizeChars(text);
  let flagged = false;

  for (const match of norm.matchAll(WORD_RE)) {
    const word = match[0];
    if (!isBad(word)) continue;
    flagged = true;
    // normalizeChars dává 1 znak na 1 znak originálu → indexy sedí
    const start = match.index;
    const len = word.length;
    for (let i = start + 1; i < start + len && i < chars.length; i++) chars[i] = "*";
  }
  return { text: chars.join(""), flagged };
}

const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(cz|com|sk|net|org|eu|io|gg|me|tv|ly)\b)/i;

export function containsLink(text: string): boolean {
  return URL_RE.test(text);
}

/** Úklid vstupu: ořez, jedna mezera, bez řídicích znaků, max. délka. */
export function cleanInput(raw: unknown, maxLength: number): string {
  if (typeof raw !== "string") return "";
  return Array.from(
    raw
      .replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, maxLength)
    .join("");
}
