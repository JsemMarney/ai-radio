import { cookies } from "next/headers";
import { STUDIO_COOKIE } from "@/lib/studio-auth";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  jar.delete(STUDIO_COOKIE);
  return Response.json({ ok: true });
}
