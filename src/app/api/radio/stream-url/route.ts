import { getPublicStreamUrl, isIcecastEnabled } from "@/lib/icecast-config";
import { brokerFetch } from "@/lib/radio-broker";
import { signPath, isLinkSigningEnabled } from "@/lib/link-signing";
import { STREAM_URL } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  if (isIcecastEnabled()) {
    const statusRes = await brokerFetch("/status");
    if (statusRes.ok) {
      const data = (await statusRes.json()) as { icecastLive?: boolean; streamUrl?: string };
      if (data.icecastLive && data.streamUrl) {
        return Response.json({
          url: data.streamUrl,
          expiresAt: null,
          signed: false,
          icecast: true,
        });
      }
    }
  }

  const path = STREAM_URL;

  if (isLinkSigningEnabled()) {
    const signed = signPath(path);
    return Response.json({
      url: `${origin}${signed.url}`,
      expiresAt: signed.exp,
      signed: true,
      icecast: false,
    });
  }

  return Response.json({
    url: getPublicStreamUrl(origin),
    expiresAt: null,
    signed: false,
    icecast: false,
  });
}
