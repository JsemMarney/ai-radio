import { brokerStream } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hlasovka k přání — přehrání ve studiu. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Neplatné id.", { status: 400 });
  const res = await brokerStream(`/requests/voice?id=${id}`);
  if (!res.ok || !res.body) return new Response("Hlasovka nenalezena.", { status: 404 });
  return new Response(res.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
  });
}
