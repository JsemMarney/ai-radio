import http from "node:http";
import { loadEnvFiles } from "../src/lib/load-env";
import { getStreamPort } from "../src/lib/radio-broker";
import {
  refreshBroadcastLock,
  releaseBroadcastLock,
  tryAcquireBroadcastLock,
} from "../src/lib/radio-state";

loadEnvFiles();

console.log("[broadcaster] Spouštím HTTP…");

let lockTimer: ReturnType<typeof setInterval> | null = null;

async function main(): Promise<void> {
  const locked = await tryAcquireBroadcastLock();
  if (!locked) {
    console.error("[broadcaster] Jiný broadcaster už běží (lock).");
    process.exit(1);
  }

  lockTimer = setInterval(() => {
    void refreshBroadcastLock();
  }, 15_000);

  const port = getStreamPort();
  const server = http.createServer((req, res) => {
    const pathOnly = req.url?.split("?")[0] ?? "/";
    if (req.method === "GET" && pathOnly === "/health") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ ok: true, pid: process.pid, booting: true }));
      return;
    }
    if (req.method === "GET" && pathOnly === "/queue") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          upcoming: [],
          schedule: [],
          nextUp: null,
          queueRemaining: 0,
          reserved: null,
          booting: true,
        }),
      );
      return;
    }
    if (req.method === "GET" && pathOnly === "/status") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          broadcasting: false,
          booting: true,
          nowPlaying: null,
          trackStartedAt: null,
          recentlyPlayed: [],
          listeners: 0,
          queueRemaining: 0,
        }),
      );
      return;
    }
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ error: "Engine se načítá…" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  console.log(`[broadcaster] HTTP ready → http://127.0.0.1:${port}/health`);

  setImmediate(() => {
    void (async () => {
      console.log("[broadcaster] Načítám engine…");
      try {
        const { attachBroadcasterEngine } = await import(
          "../src/broadcaster/server"
        );
        attachBroadcasterEngine(server);
      } catch (error) {
        console.error("[broadcaster] Engine load selhal:", error);
      }
    })();
  });

  const onSignal = () => {
    if (lockTimer) clearInterval(lockTimer);
    void releaseBroadcastLock().finally(() => process.exit(0));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

main().catch((error: unknown) => {
  console.error("[broadcaster] Start selhal:", error);
  process.exit(1);
});
