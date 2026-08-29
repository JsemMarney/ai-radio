import http, {
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { once } from "node:events";
import { IcyStreamEncoder, icyMetaInterval } from "@/lib/icy-stream";
import { getStreamPort } from "@/lib/radio-broker";
import { getRadioEngine } from "@/lib/radio-engine";
import {
  refreshBroadcastLock,
  releaseBroadcastLock,
  tryAcquireBroadcastLock,
} from "@/lib/radio-state";
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
  const payload = `data: ${JSON.stringify(status)}\n\n`;
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
    "icy-br": "192",
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

  if (req.method === "GET" && url.pathname === "/stream") {
    handleStream(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/status") {
    sendJson(res, 200, {
      ...engine.getStatus(),
      streamUrl: "/stream",
    });
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
    const limit = Math.min(10, Number(url.searchParams.get("limit") ?? 5) || 5);
    const upcoming = await engine.getUpcoming(limit);
    sendJson(res, 200, {
      upcoming,
      reserved: engine.reservedNextUuid ?? null,
      queueRemaining: engine.getStatus().queueRemaining,
    });
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
  await releaseBroadcastLock();
}

export async function startBroadcaster(): Promise<void> {
  const locked = await tryAcquireBroadcastLock();
  if (!locked) {
    console.error("[broadcaster] Jiný broadcaster už běží (lock).");
    process.exit(1);
  }

  lockTimer = setInterval(() => {
    void refreshBroadcastLock();
  }, 15_000);

  const engine = getRadioEngine();
  engine.onStatusChange = pushSse;
  await engine.start();

  const port = getStreamPort();
  httpServer = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`[broadcaster] Stream (live)     → http://127.0.0.1:${port}/stream`);
    console.log(`[broadcaster] Status / SSE      → http://127.0.0.1:${port}/events`);
    console.log(`[broadcaster] Real-time pacer   → konstantní tempo, žádné přetáčení`);
  });

  const onSignal = () => {
    void shutdown().finally(() => process.exit(0));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
