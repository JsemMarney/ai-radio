import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Celá knihovna pro posluchače (veřejné, jen názvy a obaly). */
export async function GET() {
  const res = await brokerFetch("/library");
  if (!res.ok) {
    return Response.json({ tracks: [], requests: false, offline: true });
  }
  return Response.json(await res.json(), {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
