import { getPublicStreamUrl, isIcecastEnabled } from "@/lib/icecast-config";
import { brokerFetch } from "@/lib/radio-broker";
import { signPath, isLinkSigningEnabled } from "@/lib/link-signing";
import { STREAM_URL } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const aac = requestUrl.searchParams.get("format") === "aac";
  const withFormat = (u: string) =>
    aac ? `${u}${u.includes("?") ? "&" : "?"}format=aac` : u;

  // Icecast vysílá jen MP3 — AAC jde vždy přes broker.
  if (isIcecastEnabled() && !aac) {
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
      // Relativní URL — stejný origin jako stránka (CSP media-src 'self').
      url: withFormat(signed.url),
      expiresAt: signed.exp,
      signed: true,
      icecast: false,
    });
  }

  return Response.json({
    url: withFormat(aac || !isIcecastEnabled() ? path : getPublicStreamUrl(origin)),
    expiresAt: null,
    signed: false,
    icecast: false,
  });
}
