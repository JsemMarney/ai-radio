import { getStreamBitrate } from "@/lib/ffmpeg";

/** Real-time byte pacer — drží výstup na konfigurované kbps, MP3 frame-aligned chunky. */

export const STREAM_BITRATE = getStreamBitrate();
export const BYTES_PER_SECOND = STREAM_BITRATE / 8;

/** Jen při prvním startu relace — ne mezi skladbami. */
const INITIAL_PREBUFFER_BYTES = Math.floor(BYTES_PER_SECOND * 0.35);
/** Povolené zpoždění oproti wall clock (~4 s). */
const MAX_LAG_BYTES = Math.floor(BYTES_PER_SECOND * 4);
/** Minimální velikost emitu — celé MP3 rámce (256k CBR ≈ 1040 B). */
const MP3_FRAME_BYTES = 1040;
const MIN_EMIT_BYTES = MP3_FRAME_BYTES * 2;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Zarovná délku dolů na hranici MP3 rámce (sync 0xFFEx). */
function frameAlignedTake(data: Buffer, maxBytes: number): number {
  if (maxBytes >= data.length) return data.length;
  if (maxBytes < MP3_FRAME_BYTES) return 0;

  const limit = Math.min(maxBytes, data.length - 2);
  for (let i = limit; i >= MP3_FRAME_BYTES; i--) {
    if (data[i] === 0xff && (data[i + 1]! & 0xe0) === 0xe0) {
      return i;
    }
  }

  const aligned = Math.floor(maxBytes / MP3_FRAME_BYTES) * MP3_FRAME_BYTES;
  return aligned >= MP3_FRAME_BYTES ? aligned : 0;
}

export class StreamPacer {
  private totalSent = 0;
  private readonly wallStart = performance.now();
  private queue: Buffer[] = [];
  private draining = false;
  private stopped = false;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Po prvním audiu už nečekat na velký prebuffer mezi skladbami. */
  private sessionPrimed = false;

  constructor(private readonly emit: (chunk: Buffer) => void) {}

  enqueue(chunk: Buffer): void {
    if (this.stopped || !chunk.length) return;
    this.queue.push(chunk);
    if (!this.draining) void this.drain();
  }

  /** Počkej až se fronta vyprázdní (konec segmentu). */
  async flush(): Promise<void> {
    while ((this.queue.length > 0 || this.draining) && !this.stopped) {
      await sleep(8);
    }
  }

  /** Zahodí neodeslaná data aktuálního segmentu, ale drží celkové tempo relace. */
  abortSegment(): void {
    this.queue = [];
    this.draining = false;
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    this.sessionPrimed = false;
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
  }

  private queuedBytes(): number {
    let n = 0;
    for (const b of this.queue) n += b.length;
    return n;
  }

  private targetBytes(): number {
    return ((performance.now() - this.wallStart) / 1000) * BYTES_PER_SECOND;
  }

  private async waitForBudget(): Promise<void> {
    const lag = this.targetBytes() - this.totalSent;
    if (lag >= MIN_EMIT_BYTES) return;

    const deficit = MIN_EMIT_BYTES - lag;
    const ms = Math.min(50, Math.max(2, (deficit / BYTES_PER_SECOND) * 1000));
    await new Promise<void>((resolve) => {
      this.waitTimer = setTimeout(resolve, ms);
    });
    this.waitTimer = null;
  }

  private async drain(): Promise<void> {
    this.draining = true;

    while (this.queue.length > 0 && !this.stopped) {
      const queued = this.queuedBytes();
      if (!this.sessionPrimed && queued < INITIAL_PREBUFFER_BYTES) {
        await sleep(8);
        continue;
      }
      this.sessionPrimed = true;

      const lag = this.targetBytes() - this.totalSent;
      if (lag < MIN_EMIT_BYTES) {
        if (lag < -MAX_LAG_BYTES) {
          await this.waitForBudget();
          continue;
        }
        await this.waitForBudget();
        if (this.targetBytes() - this.totalSent < MP3_FRAME_BYTES) {
          continue;
        }
      }

      const head = this.queue[0]!;
      const budget = Math.max(
        MP3_FRAME_BYTES,
        Math.min(this.targetBytes() - this.totalSent + MAX_LAG_BYTES, head.length),
      );

      let take = head.length <= budget ? head.length : frameAlignedTake(head, Math.floor(budget));
      if (take <= 0) {
        if (head.length <= MIN_EMIT_BYTES && lag >= head.length) {
          take = head.length;
        } else {
          await this.waitForBudget();
          continue;
        }
      }

      const slice = head.subarray(0, take);
      this.emit(slice);
      this.totalSent += take;

      if (take >= head.length) {
        this.queue.shift();
      } else {
        this.queue[0] = head.subarray(take);
      }
    }

    this.draining = false;
  }
}
