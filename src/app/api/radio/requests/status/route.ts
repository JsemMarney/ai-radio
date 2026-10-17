import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stav přání posluchače — jen podle id, která mu vrátil server. */
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 20);
  if (!ids.length) return Response.json({ requests: [] });
  const res = await brokerFetch(`/requests/status?ids=${ids.join(",")}`);
  const data = await res.json().catch(() => ({ requests: [] }));
  return Response.json(data, { status: res.ok ? 200 : res.status });
}
