import { createPlaylistJob, getJob, startPlaylistJob } from "@/lib/jobs";
import { ensureDownloadsDir } from "@/lib/library";
import { fetchSpotifyTrackMeta } from "@/lib/spotify";
import { getSuggestion, listSuggestions, updateSuggestion } from "@/lib/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Návrhy posluchačů pro moderátora. */
export async function GET() {
  const list = await listSuggestions();
  // Hotové stahování zmizí z návrhů; selhané se vrátí mezi nové (dá se zkopírovat a zkusit doma).
  for (const s of list.filter((x) => x.status === "downloading" && x.jobId)) {
    const job = await getJob(s.jobId!);
    if (!job || job.status === "done" || job.status === "failed") {
      const ok = job?.status === "done" && job.failed === 0;
      await updateSuggestion(s.id, { status: ok ? "dismissed" : "new" });
      s.status = ok ? "dismissed" : "new";
    }
  }
  return Response.json({ suggestions: list.filter((s) => s.status !== "dismissed") });
}

/** { id, action: "download" | "dismiss" } — stáhnout do knihovny nebo zahodit. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; action?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const suggestion = id ? await getSuggestion(id) : null;
  if (!suggestion) return Response.json({ ok: false, error: "Návrh nenalezen." }, { status: 404 });

  if (body.action === "dismiss") {
    await updateSuggestion(id, { status: "dismissed" });
    return Response.json({ ok: true });
  }
  if (body.action === "download") {
    try {
      await ensureDownloadsDir();
      const meta = await fetchSpotifyTrackMeta(suggestion.spotifyId);
      const job = await createPlaylistJob({ title: `${meta.artist} — ${meta.title}`, tracks: [meta], source: "track" });
      startPlaylistJob(job.id, [meta]);
      await updateSuggestion(id, { status: "downloading", jobId: job.id });
      return Response.json({ ok: true, jobId: job.id });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : "Stažení se nepodařilo spustit." },
        { status: 500 },
      );
    }
  }
  return Response.json({ ok: false, error: "Neznámá akce." }, { status: 400 });
}
