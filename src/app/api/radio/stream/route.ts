import { getRadioStation } from "@/lib/radio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const station = getRadioStation();
  await station.start();
  const body = station.subscribe();

  return new Response(body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked",
    },
  });
}
