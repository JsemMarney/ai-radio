import { NextResponse } from "next/server";
import { listRecentJobs } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Seznam importů (běžící, čekající, nedávno hotové). */
export async function GET() {
  return NextResponse.json({ jobs: await listRecentJobs() });
}
