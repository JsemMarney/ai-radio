import { getMicWsUrl, isMicSameOrigin, makeMicTicket } from "@/lib/mic-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Krátkodobá vstupenka pro WebSocket mikrofonu (chráněno přihlášením do studia). */
export async function POST(request: Request) {
  const ticket = encodeURIComponent(makeMicTicket());
  // Stejný origin jako web: prohlížeč si doplní ws/wss a host sám (funguje i za HTTPS proxy).
  if (isMicSameOrigin()) {
    return Response.json({ path: `/mic?t=${ticket}` }, { headers: { "Cache-Control": "no-store" } });
  }
  const base = getMicWsUrl(request.headers.get("host"));
  const url = `${base}${base.includes("?") ? "&" : "?"}t=${ticket}`;
  return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
}
