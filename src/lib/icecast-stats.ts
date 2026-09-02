import {
  getIcecastAdminBaseUrl,
  getIcecastAdminPassword,
  getIcecastAdminUser,
  getIcecastMount,
  isIcecastEnabled,
} from "@/lib/icecast-config";

type IcecastJsonStats = {
  icestats?: {
    source?: {
      listeners?: number;
      listener_peak?: number;
    };
    sources?: Array<{
      listenurl?: string;
      mount?: string;
      listeners?: number;
    }>;
  };
};

let cachedListeners = 0;
let lastFetchMs = 0;

export function getCachedIcecastListeners(): number {
  return cachedListeners;
}

export async function fetchIcecastListeners(): Promise<number> {
  if (!isIcecastEnabled()) return 0;

  const now = Date.now();
  if (now - lastFetchMs < 4_000) return cachedListeners;
  lastFetchMs = now;

  const mount = getIcecastMount();
  const auth = Buffer.from(
    `${getIcecastAdminUser()}:${getIcecastAdminPassword()}`,
  ).toString("base64");

  try {
    const res = await fetch(
      `${getIcecastAdminBaseUrl()}/admin/stats?mode=json`,
      {
        headers: { Authorization: `Basic ${auth}` },
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!res.ok) return cachedListeners;

    const data = (await res.json()) as IcecastJsonStats;
    const stats = data.icestats;
    if (!stats) return cachedListeners;

    if (Array.isArray(stats.sources)) {
      const match = stats.sources.find(
        (s) => s.mount === mount || s.listenurl?.endsWith(mount),
      );
      if (match?.listeners != null) {
        cachedListeners = match.listeners;
        return cachedListeners;
      }
    }

    if (stats.source?.listeners != null) {
      cachedListeners = stats.source.listeners;
    }
  } catch {
    // Icecast ještě nestartoval nebo není dostupný
  }

  return cachedListeners;
}
