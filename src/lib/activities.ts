/**
 * Aktivity pro posluchače mimo kvíz: týdenní žebříček kvízu a otázka dne.
 * Stav v downloads/activities.json (přežije restart).
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDownloadsDir } from "@/lib/library";
import { censor, cleanInput, containsLink } from "@/lib/profanity";
import { stationClock } from "@/lib/station-time";

/** Otázky dne — bezpečné, veselé, na které se dá odpovědět jednou větou. */
const QUESTIONS = [
  "Jakou písničku si pouštíte, když potřebujete dobrou náladu?",
  "Jaký byl váš první koncert?",
  "Kam byste teď nejradši odjeli?",
  "Jakou písničku byste si dali na svatbu?",
  "Která písnička vám připomíná léto?",
  "Co děláte, když nemůžete usnout?",
  "Jakou písničku zpíváte ve sprše?",
  "Jaký je váš skrytý talent?",
  "Co byste si koupili, kdybyste vyhráli milion?",
  "Jakou písničku máte jako budík?",
  "Co vás dneska rozesmálo?",
  "Jaké jídlo byste jedli každý den?",
  "Na čí koncert byste chtěli jít?",
  "Kterou písničku nesnášíte, ale stejně ji znáte nazpaměť?",
  "Jaká písnička vás vrátí do dětství?",
  "Čím jste chtěli být jako malí?",
  "Jaké je vaše oblíbené místo v Česku?",
  "Káva, nebo čaj, a proč?",
  "Jakou písničku byste pustili mimozemšťanům?",
  "Co vám dnes udělalo radost?",
  "Jaký byl váš nejlepší výlet?",
  "Kterou písničku si v autě pouštíte nejhlasitěji?",
  "Pes, nebo kočka?",
  "Jakou superschopnost byste chtěli mít?",
  "Na co se tenhle týden nejvíc těšíte?",
  "Jaký film byste viděli klidně desetkrát?",
  "Co vás nejvíc nabije energií?",
  "Jakou písničku byste věnovali nejlepšímu kamarádovi?",
  "Jaké roční období máte nejradši?",
  "Co byste dělali, kdybyste byli jeden den neviditelní?",
];

const MAX_ANSWERS = 2000;
const PER_NETWORK = 8;

export type BoardRow = { name: string; points: number };

type Player = { name: string; points: number; at: number };
type DayAnswer = {
  id: string;
  voter: string;
  net: string;
  name: string;
  text: string;
  flagged: boolean;
  /** Skryto ve studiu — nepřečte se. */
  hidden?: boolean;
  at: number;
};

/** Pro studio: odpovědi na otázku dne a žebříček (se skrýváním). */
export type ActivityModeration = {
  question: {
    text: string;
    askedAt: number | null;
    readAt: number | null;
    answers: { id: string; name: string; text: string; flagged: boolean; hidden: boolean; at: number }[];
  } | null;
  board: { id: string; name: string; points: number }[];
};

type State = {
  board: { week: string; players: Record<string, Player>; announced?: boolean };
  question: {
    date: string;
    text: string;
    askedAt: number | null;
    readAt: number | null;
    answers: DayAnswer[];
  } | null;
  /** Indexy otázek, které už byly (ať se neopakují, dokud nedojdou). */
  used: number[];
};

export type PublicQuestion = {
  date: string;
  text: string;
  /** Odpovědi se sbírají (otázka zazněla a ještě se nečetlo). */
  open: boolean;
  read: boolean;
  answers: number;
};

/** Týden podle ISO (pondělí–neděle) v čase stanice: „2026-W46“. */
export function isoWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Jméno nebo text od posluchače do éteru: žádné tagy hlasu ([laughs]) ani odkazy. */
export function airSafe(text: string): string {
  return text.replace(/[[\]{}<>]/g, "").replace(/\s+/g, " ").trim();
}

function file(): string {
  return path.join(getDownloadsDir(), "activities.json");
}

export class Activities {
  private state: State = { board: { week: "", players: {} }, question: null, used: [] };
  private saving: Promise<void> = Promise.resolve();

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(file(), "utf8")) as Partial<State>;
      this.state = {
        board: raw.board ?? { week: "", players: {} },
        question: raw.question ?? null,
        used: raw.used ?? [],
      };
      for (const a of this.state.question?.answers ?? []) a.id ??= randomUUID();
    } catch {
      // první spuštění
    }
  }

  private persist(): void {
    this.saving = this.saving
      .then(async () => {
        await mkdir(path.dirname(file()), { recursive: true });
        const tmp = `${file()}.tmp`;
        await writeFile(tmp, JSON.stringify(this.state));
        await rename(tmp, file());
      })
      .catch((err: unknown) => console.warn("[activities] uložení selhalo:", err));
  }

  // ───────── týdenní žebříček kvízu ─────────

  /** Aktuální týden — nový týden = nový žebříček. */
  private week(): State["board"] {
    const w = isoWeek(stationClock().date);
    if (this.state.board.week !== w) this.state.board = { week: w, players: {} };
    return this.state.board;
  }

  /** Bod za trefu v kvízu (jen se jménem — bez jména není koho vyhlásit). */
  award(winners: { voter: string; name: string }[]): void {
    if (!winners.length) return;
    const b = this.week();
    for (const w of winners) {
      const p = b.players[w.voter] ?? { name: w.name, points: 0, at: 0 };
      p.name = w.name;
      p.points += 1;
      p.at = Date.now();
      b.players[w.voter] = p;
    }
    this.persist();
  }

  board(limit = 10): { week: string; top: BoardRow[] } {
    const b = this.week();
    const top = Object.values(b.players)
      // Při shodě vede ten, kdo body nasbíral dřív.
      .sort((x, y) => y.points - x.points || x.at - y.at)
      .slice(0, limit)
      .map(({ name, points }) => ({ name, points }));
    return { week: b.week, top };
  }

  /** Neděle večer: vyhlásit vítěze týdne (jednou). */
  winnersDue(hour: number): BoardRow[] | null {
    const clk = stationClock();
    const b = this.week();
    if (clk.weekday !== 0 || clk.hour < hour || b.announced) return null;
    const top = this.board(3).top;
    return top.length ? top : null;
  }

  markWinnersAnnounced(): void {
    this.week().announced = true;
    this.persist();
  }

  // ───────── otázka dne ─────────

  private today(): State["question"] {
    const date = stationClock().date;
    const q = this.state.question;
    return q && q.date === date ? q : null;
  }

  /** Dnes ještě nezazněla → můžou ji moderátoři položit (9–20 h). */
  questionDue(): boolean {
    const clk = stationClock();
    return clk.hour >= 9 && clk.hour < 20 && !this.today()?.askedAt;
  }

  /** Otázka pro dnešek (vybere se jednou za den, zazní, až se vstup povede). */
  pickQuestion(): string {
    const existing = this.today();
    if (existing) return existing.text;
    let free = QUESTIONS.map((_, i) => i).filter((i) => !this.state.used.includes(i));
    if (!free.length) {
      this.state.used = [];
      free = QUESTIONS.map((_, i) => i);
    }
    const i = free[Math.floor(Math.random() * free.length)]!;
    this.state.used.push(i);
    this.state.question = {
      date: stationClock().date,
      text: QUESTIONS[i]!,
      askedAt: null,
      readAt: null,
      answers: [],
    };
    this.persist();
    return QUESTIONS[i]!;
  }

  markAsked(): void {
    const q = this.today();
    if (q && !q.askedAt) {
      q.askedAt = Date.now();
      this.persist();
    }
  }

  /** Odpovědi k přečtení: aspoň 40 min po otázce a aspoň 2 odpovědi. */
  readDue(): boolean {
    const q = this.today();
    if (!q?.askedAt || q.readAt) return false;
    if (Date.now() - q.askedAt < 40 * 60_000) return false;
    return q.answers.filter((a) => !a.flagged && !a.hidden).length >= 2;
  }

  /** Až 3 odpovědi do éteru: bez sprostých slov, od různých lidí, spíš ty s víc slovy. */
  answersToRead(): { question: string; answers: { name: string; text: string }[] } | null {
    const q = this.today();
    if (!q) return null;
    const pool = q.answers
      .filter((a) => !a.flagged && !a.hidden && a.text.split(/\s+/).length >= 2)
      .sort(() => Math.random() - 0.5);
    const seen = new Set<string>();
    const picked: { name: string; text: string }[] = [];
    for (const a of pool) {
      if (seen.has(a.voter)) continue;
      seen.add(a.voter);
      picked.push({ name: airSafe(a.name), text: airSafe(a.text) });
      if (picked.length === 3) break;
    }
    return picked.length ? { question: q.text, answers: picked } : null;
  }

  markRead(): void {
    const q = this.today();
    if (q && !q.readAt) {
      q.readAt = Date.now();
      this.persist();
    }
  }

  moderation(): ActivityModeration {
    const q = this.today();
    const b = this.week();
    return {
      question: q
        ? {
            text: q.text,
            askedAt: q.askedAt,
            readAt: q.readAt,
            answers: [...q.answers]
              .reverse()
              .slice(0, 100)
              .map((a) => ({
                id: a.id,
                name: a.name,
                text: a.text,
                flagged: a.flagged,
                hidden: !!a.hidden,
                at: a.at,
              })),
          }
        : null,
      board: Object.entries(b.players)
        .sort(([, x], [, y]) => y.points - x.points || x.at - y.at)
        .slice(0, 30)
        .map(([id, p]) => ({ id, name: p.name, points: p.points })),
    };
  }

  /** Studio: skrýt / vrátit odpověď na otázku dne. */
  hideAnswer(id: string, hidden: boolean): boolean {
    const a = this.today()?.answers.find((x) => x.id === id);
    if (!a) return false;
    a.hidden = hidden;
    this.persist();
    return true;
  }

  /** Studio: vyřadit hráče z týdenního žebříčku (nevhodné jméno). */
  removePlayer(id: string): boolean {
    const b = this.week();
    if (!b.players[id]) return false;
    delete b.players[id];
    this.persist();
    return true;
  }

  publicQuestion(): PublicQuestion | null {
    const q = this.today();
    if (!q?.askedAt) return null;
    return {
      date: q.date,
      text: q.text,
      open: !q.readAt,
      read: !!q.readAt,
      answers: q.answers.length,
    };
  }

  answer(input: { name?: unknown; text?: unknown; voter?: unknown; net?: unknown }): {
    ok: boolean;
    error?: string;
  } {
    const q = this.today();
    if (!q?.askedAt) return { ok: false, error: "Otázka dne ještě nezazněla." };
    if (q.readAt) return { ok: false, error: "Odpovědi už jsme přečetli, zítra je nová otázka." };
    const voter = typeof input.voter === "string" ? input.voter.slice(0, 80) : "";
    const net = typeof input.net === "string" ? input.net.slice(0, 80) : "";
    if (!voter) return { ok: false, error: "Odpověď se nepodařilo odeslat." };
    if (q.answers.some((a) => a.voter === voter))
      return { ok: false, error: "Odpověď už máš poslanou, jedna na posluchače." };
    if (q.answers.filter((a) => a.net === net).length >= PER_NETWORK)
      return { ok: false, error: "Z této sítě už přišlo odpovědí dost." };
    if (q.answers.length >= MAX_ANSWERS) return { ok: false, error: "Odpovědí je už dost." };
    const text = airSafe(cleanInput(input.text, 140));
    const name = airSafe(cleanInput(input.name, 24));
    if (text.length < 2) return { ok: false, error: "Napiš odpověď." };
    if (containsLink(text) || containsLink(name)) return { ok: false, error: "Odkazy dávat nejdou." };
    const t = censor(text);
    const n = censor(name);
    q.answers.push({
      id: randomUUID(),
      voter,
      net,
      name: n.text,
      text: t.text,
      flagged: t.flagged || n.flagged,
      at: Date.now(),
    });
    this.persist();
    return { ok: true };
  }
}
