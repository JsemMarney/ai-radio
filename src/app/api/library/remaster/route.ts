import { NextResponse } from "next/server";
import { getRemasterJob, startRemasterJob } from "@/lib/remaster";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Chybí id." }, { status: 400 });
  }
  const job = await getRemasterJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job nenalezen." }, { status: 404 });
  }
  return NextResponse.json({ job });
}

export async function POST(request: Request) {
  let force = false;
  try {
    const body = (await request.json()) as { force?: boolean };
    force = body.force === true;
  } catch {
    // default force false
  }
  const job = await startRemasterJob(force);
  return NextResponse.json({ job });
}
