import { spawn, type ChildProcess } from "node:child_process";

/** Interní formát mixu — 44.1 kHz, stereo, s16le. */
export const SAMPLE_RATE = 44_100;
export const CHANNELS = 2;
export const BYTES_PER_FRAME = CHANNELS * 2;

const HIGH_WATER_SEC = 10;
const LOW_WATER_SEC = 5;

/**
 * Jeden "přehrávač" na pultu — ffmpeg dekóduje soubor do PCM,
 * mixer si z něj bere vzorky v reálném čase. Dekodér jede napřed
 * jen o pár sekund (backpressure), takže paměť zůstává malá.
 */
export class PcmDeck {
  private chunks: Buffer[] = [];
  private headOffset = 0;
  private bufferedBytes = 0;
  private proc: ChildProcess | null = null;
  private paused = false;
  private decoderDone = false;
  private disposed = false;
  private readyWaiters: (() => void)[] = [];
  underruns = 0;

  constructor(
    private readonly ffmpegPath: string,
    readonly filepath: string,
    readonly offsetSec = 0,
  ) {}

  start(): this {
    const args = ["-hide_banner", "-nostats", "-loglevel", "error"];
    if (this.offsetSec > 0.05) args.push("-ss", this.offsetSec.toFixed(3));
    args.push(
      "-i", this.filepath,
      "-vn",
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      "-ar", String(SAMPLE_RATE),
      "-ac", String(CHANNELS),
      "pipe:1",
    );

    const proc = spawn(this.ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc = proc;

    let stderr = "";
    proc.stderr?.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-2000);
    });
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (this.disposed) return;
      this.chunks.push(chunk);
      this.bufferedBytes += chunk.length;
      if (this.bufferedBytes >= SAMPLE_RATE * BYTES_PER_FRAME * 0.5) {
        this.flushWaiters();
      }
      if (
        !this.paused &&
        this.bufferedBytes > HIGH_WATER_SEC * SAMPLE_RATE * BYTES_PER_FRAME
      ) {
        this.paused = true;
        proc.stdout?.pause();
      }
    });
    proc.on("close", (code) => {
      this.decoderDone = true;
      this.proc = null;
      this.flushWaiters();
      if (code && !this.disposed) {
        console.warn(
          `[deck] ffmpeg dekodér skončil s kódem ${code}: ${stderr.trim().slice(-300)}`,
        );
      }
    });
    proc.on("error", (err) => {
      this.decoderDone = true;
      this.proc = null;
      this.flushWaiters();
      console.warn("[deck] dekodér selhal:", err.message);
    });
    return this;
  }

  /** Počká, až je v bufferu aspoň půl sekundy (nebo dekodér skončil). */
  waitReady(timeoutMs = 4_000): Promise<boolean> {
    if (this.hasStartBuffer()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.hasStartBuffer()), timeoutMs);
      this.readyWaiters.push(() => {
        clearTimeout(timer);
        resolve(this.hasStartBuffer());
      });
    });
  }

  private hasStartBuffer(): boolean {
    return (
      this.bufferedBytes >= SAMPLE_RATE * BYTES_PER_FRAME * 0.5 ||
      (this.decoderDone && this.bufferedBytes > 0)
    );
  }

  private flushWaiters(): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w();
  }

  /** Dekodér doběhl a buffer je prázdný. */
  get ended(): boolean {
    return this.decoderDone && this.bufferedBytes < BYTES_PER_FRAME;
  }

  /**
   * Vrátí přesně `frames` stereo vzorků. Chybějící data (konec / podtečení)
   * doplní tichem.
   */
  read(frames: number): Int16Array {
    const wantBytes = frames * BYTES_PER_FRAME;
    // Buffer.alloc nepoužívá pool → byteOffset 0, zarovnané pro Int16Array.
    const out = Buffer.alloc(wantBytes);
    let available = Math.min(wantBytes, this.bufferedBytes);
    available -= available % BYTES_PER_FRAME;

    if (available < wantBytes && !this.decoderDone) this.underruns += 1;

    let written = 0;
    while (written < available) {
      const head = this.chunks[0]!;
      const take = Math.min(head.length - this.headOffset, available - written);
      head.copy(out, written, this.headOffset, this.headOffset + take);
      written += take;
      this.headOffset += take;
      if (this.headOffset >= head.length) {
        this.chunks.shift();
        this.headOffset = 0;
      }
    }
    this.bufferedBytes -= written;

    if (
      this.paused &&
      this.bufferedBytes < LOW_WATER_SEC * SAMPLE_RATE * BYTES_PER_FRAME
    ) {
      this.paused = false;
      this.proc?.stdout?.resume();
    }

    return new Int16Array(out.buffer, out.byteOffset, frames * CHANNELS);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.chunks = [];
    this.bufferedBytes = 0;
    this.flushWaiters();
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      proc.stdout?.resume();
      proc.kill("SIGKILL");
    }
  }
}
