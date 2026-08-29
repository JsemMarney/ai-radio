/** Shoutcast/Icecast in-band metadata (StreamTitle). */

const METADATA_INTERVAL = 16_384;

export class IcyStreamEncoder {
  private audioSinceMeta = 0;
  private pendingTitle = "";
  private currentTitle = "";

  setTitle(title: string): void {
    if (title === this.pendingTitle || title === this.currentTitle) return;
    this.pendingTitle = title;
    // Vynutí metadata blok při nejbližším intervalu
    this.audioSinceMeta = METADATA_INTERVAL;
  }

  /** Vloží audio chunk + případný metadata blok. */
  encode(audio: Buffer): Buffer[] {
    const out: Buffer[] = [];
    let offset = 0;

    while (offset < audio.length) {
      const untilMeta = METADATA_INTERVAL - this.audioSinceMeta;
      const sliceLen = Math.min(untilMeta, audio.length - offset);
      const slice = audio.subarray(offset, offset + sliceLen);
      out.push(slice);
      this.audioSinceMeta += sliceLen;
      offset += sliceLen;

      if (this.audioSinceMeta >= METADATA_INTERVAL) {
        this.audioSinceMeta = 0;
        if (this.pendingTitle) {
          this.currentTitle = this.pendingTitle;
          this.pendingTitle = "";
        }
        out.push(buildMetadataBlock(this.currentTitle));
      }
    }

    return out;
  }
}

function buildMetadataBlock(title: string): Buffer {
  const payload = `StreamTitle='${sanitize(title)}';`;
  const len = Math.ceil(payload.length / 16) * 16;
  const block = Buffer.alloc(1 + len);
  block[0] = len / 16;
  block.write(payload, 1, "utf8");
  return block;
}

function sanitize(s: string): string {
  return s.replace(/'/g, "''").slice(0, 240);
}

export function icyMetaInterval(): number {
  return METADATA_INTERVAL;
}
