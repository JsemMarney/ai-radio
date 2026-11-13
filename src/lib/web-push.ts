/**
 * Web Push bez knihovny: push bez obsahu (žádné šifrování), jen VAPID podpis.
 * Service worker si po probuzení text stáhne sám (/api/radio/status).
 *
 * Klíče VAPID se vygenerují samy při prvním použití do downloads/push.json,
 * odběry v downloads/push-subs.json. Pushe jdou jen na známé push služby
 * prohlížečů (žádné libovolné URL od posluchačů).
 */
import { createPrivateKey, generateKeyPairSync, sign, type JsonWebKey } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDownloadsDir } from "@/lib/library";

const MAX_SUBS = 5000;
const PARALLEL = 10;

/** Push služby prohlížečů (Chrome/Edge, Firefox, Safari, Windows). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

type Keys = { publicKey: string; privateJwk: JsonWebKey; site?: string };
type Sub = { endpoint: string; at: number };

const b64url = (buf: Buffer) => buf.toString("base64url");

export function isPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}

export class WebPush {
  private keys: Keys | null = null;
  private subs: Sub[] = [];
  private loaded = false;
  private saving: Promise<void> = Promise.resolve();

  private keyFile = () => path.join(getDownloadsDir(), "push.json");
  private subFile = () => path.join(getDownloadsDir(), "push-subs.json");

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    this.keys = await readJson<Keys>(this.keyFile());
    if (!this.keys) {
      const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const pub = publicKey.export({ format: "jwk" });
      const raw = Buffer.concat([
        Buffer.from([4]),
        Buffer.from(pub.x!, "base64url"),
        Buffer.from(pub.y!, "base64url"),
      ]);
      this.keys = { publicKey: b64url(raw), privateJwk: privateKey.export({ format: "jwk" }) };
      await writeJson(this.keyFile(), this.keys);
    }
    this.subs = (await readJson<Sub[]>(this.subFile())) ?? [];
  }

  private persistSubs(): void {
    const snapshot = [...this.subs];
    this.saving = this.saving
      .then(() => writeJson(this.subFile(), snapshot))
      .catch((err: unknown) => console.warn("[push] uložení odběrů selhalo:", err));
  }

  async publicKey(): Promise<string> {
    await this.load();
    return this.keys!.publicKey;
  }

  /** site = adresa webu (kontakt ve VAPID, když není STATION_CONTACT_EMAIL). */
  async subscribe(endpoint: string, site?: string): Promise<{ ok: boolean; error?: string }> {
    await this.load();
    if (!isPushEndpoint(endpoint)) return { ok: false, error: "Neplatný odběr." };
    if (site && /^https:\/\/[^/]+$/.test(site) && this.keys!.site !== site) {
      this.keys!.site = site;
      await writeJson(this.keyFile(), this.keys);
    }
    if (!this.subs.some((s) => s.endpoint === endpoint)) {
      if (this.subs.length >= MAX_SUBS) this.subs.shift();
      this.subs.push({ endpoint, at: Date.now() });
      this.persistSubs();
    }
    return { ok: true };
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.load();
    const before = this.subs.length;
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    if (this.subs.length !== before) this.persistSubs();
  }

  async count(): Promise<number> {
    await this.load();
    return this.subs.length;
  }

  private jwt(endpoint: string): string {
    const k = this.keys!;
    const contact = process.env.STATION_CONTACT_EMAIL?.trim();
    const sub = contact ? `mailto:${contact}` : (k.site ?? "mailto:radio@localhost");
    const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const claims = b64url(
      Buffer.from(
        JSON.stringify({
          aud: new URL(endpoint).origin,
          exp: Math.floor(Date.now() / 1000) + 12 * 3600,
          sub,
        }),
      ),
    );
    const key = createPrivateKey({ key: k.privateJwk, format: "jwk" });
    const sig = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
    return `${header}.${claims}.${b64url(sig)}`;
  }

  /** Pošle push všem odběratelům (bez obsahu). Zaniklé odběry (404/410) smaže. */
  async notifyAll(ttlSec = 600): Promise<{ sent: number; removed: number }> {
    await this.load();
    const targets = [...this.subs];
    const dead = new Set<string>();
    let sent = 0;
    let i = 0;
    const worker = async () => {
      while (i < targets.length) {
        const s = targets[i++]!;
        try {
          const res = await fetch(s.endpoint, {
            method: "POST",
            headers: {
              Authorization: `vapid t=${this.jwt(s.endpoint)}, k=${this.keys!.publicKey}`,
              TTL: String(ttlSec),
              Urgency: "high",
              "Content-Length": "0",
            },
            signal: AbortSignal.timeout(10_000),
          });
          if (res.status === 404 || res.status === 410) dead.add(s.endpoint);
          else if (res.ok) sent++;
          else console.warn(`[push] ${new URL(s.endpoint).hostname} odpověděl ${res.status}`);
        } catch {
          // síť / timeout — příště znovu
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, targets.length) }, worker));
    if (dead.size) {
      this.subs = this.subs.filter((s) => !dead.has(s.endpoint));
      this.persistSubs();
    }
    return { sent, removed: dead.size };
  }
}
