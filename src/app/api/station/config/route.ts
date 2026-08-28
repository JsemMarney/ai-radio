import { getStationConfig } from "@/lib/station-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getStationConfig());
}
