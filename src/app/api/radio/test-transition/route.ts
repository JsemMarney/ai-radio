import { brokerFetch } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = await brokerFetch("/test-transition", { method: "POST" });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };

  if (!res.ok) {
    return Response.json(
      { error: data.error ?? "Test přechodu selhal." },
      { status: res.status },
    );
  }

  return Response.json({ ok: true });
}
