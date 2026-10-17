import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { probeDuration } from "@/lib/ffmpeg";
import { getDownloadsDir } from "@/lib/library";

const execFileAsync = promisify(execFile);

/** Hlasovky posluchačů k přáním — krátké nahrávky z prohlížeče. */
export const VOICE_MAX_SEC = 30;
const VOICE_MAX_BYTES = 3 * 1024 * 1024;
const VOICE_KEEP_DAYS = 7;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function voiceDir(): string {
  return path.join(getDownloadsDir(), "_voice");
}

export function voiceNotePath(id: string): string | null {
  if (!ID_RE.test(id)) return null;
  const file = path.join(voiceDir(), `${id}.mp3`);
  return existsSync(file) ? file : null;
}

/**
 * Uloží hlasovku: dekóduje base64 (webm/ogg/mp4 z MediaRecorderu), převede
 * na MP3 mono se srovnanou hlasitostí a ořízne na max. délku.
 */
export async function saveVoiceNote(
  id: string,
  base64: unknown,
  ffmpegPath: string,
): Promise<{ durationSec: number }> {
  if (!ID_RE.test(id) || typeof base64 !== "string" || !base64) {
    throw new Error("Hlasovka chybí.");
  }
  const data = Buffer.from(base64, "base64");
  if (data.length < 1000) throw new Error("Hlasovka je prázdná.");
  if (data.length > VOICE_MAX_BYTES) throw new Error("Hlasovka je moc velká (max. 30 s).");

  await mkdir(voiceDir(), { recursive: true });
  const raw = path.join(voiceDir(), `${id}.upload`);
  const out = path.join(voiceDir(), `${id}.mp3`);
  await writeFile(raw, data);
  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", raw,
        "-t", String(VOICE_MAX_SEC + 1),
        "-vn",
        "-af", "highpass=f=80,loudnorm=I=-16:TP=-1.5",
        "-ac", "1",
        "-ar", "44100",
        "-c:a", "libmp3lame",
        "-b:a", "96k",
        out,
      ],
      { timeout: 60_000 },
    );
  } catch {
    await unlink(out).catch(() => {});
    throw new Error("Hlasovku se nepodařilo zpracovat.");
  } finally {
    await unlink(raw).catch(() => {});
  }

  const durationSec = (await probeDuration(out)) ?? 0;
  if (durationSec < 0.5) {
    await unlink(out).catch(() => {});
    throw new Error("Hlasovka je prázdná.");
  }
  return { durationSec: Math.min(durationSec, VOICE_MAX_SEC) };
}

/** Smaže hlasovky starší než týden. */
export async function cleanupVoiceNotes(): Promise<void> {
  const dir = voiceDir();
  if (!existsSync(dir)) return;
  const cutoff = Date.now() - VOICE_KEEP_DAYS * 24 * 3600 * 1000;
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name);
    const st = await stat(file).catch(() => null);
    if (st && st.mtimeMs < cutoff) await unlink(file).catch(() => {});
  }
}
