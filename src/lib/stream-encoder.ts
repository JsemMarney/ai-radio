import { spawn, type ChildProcess } from "node:child_process";
import { getStreamBitrate } from "@/lib/ffmpeg";
import { CHANNELS, SAMPLE_RATE } from "@/lib/pcm-deck";

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/** Délka MPEG Layer III rámce začínajícího na `i`, nebo 0 když tam rámec není. */
function mp3FrameLength(b: Buffer, i: number): number {
  if (i + 4 > b.length) return 0;
  if (b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) return 0;
  const version = (b[i + 1]! >> 3) & 0x03;
  const layer = (b[i + 1]! >> 1) & 0x03;
  if (version === 1 || layer !== 1) return 0;
  const brIdx = b[i + 2]! >> 4;
  const srIdx = (b[i + 2]! >> 2) & 0x03;
  const pad = (b[i + 2]! >> 1) & 0x01;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return 0;
  const sr = SAMPLE_RATES[version]![srIdx]!;
  if (version === 3) return Math.floor((144 * BITRATES_V1[brIdx]! * 1000) / sr) + pad;
  return Math.floor((72 * BITRATES_V2[brIdx]! * 1000) / sr) + pad;
}

/** Délka AAC ADTS rámce začínajícího na `i`, nebo 0. */
function adtsFrameLength(b: Buffer, i: number): number {
  if (i + 7 > b.length) return 0;
  if (b[i] !== 0xff || (b[i + 1]! & 0xf6) !== 0xf0) return 0;
  const len = ((b[i + 3]! & 0x03) << 11) | (b[i + 4]! << 3) | (b[i + 5]! >> 5);
  return len >= 7 ? len : 0;
}

export type StreamFormat = "mp3" | "aac";

/** Skládá výstup enkodéru do celých rámců (posluchač se tak vždy chytí na hranici). */
class FrameSplitter {
  constructor(private readonly frameLength: (b: Buffer, i: number) => number) {}

  private rest: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer | null {
    const data = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    let i = 0;
    let start = -1;
    let end = 0;

    while (i + 4 <= data.length) {
      const len = this.frameLength(data, i);
      if (len === 0) {
        i += 1;
        continue;
      }
      if (i + len > data.length) break;
      if (start < 0) start = i;
      // Mezera mezi rámci (garbage) — vezmeme jen souvislý blok.
      if (i !== end && end > 0) break;
      i += len;
      end = i;
    }

    if (start < 0) {
      this.rest = Buffer.from(data.subarray(Math.max(0, data.length - 4096)));
      return null;
    }
    this.rest = Buffer.from(data.subarray(end));
    return data.subarray(start, end);
  }

  reset(): void {
    this.rest = Buffer.alloc(0);
  }
}

export function getAacBitrateKbps(): number {
  const raw = Number(process.env.RADIO_AAC_BITRATE ?? 96);
  if (!Number.isFinite(raw) || raw <= 0) return 96;
  return Math.min(Math.max(Math.floor(raw), 32), 256);
}

export function isAacEnabled(): boolean {
  return process.env.RADIO_AAC !== "0";
}

/**
 * Jeden trvalý enkodér na celé vysílání: PCM z mixeru → MP3/AAC → posluchači.
 * Žádné přepínání procesů mezi skladbami = žádné mezery, cvaknutí ani skoky bitrate.
 */
export class StreamEncoder {
  private proc: ChildProcess | null = null;
  private splitter: FrameSplitter;
  private stopped = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ffmpegPath: string,
    private readonly onFrames: (frames: Buffer) => void,
    readonly format: StreamFormat = "mp3",
  ) {
    this.splitter = new FrameSplitter(
      format === "aac" ? adtsFrameLength : mp3FrameLength,
    );
  }

  get bitrateKbps(): number {
    return this.format === "aac"
      ? getAacBitrateKbps()
      : Math.floor(getStreamBitrate() / 1000);
  }

  start(): void {
    this.stopped = false;
    this.spawnEncoder();
  }

  private spawnEncoder(): void {
    const kbps = this.bitrateKbps;
    const proc = spawn(
      this.ffmpegPath,
      [
        "-hide_banner", "-nostats", "-loglevel", "error",
        "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS),
        "-i", "pipe:0",
        "-af", "alimiter=limit=0.97:attack=4:release=60:level=0",
        ...(this.format === "aac"
          ? ["-c:a", "aac", "-b:a", `${kbps}k`, "-ar", String(SAMPLE_RATE), "-f", "adts"]
          : [
              "-c:a", "libmp3lame",
              "-b:a", `${kbps}k`,
              "-ar", String(SAMPLE_RATE),
              "-f", "mp3",
              "-id3v2_version", "0",
              "-write_xing", "0",
            ]),
        "-flush_packets", "1",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    this.proc = proc;
    this.splitter.reset();

    let stderr = "";
    proc.stderr?.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-2000);
    });
    proc.stdout?.on("data", (chunk: Buffer) => {
      const frames = this.splitter.push(chunk);
      if (frames?.length) this.onFrames(frames);
    });
    proc.stdin?.on("error", () => {
      // EPIPE při restartu — řeší se v "close"
    });
    proc.on("close", (code) => {
      if (this.proc === proc) this.proc = null;
      if (this.stopped) return;
      console.error(
        `[encoder] ${this.format.toUpperCase()} enkodér spadl (kód ${code}) — restartuji. ${stderr.trim().slice(-300)}`,
      );
      this.restartTimer = setTimeout(() => this.spawnEncoder(), 500);
    });
    proc.on("error", (err) => {
      console.error("[encoder] Nelze spustit ffmpeg:", err.message);
    });
  }

  write(pcm: Int16Array): void {
    const stdin = this.proc?.stdin;
    if (!stdin || stdin.destroyed) return;
    stdin.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      proc.stdin?.end();
      setTimeout(() => proc.kill("SIGKILL"), 1000);
    }
  }
}
