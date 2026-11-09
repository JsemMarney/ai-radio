import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDownloadsDir } from "@/lib/library";

/** Krátký vzkaz posluchače pro moderátora (mimo přání). */
export type ListenerMessage = {
  id: string;
  from: string | null;
  text: string;
  /** Obsahoval sprosté slovo (je vyhvězdičkované). */
  flagged: boolean;
  /** Hlasovka (downloads/_voice/<id>.mp3) a její délka. */
  voiceSec?: number;
  read: boolean;
  createdAt: string;
  /** Textová odpověď moderátora (vidí ji posluchač na webu). */
  reply?: { from: string; text: string; at: string };
};

const MAX_MESSAGES = 100;

function filePath(): string {
  return path.join(getDownloadsDir(), "messages.json");
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function readAll(): Promise<ListenerMessage[]> {
  try {
    return JSON.parse(await readFile(filePath(), "utf8")) as ListenerMessage[];
  } catch {
    return [];
  }
}

async function writeAll(list: ListenerMessage[]): Promise<void> {
  await mkdir(path.dirname(filePath()), { recursive: true });
  const tmp = `${filePath()}.tmp`;
  await writeFile(tmp, JSON.stringify(list.slice(0, MAX_MESSAGES), null, 2), "utf8");
  await rename(tmp, filePath());
}

export async function listMessages(): Promise<ListenerMessage[]> {
  return readAll();
}

export function newMessageId(): string {
  return randomUUID();
}

export function addMessage(input: {
  id?: string;
  from: string | null;
  text: string;
  flagged: boolean;
  voiceSec?: number;
}): Promise<ListenerMessage> {
  return serialized(async () => {
    const list = await readAll();
    const { id, ...rest } = input;
    const message: ListenerMessage = {
      id: id ?? randomUUID(),
      ...rest,
      read: false,
      createdAt: new Date().toISOString(),
    };
    list.unshift(message);
    await writeAll(list);
    return message;
  });
}

/** Uloží textovou odpověď moderátora ke vzkazu. */
export function setMessageReply(id: string, reply: { from: string; text: string }): Promise<boolean> {
  return serialized(async () => {
    const list = await readAll();
    const item = list.find((m) => m.id === id);
    if (!item) return false;
    item.reply = { ...reply, at: new Date().toISOString() };
    await writeAll(list);
    return true;
  });
}

/** Odpovědi k vlastním vzkazům posluchače (id zná jen on — náhodné UUID). */
export async function repliesFor(ids: string[]): Promise<{ id: string; reply: NonNullable<ListenerMessage["reply"]> }[]> {
  const wanted = new Set(ids);
  return (await readAll())
    .filter((m) => wanted.has(m.id) && m.reply)
    .map((m) => ({ id: m.id, reply: m.reply! }));
}

/** read / delete jednoho vzkazu, readAll = vše přečteno. */
export function updateMessages(action: "read" | "delete" | "readAll", id?: string): Promise<boolean> {
  return serialized(async () => {
    let list = await readAll();
    if (action === "readAll") list.forEach((m) => (m.read = true));
    else {
      const item = list.find((m) => m.id === id);
      if (!item) return false;
      if (action === "read") item.read = true;
      else list = list.filter((m) => m.id !== id);
    }
    await writeAll(list);
    return true;
  });
}
