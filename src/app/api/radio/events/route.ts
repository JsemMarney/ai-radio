import { brokerFetch, brokerStream } from "@/lib/radio-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-store",
  Connection: "keep-alive",
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function offlinePayload(): string {
  return `data: ${JSON.stringify({
    broadcasting: false,
    nowPlaying: null,
    trackStartedAt: null,
    recentlyPlayed: [],
    listeners: 0,
    queueRemaining: 0,
    offline: true,
  })}\n\n`;
}

/** Drží jedno SSE spojení — při výpadku brokera pošle offline a znovu zkusí připojit. */
export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let attempt = 0;

      while (!closed) {
        const res = await brokerStream("/events");

        if (res.ok && res.body) {
          attempt = 0;
          const reader = res.body.getReader();

          try {
            while (!closed) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value?.byteLength) controller.enqueue(value);
            }
          } catch {
            // broker spadl uprostřed streamu
          } finally {
            reader.cancel().catch(() => {});
          }

          if (closed) break;
          await sleep(1500);
          continue;
        }

        attempt += 1;
        try {
          controller.enqueue(encoder.encode(offlinePayload()));
        } catch {
          break;
        }

        const waitMs = Math.min(30_000, 2000 * Math.min(attempt, 5));
        await sleep(waitMs);
      }

      try {
        controller.close();
      } catch {
        // already closed
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
