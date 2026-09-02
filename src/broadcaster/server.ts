import http, {
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { once } from "node:events";
import { IcyStreamEncoder, icyMetaInterval } from "@/lib/icy-stream";
import {
  getIcecastListenUrl,
  isIcecastEnabled,
  waitForIcecastReady,
} from "@/lib/icecast-config";
import {
  fetchIcecastListeners,
  getCachedIcecastListeners,
} from "@/lib/icecast-stats";
import { IcecastSource } from "@/lib/icecast-source";
import { getStreamPort } from "@/lib/radio-broker";
import { QUEUE_DISPLAY_SIZE } from "@/lib/radio-playlist";
import { areSongRequestsEnabled } from "@/lib/song-requests";
import { getRadioEngine, type RadioStatus } from "@/lib/radio-engine";
import {
  refreshBroadcastLock,
  releaseBroadcastLock,
  tryAcquireBroadcastLock,
} from "@/lib/radio-state";
import { verifyBrokerRequest } from "@/lib/broker-auth";
import { getStreamBitrate } from "@/lib/ffmpeg";
import { getStationConfig } from "@/lib/station-config";

type SseClient = ServerResponse;

type StreamClient = {
  res: ServerResponse;
  icy: IcyStreamEncoder | null;
  closed: boolean;
};

const sseClients = new Set<SseClient>();
const streamClients = new Set<StreamClient>();
let httpServer: Server | null = null;
let lockTimer: ReturnType<typeof setInterval> | null = null;
let lastIcyTitle = "";
let icecastSource: IcecastSource | null = null;
let icecastStatsTimer: ReturnType<typeof setInterval> | null = null;
let detachIcecastSink: (() => void) | null = null;
let lastReportedIcecastListeners = -1;

function withStreamMeta(status: RadioStatus): RadioStatus & {
  streamUrl: string;
  icecastLive: boolean;
} {
  const icecastLive = Boolean(icecastSource?.isConnected);
  if (isIcecastEnabled() && icecastLive) {
    return {
      ...status,
      listeners: getCachedIcecastListeners(),
      streamUrl: getIcecastListenUrl(),
      icecastLive: true,
    };
  }
  return { ...status, streamUrl: "/stream", icecastLive: false };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function pushSse(status: ReturnType<ReturnType<typeof getRadioEngine>["getStatus"]>): void {
  const enriched = withStreamMeta(status);
  const payload = `data: ${JSON.stringify(enriched)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }

  const title = getRadioEngine().getIcyTitle();
  if (title !== lastIcyTitle) {
    lastIcyTitle = title;
    icecastSource?.setTitle(title);
    for (const client of streamClients) {
      if (client.closed || !client.icy) continue;
      client.icy.setTitle(title);
    }
  }
}

async function writeChunk(res: ServerResponse, chunk: Buffer): Promise<void> {
  if (!res.writable) return;
  const ok = res.write(chunk);
  if (!ok) {
    await once(res, "drain");
  }
}

function handleStream(req: IncomingMessage, res: ServerResponse): void {
  if (isIcecastEnabled() && icecastSource?.isConnected) {
    const listenUrl = getIcecastListenUrl();
    res.writeHead(302, {
      Location: listenUrl,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(`Přesměrování na Icecast: ${listenUrl}`);
    return;
  }

  const engine = getRadioEngine();
  const station = getStationConfig();
  const wantsIcy =
    String(req.headers["icy-metadata"] ?? "").toLowerCase() === "1";

  const webPort = process.env.PORT ?? "8787";
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-cache, no-store, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked",
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "none",
    "icy-name": station.name,
    "icy-genre": "Various",
    "icy-br": String(Math.floor(getStreamBitrate() / 1000)),
    "icy-url": `http://127.0.0.1:${webPort}/player`,
    "icy-pub": "1",
  };

  if (wantsIcy) {
    headers["icy-metaint"] = String(icyMetaInterval());
  }

  res.writeHead(200, headers);

  const socket = res.socket;
  socket?.setNoDelay(true);
  socket?.setTimeout(0);

  const icy = wantsIcy ? new IcyStreamEncoder() : null;
  if (icy) icy.setTitle(engine.getIcyTitle());

  const client: StreamClient = { res, icy, closed: false };
  streamClients.add(client);

  const body = engine.subscribe();
  const reader = body.getReader();

  const pump = (): void => {
    reader
      .read()
      .then(async ({ done, value }) => {
        if (client.closed || done) {
          if (!client.closed) res.end();
          return;
        }
        if (value) {
          const buf = Buffer.from(value);
          try {
            if (icy) {
              for (const part of icy.encode(buf)) {
                await writeChunk(res, part);
              }
            } else {
              await writeChunk(res, buf);
            }
          } catch {
            client.closed = true;
            streamClients.delete(client);
            reader.cancel().catch(() => {});
            return;
          }
        }
        pump();
      })
      .catch(() => {
        client.closed = true;
        streamClients.delete(client);
        if (!res.writableEnded) res.end();
      });
  };

  pump();

  const cleanup = () => {
    client.closed = true;
    streamClients.delete(client);
    reader.cancel().catch(() => {});
  };

  req.on("close", cleanup);
  res.on("close", cleanup);
}

function handleEvents(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  sseClients.add(res);
  res.write(`data: ${JSON.stringify(getRadioEngine().getStatus())}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 25_000);

  res.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const engine = getRadioEngine();

  const isControlRoute =
    (req.method === "POST" &&
      url.pathname !== "/request" &&
      !url.pathname.startsWith("/request/")) ||
    url.pathname === "/transition-preview";

  if (isControlRoute && !verifyBrokerRequest(req)) {
    sendJson(res, 401, { error: "Neautorizováno." });
    return;
  }

  if (req.method === "GET" && url.pathname === "/stream") {
    handleStream(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/status") {
    const status = withStreamMeta(engine.getStatus());
    if (isIcecastEnabled()) {
      status.listeners = await fetchIcecastListeners();
    }
    sendJson(res, 200, status);
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    handleEvents(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/skip") {
    engine.skip();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/play") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { uuid?: string };
      const uuid = body.uuid?.trim();
      if (!uuid) {
        sendJson(res, 400, { error: "Chybí uuid." });
        return;
      }
      engine.playNow(uuid);
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 400, { error: "Neplatný JSON." });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/queue") {
    const limit = Math.min(
      QUEUE_DISPLAY_SIZE,
      Number(url.searchParams.get("limit") ?? QUEUE_DISPLAY_SIZE) || QUEUE_DISPLAY_SIZE,
    );
    const preview = await engine.getQueuePreview(limit);
    sendJson(res, 200, preview);
    return;
  }

  if (req.method === "GET" && url.pathname === "/requests") {
    if (!areSongRequestsEnabled()) {
      sendJson(res, 200, { enabled: false, tracks: [], pending: 0 });
      return;
    }
    const search = url.searchParams.get("search") ?? undefined;
    const limit = Math.min(60, Number(url.searchParams.get("limit") ?? 40) || 40);
    const tracks = await engine.getRequestableTracks(search, limit);
    sendJson(res, 200, {
      enabled: true,
      tracks,
      pending: engine.getStatus().requestsPending,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/request") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { uuid?: string };
      const uuid = body.uuid?.trim();
      if (!uuid) {
        sendJson(res, 400, { error: "Chybí uuid." });
        return;
      }
      const result = await engine.submitListenerRequest(uuid);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch {
      sendJson(res, 400, { error: "Neplatný JSON." });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/queue/remove") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { uuid?: string };
      const uuid = body.uuid?.trim();
      if (!uuid) {
        sendJson(res, 400, { error: "Chybí uuid." });
        return;
      }
      const ok = await engine.removeFromQueue(uuid);
      sendJson(res, ok ? 200 : 404, { ok });
    } catch {
      sendJson(res, 400, { error: "Neplatný JSON." });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/test-transition") {
    engine.testTransition();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/test-midsong") {
    engine.testMidsong();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/transition-preview") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const previewPath = await engine.renderTransitionPreview(from, to);
    if (!previewPath) {
      sendJson(res, 400, { error: "Nelze vygenerovat náhled přechodu." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      Connection: "close",
    });

    const stream = createReadStream(previewPath);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void unlink(previewPath).catch(() => {});
    };

    stream.pipe(res);
    stream.on("error", () => {
      cleanup();
      if (!res.headersSent) sendJson(res, 500, { error: "Náhled selhal." });
    });
    stream.on("close", cleanup);
    res.on("close", cleanup);
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, pid: process.pid });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function shutdown(): Promise<void> {
  if (lockTimer) {
    clearInterval(lockTimer);
    lockTimer = null;
  }
  if (icecastStatsTimer) {
    clearInterval(icecastStatsTimer);
    icecastStatsTimer = null;
  }
  detachIcecastSink?.();
  detachIcecastSink = null;
  await icecastSource?.stop();
  icecastSource = null;

  for (const client of sseClients) {
    try {
      client.end();
    } catch {
      // ignore
    }
  }
  sseClients.clear();
  streamClients.clear();

  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    });
    httpServer = null;
  }

  await getRadioEngine().stop();
}

/** Napojí plné API na existující HTTP server a spustí engine na pozadí. */
export function attachBroadcasterEngine(server: Server): void {
  httpServer = server;
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, pid: process.pid, booting: false });
      return;
    }
    void handleRequest(req, res);
  });

  const port = getStreamPort();
  if (isIcecastEnabled()) {
    console.log(
      `[broadcaster] Icecast zapnutý — posluchači: ${getIcecastListenUrl()} (nebo :8788/stream dokud Icecast nestartuje)`,
    );
  } else {
    console.log(`[broadcaster] Stream (live)     → http://127.0.0.1:${port}/stream`);
  }
  console.log(`[broadcaster] Status / SSE      → http://127.0.0.1:${port}/events`);
  console.log(`[broadcaster] Real-time pacer   → konstantní tempo, žádné přetáčení`);

  const engine = getRadioEngine();
  engine.onStatusChange = pushSse;

  if (isIcecastEnabled()) {
    void (async () => {
      const ready = await waitForIcecastReady(15_000);
      if (!ready) {
        console.warn(
          "[broadcaster] Icecast neběží — stream přes http://127.0.0.1:8788/stream",
        );
        return;
      }
      icecastSource = new IcecastSource();
      await icecastSource.start();
      if (!icecastSource.isConnected) return;

      detachIcecastSink = engine.attachSink((chunk) => {
        icecastSource?.write(Buffer.from(chunk));
      });
      icecastStatsTimer = setInterval(() => {
        void fetchIcecastListeners().then((count) => {
          if (count === lastReportedIcecastListeners) return;
          lastReportedIcecastListeners = count;
          pushSse(engine.getStatus());
        });
      }, 5_000);
    })();
  }

  console.log("[broadcaster] Načítám knihovnu…");
  void engine
    .start()
    .then(() => {
      console.log("[broadcaster] Engine běží.");
    })
    .catch((error: unknown) => {
      console.error(
        "[broadcaster] Engine start selhal:",
        error instanceof Error ? error.message : error,
      );
    });
}

/** @deprecated použij scripts/broadcaster.ts bootstrap */
export async function startBroadcaster(): Promise<void> {
  console.log("[broadcaster] Spouštím…");

  const locked = await tryAcquireBroadcastLock();
  if (!locked) {
    console.error("[broadcaster] Jiný broadcaster už běží (lock).");
    process.exit(1);
  }

  lockTimer = setInterval(() => {
    void refreshBroadcastLock();
  }, 15_000);

  const port = getStreamPort();
  httpServer = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer!.once("error", reject);
    httpServer!.listen(port, "127.0.0.1", () => resolve());
  });

  await attachBroadcasterEngine(httpServer);

  const onSignal = () => {
    void shutdown().finally(() => process.exit(0));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
