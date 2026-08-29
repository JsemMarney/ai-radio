import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { renderBroadcastFile } from "@/lib/audio-process";
import { probeDuration, resolveFfmpeg } from "@/lib/ffmpeg";
import {
  BROADCAST_FILENAME,
  findBroadcastInDir,
  getDownloadsDir,
  getTrackDir,
  listTracks,
  readTrackInfo,
  resolveAudioPath,
  writeTrackInfo,
} from "@/lib/library";
import { invalidateTrackCache } from "@/lib/radio-playlist";
import { fetchSpotifyTrackMeta } from "@/lib/spotify";

const execFileAsync = promisify(execFile);

export type RemasterJob = {
  id: string;
  status: "running" | "done" | "failed";
  total: number;
  completed: number;
  failed: number;
  current: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

function jobPath(id: string): string {
  return path.join(getDownloadsDir(), "jobs", `remaster-${id}.json`);
}

async function saveJob(job: RemasterJob): Promise<void> {
  await mkdir(path.join(getDownloadsDir(), "jobs"), { recursive: true });
  await writeFile(jobPath(job.id), JSON.stringify(job, null, 2), "utf8");
}

export async function getRemasterJob(id: string): Promise<RemasterJob | null> {
  try {
    const raw = await readFile(jobPath(id), "utf8");
    return JSON.parse(raw) as RemasterJob;
  } catch {
    return null;
  }
}

async function resolveRemasterSource(
  uuid: string,
  info: { duration?: number | null },
): Promise<string | null> {
  const trackDir = getTrackDir(uuid);
  const meta = info.duration ?? 0;
  const minOk = meta > 0 ? Math.min(30, meta * 0.25) : 15;

  const sourcePath = path.join(trackDir, "source.mp3");
  if (existsSync(sourcePath)) {
    const dur = (await probeDuration(sourcePath)) ?? 0;
    if (dur >= minOk) return sourcePath;
  }

  const audio = await resolveAudioPath(uuid);
  if (!audio) return null;

  const probed = (await probeDuration(audio)) ?? 0;
  if (meta > 0 && probed > 0 && probed < minOk) {
    return existsSync(sourcePath) ? sourcePath : null;
  }

  return audio;
}

export async function remasterTrack(
  uuid: string,
  ffmpeg: string,
  force = false,
): Promise<boolean> {
  const info = await readTrackInfo(uuid);
  if (!info || info.status !== "ready") return false;

  const trackDir = getTrackDir(uuid);
  const broadcast = path.join(trackDir, BROADCAST_FILENAME);
  if (!force && existsSync(broadcast) && info.processedAt) {
    const meta = info.duration ?? 0;
    const probed = (await probeDuration(broadcast)) ?? 0;
    const minOk = meta > 0 ? Math.min(30, meta * 0.25) : 15;
    if (probed >= minOk) return true;
  }

  const source = await resolveRemasterSource(uuid, info);
  if (!source) return false;

  let catalogDuration = info.catalogDuration ?? null;
  if (!catalogDuration && info.spotifyId) {
    try {
      const meta = await fetchSpotifyTrackMeta(info.spotifyId);
      catalogDuration = meta.duration;
    } catch {
      catalogDuration = info.duration;
    }
  }

  const { masterPath, broadcastPath, trim } = await renderBroadcastFile(
    source,
    trackDir,
    ffmpeg,
    undefined,
    catalogDuration,
  );

  await writeTrackInfo({
    ...info,
    audioFile: path.basename(masterPath),
    broadcastFile: path.basename(broadcastPath),
    catalogDuration: catalogDuration ?? info.catalogDuration ?? info.duration,
    duration: catalogDuration ?? info.duration,
    trimStart: trim.trimStart,
    trimEnd: trim.trimEnd,
    playDuration: trim.playDuration,
    processedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return true;
}

export async function startRemasterJob(force = false): Promise<RemasterJob> {
  const tracks = await listTracks({ readyOnly: true });
  const job: RemasterJob = {
    id: randomUUID(),
    status: "running",
    total: tracks.length,
    completed: 0,
    failed: 0,
    current: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  await saveJob(job);

  void runRemasterJob(job.id, force);
  return job;
}

async function runRemasterJob(jobId: string, force: boolean): Promise<void> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    const job = await getRemasterJob(jobId);
    if (!job) return;
    job.status = "failed";
    job.error = "ffmpeg nenalezen";
    job.finishedAt = new Date().toISOString();
    await saveJob(job);
    return;
  }

  const tracks = await listTracks({ readyOnly: true });

  for (const track of tracks) {
    let job = await getRemasterJob(jobId);
    if (!job) return;
    job.current = `${track.artist} — ${track.title}`;
    await saveJob(job);

    try {
      const ok = await remasterTrack(track.uuid, ffmpeg, force);
      job = (await getRemasterJob(jobId))!;
      if (ok) job.completed += 1;
      else job.failed += 1;
    } catch {
      job = (await getRemasterJob(jobId))!;
      job.failed += 1;
    }
    await saveJob(job);
  }

  let job = await getRemasterJob(jobId);
  if (!job) return;
  job.status = job.failed === job.total ? "failed" : "done";
  job.current = null;
  job.finishedAt = new Date().toISOString();
  await saveJob(job);
  invalidateTrackCache();
}

export async function ensureBroadcastFile(uuid: string): Promise<string | null> {
  const trackDir = getTrackDir(uuid);
  const info = await readTrackInfo(uuid);
  const existing = await findBroadcastInDir(trackDir);

  const metaDuration = info?.duration ?? 0;
  if (existing && metaDuration > 0) {
    const probed = await probeDuration(existing);
    const minOk = Math.min(30, metaDuration * 0.25);
    if (probed && probed >= minOk) return existing;
    // Poškozený broadcast — zkus znovu z masteru / stažení
  } else if (existing) {
    return existing;
  }

  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) return resolveAudioPath(uuid);

  try {
    await remasterTrack(uuid, ffmpeg, true);
  } catch {
    return resolveAudioPath(uuid);
  }

  const refreshed = await findBroadcastInDir(trackDir);
  if (refreshed && metaDuration > 0) {
    const probed = await probeDuration(refreshed);
    const minOk = Math.min(30, metaDuration * 0.25);
    if (!probed || probed < minOk) return resolveAudioPath(uuid);
  }
  return refreshed ?? resolveAudioPath(uuid);
}

export async function getToolVersions(): Promise<{
  ffmpeg: string | null;
  ytDlp: string | null;
}> {
  let ffmpeg: string | null = null;
  let ytDlp: string | null = null;

  const ff = await resolveFfmpeg();
  if (ff) {
    try {
      const { stdout } = await execFileAsync(ff, ["-version"], { timeout: 8000 });
      ffmpeg = stdout.split("\n")[0]?.trim() ?? ff;
    } catch {
      ffmpeg = ff;
    }
  }

  try {
    const { stdout } = await execFileAsync("yt-dlp", ["--version"], {
      timeout: 8000,
    });
    ytDlp = stdout.trim();
  } catch {
    ytDlp = null;
  }

  return { ffmpeg, ytDlp };
}
