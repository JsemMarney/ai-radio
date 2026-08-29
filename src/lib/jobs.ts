import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDownloadsDir, findBySpotifyId } from "@/lib/library";
import { invalidateTrackCache } from "@/lib/radio-playlist";
import { importSpotifyTrack } from "@/lib/ytdlp";
import type { SpotifyTrackMeta } from "@/lib/spotify";

export type ImportJobStatus = "queued" | "running" | "done" | "failed";

export type ImportJobItem = {
  spotifyId: string;
  title: string;
  artist: string;
  status: "pending" | "downloading" | "ready" | "failed" | "skipped";
  uuid: string | null;
  error: string | null;
};

export type ImportJob = {
  id: string;
  type: "playlist" | "album" | "track";
  title: string;
  status: ImportJobStatus;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  current: string | null;
  items: ImportJobItem[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const memory = new Map<string, ImportJob>();
const running = new Set<string>();

function jobsDir(): string {
  return path.join(getDownloadsDir(), "jobs");
}

function jobPath(id: string): string {
  return path.join(jobsDir(), `${id}.json`);
}

export async function saveJob(job: ImportJob): Promise<void> {
  job.updatedAt = new Date().toISOString();
  memory.set(job.id, job);
  await mkdir(jobsDir(), { recursive: true });
  await writeFile(jobPath(job.id), JSON.stringify(job, null, 2), "utf8");
}

export async function getJob(id: string): Promise<ImportJob | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  try {
    const raw = await readFile(jobPath(id), "utf8");
    const job = JSON.parse(raw) as ImportJob;
    memory.set(id, job);
    return job;
  } catch {
    return null;
  }
}

export async function createPlaylistJob(input: {
  title: string;
  tracks: SpotifyTrackMeta[];
  source?: "playlist" | "album";
}): Promise<ImportJob> {
  const now = new Date().toISOString();
  const job: ImportJob = {
    id: randomUUID(),
    type: input.source ?? "playlist",
    title: input.title,
    status: "queued",
    total: input.tracks.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    current: null,
    items: input.tracks.map((t) => ({
      spotifyId: t.id,
      title: t.title,
      artist: t.artist,
      status: "pending",
      uuid: null,
      error: null,
    })),
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await saveJob(job);
  return job;
}

async function runPlaylistJob(
  jobId: string,
  tracks: SpotifyTrackMeta[],
): Promise<void> {
  if (running.has(jobId)) return;
  running.add(jobId);

  try {
    const job = await getJob(jobId);
    if (!job) return;

    job.status = "running";
    await saveJob(job);

    for (let i = 0; i < tracks.length; i++) {
      const meta = tracks[i];
      const current = await getJob(jobId);
      if (!current) return;

      current.current = `${meta.artist} — ${meta.title}`;
      current.items[i].status = "downloading";
      await saveJob(current);

      try {
        const existing = await findBySpotifyId(meta.id);
        if (existing) {
          const latest = await getJob(jobId);
          if (!latest) return;
          latest.items[i].uuid = existing.uuid;
          latest.items[i].status = "skipped";
          latest.items[i].error = null;
          latest.skipped += 1;
          latest.completed += 1;
          await saveJob(latest);
          continue;
        }

        const track = await importSpotifyTrack(meta);
        const latest = await getJob(jobId);
        if (!latest) return;

        latest.items[i].uuid = track.uuid;
        latest.items[i].status = "ready";
        latest.items[i].error = null;
        latest.completed += 1;
        await saveJob(latest);
        invalidateTrackCache();
      } catch (error) {
        const latest = await getJob(jobId);
        if (!latest) return;
        const message =
          error instanceof Error ? error.message : "Stažení selhalo.";
        latest.items[i].status = "failed";
        latest.items[i].error = message;
        latest.failed += 1;
        await saveJob(latest);
      }
    }

    const finalJob = await getJob(jobId);
    if (!finalJob) return;
    finalJob.current = null;
    finalJob.status = finalJob.failed === finalJob.total ? "failed" : "done";
    if (finalJob.status === "failed") {
      finalJob.error = "Všechny skladby selhaly.";
    }
    await saveJob(finalJob);
  } finally {
    running.delete(jobId);
  }
}

export function startPlaylistJob(
  jobId: string,
  tracks: SpotifyTrackMeta[],
): void {
  void runPlaylistJob(jobId, tracks);
}
