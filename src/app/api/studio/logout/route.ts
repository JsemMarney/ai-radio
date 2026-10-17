import { cookies } from "next/headers";
import {
  STUDIO_COOKIE,
  getStudioPassword,
  revokeSession,
  verifySession,
} from "@/lib/studio-auth";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(STUDIO_COOKIE)?.value;
  // Odvolat jen platný token — jinak by šlo zaplnit seznam smetím.
  if (token && (await verifySession(token, getStudioPassword()))) {
    revokeSession(token);
  }
  jar.delete(STUDIO_COOKIE);
  return Response.json({ ok: true });
}
