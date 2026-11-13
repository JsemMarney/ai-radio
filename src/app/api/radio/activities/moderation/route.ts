import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Studio: odpovědi na otázku dne, tipy v kvízu a žebříček (chráněno přihlášením do studia). */
export async function GET() {
  const res = await brokerFetch("/activities/moderation");
  const data = await res.json().catch(() => ({ error: "Rádio je offline." }));
  return Response.json(data, { status: res.status, headers: { "Cache-Control": "no-store" } });
}

/** Studio: {target: "answer" | "quiz" | "player", id, hidden}. */
export async function POST(request: Request) {
  const body = await request.text().catch(() => "");
  const res = await brokerFetch("/activities/moderate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body || "{}",
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Rádio je offline." }));
  return Response.json(data, { status: res.status });
}
