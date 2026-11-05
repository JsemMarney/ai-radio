import { listMessages, updateMessages } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vzkazy posluchačů pro moderátora. */
export async function GET() {
  return Response.json({ messages: await listMessages() });
}

/** { action: "read" | "delete" | "readAll", id? } */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; id?: unknown };
  const action = body.action;
  if (action !== "read" && action !== "delete" && action !== "readAll") {
    return Response.json({ ok: false, error: "Neznámá akce." }, { status: 400 });
  }
  const ok = await updateMessages(action, typeof body.id === "string" ? body.id : undefined);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
