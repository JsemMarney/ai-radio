export function getBrokerUrl(): string {
  return process.env.RADIO_BROKER_URL ?? "http://127.0.0.1:8788";
}

export function getStreamPort(): number {
  const raw = process.env.RADIO_STREAM_PORT ?? "8788";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 8788;
}

export async function brokerFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${getBrokerUrl()}${path}`;
  try {
    return await fetch(url, { ...init, cache: "no-store" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Broker unreachable";
    return new Response(JSON.stringify({ error: message }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
