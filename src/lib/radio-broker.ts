import { brokerAuthHeaders } from "@/lib/broker-auth";

export function getBrokerUrl(): string {
  return process.env.RADIO_BROKER_URL ?? "http://127.0.0.1:8788";
}

export function getStreamPort(): number {
  const raw = process.env.RADIO_STREAM_PORT ?? "8788";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 8788;
}

export type BrokerFetchInit = RequestInit & {
  /** Timeout v ms. 0 = bez limitu (stream/SSE). Výchozí 8 s pro krátké API. */
  timeoutMs?: number;
};

export async function brokerFetch(
  path: string,
  init?: BrokerFetchInit,
): Promise<Response> {
  const url = `${getBrokerUrl()}${path}`;
  const { timeoutMs: timeoutOverride, ...fetchInit } = init ?? {};
  const headers = new Headers(fetchInit.headers);
  for (const [key, value] of Object.entries(brokerAuthHeaders())) {
    headers.set(key, value);
  }

  const defaultTimeout = Number(process.env.RADIO_BROKER_TIMEOUT_MS ?? 8_000);
  const timeoutMs =
    timeoutOverride !== undefined ? timeoutOverride : defaultTimeout;

  const signal =
    fetchInit.signal ??
    (Number.isFinite(timeoutMs) && timeoutMs > 0
      ? AbortSignal.timeout(timeoutMs)
      : undefined);

  try {
    return await fetch(url, { ...fetchInit, headers, cache: "no-store", signal });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Broker unreachable";
    return new Response(JSON.stringify({ error: message }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/** Dlouhodobé spojení — stream, SSE (bez timeoutu). */
export function brokerStream(path: string, init?: Omit<BrokerFetchInit, "timeoutMs">) {
  return brokerFetch(path, { ...init, timeoutMs: 0 });
}
