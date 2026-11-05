import { findDuplicateTrack } from "@/lib/library";
import { checkSuggestLimit, getBestEffortIp, recordSuggest } from "@/lib/login-rate-limit";
import { censor, cleanInput, containsLink } from "@/lib/profanity";
import { fetchSpotifyTrackMeta } from "@/lib/spotify";
import { addSuggestion } from "@/lib/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Posluchač navrhne písničku do knihovny — moderátor ji pak stáhne. */
export async function POST(request: Request) {
  const ip = getBestEffortIp(request);
  const limit = checkSuggestLimit(ip);
  if (!limit.allowed) {
    const min = Math.max(1, Math.ceil(limit.retryAfterSec / 60));
    return Response.json(
      { ok: false, error: `Díky za návrhy! Další můžeš poslat za ${min} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let body: { spotifyId?: unknown; from?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Neplatný JSON." }, { status: 400 });
  }
  const spotifyId = typeof body.spotifyId === "string" ? body.spotifyId.trim() : "";
  if (!/^[A-Za-z0-9]{10,40}$/.test(spotifyId)) {
    return Response.json({ ok: false, error: "Vyber písničku ze seznamu." }, { status: 400 });
  }
  const fromRaw = cleanInput(body.from, 40);
  if (containsLink(fromRaw)) {
    return Response.json({ ok: false, error: "Odkazy do jména nepatří." }, { status: 400 });
  }

  let meta;
  try {
    meta = await fetchSpotifyTrackMeta(spotifyId);
  } catch {
    return Response.json({ ok: false, error: "Písničku se nepodařilo ověřit, zkus to znovu." }, { status: 502 });
  }
  if (await findDuplicateTrack(meta)) {
    return Response.json(
      { ok: false, error: "Tahle už v rádiu je — přej si ji v seznamu výš." },
      { status: 409 },
    );
  }

  const saved = await addSuggestion(meta, censor(fromRaw).text || null);
  recordSuggest(ip);
  return Response.json({ ok: true, votes: saved.votes });
}
