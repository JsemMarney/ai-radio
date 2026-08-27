import { getRadioStation } from "@/lib/radio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  getRadioStation().skip();
  return Response.json({ ok: true });
}
