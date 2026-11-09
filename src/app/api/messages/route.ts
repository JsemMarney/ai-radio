import { checkMessageLimit, getBestEffortIp, recordMessage } from "@/lib/login-rate-limit";
import { resolveFfmpeg } from "@/lib/ffmpeg";
import { addMessage, newMessageId, repliesFor } from "@/lib/messages";
import { saveVoiceNote } from "@/lib/voice-notes";
import { censor, cleanInput, containsLink } from "@/lib/profanity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Posluchač pošle krátký vzkaz do studia. */
export async function POST(request: Request) {
  const ip = getBestEffortIp(request);
  const limit = checkMessageLimit(ip);
  if (!limit.allowed) {
    const min = Math.max(1, Math.ceil(limit.retryAfterSec / 60));
    return Response.json(
      { ok: false, error: `Další vzkaz můžeš poslat za ${min} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { from?: unknown; text?: unknown; voice?: unknown };
  const fromRaw = cleanInput(body.from, 40);
  const textRaw = cleanInput(body.text, 300);
  const hasVoice = typeof body.voice === "string" && body.voice.length > 0;
  if (textRaw.length < 2 && !hasVoice) {
    return Response.json({ ok: false, error: "Napiš vzkaz nebo nahraj hlasovku." }, { status: 400 });
  }
  if (containsLink(fromRaw) || containsLink(textRaw)) {
    return Response.json({ ok: false, error: "Odkazy do vzkazu dávat nejdou." }, { status: 400 });
  }
  const from = censor(fromRaw);
  const text = censor(textRaw);
  const id = newMessageId();
  let voiceSec: number | undefined;
  if (hasVoice) {
    const ffmpeg = await resolveFfmpeg();
    if (!ffmpeg) return Response.json({ ok: false, error: "Hlasovky teď nejdou zpracovat." }, { status: 503 });
    try {
      voiceSec = Math.round((await saveVoiceNote(id, body.voice as string, ffmpeg)).durationSec);
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : "Hlasovku se nepodařilo uložit." },
        { status: 400 },
      );
    }
  }
  await addMessage({ id, from: from.text || null, text: text.text, flagged: from.flagged || text.flagged, voiceSec });
  recordMessage(ip);
  return Response.json({ ok: true, id });
}

/** Posluchač si stáhne odpovědi moderátora ke svým vzkazům (?ids=a,b). */
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 20);
  if (!ids.length) return Response.json({ replies: [] });
  return Response.json({ replies: await repliesFor(ids) }, { headers: { "Cache-Control": "no-store" } });
}
