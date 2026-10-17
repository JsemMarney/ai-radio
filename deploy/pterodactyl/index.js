"use strict";
/**
 * Miss Radio — startér pro hosting s jedním portem (Pterodactyl, Node.js egg).
 *
 * Spustí:
 *  1. broadcaster (engine rádia) jako podproces na 127.0.0.1:8788,
 *  2. web (Next.js) na přiděleném portu serveru,
 *  3. přeposílání mikrofonu ze studia (WebSocket /mic) na broadcaster.
 *
 * ffmpeg/ffprobe bere z npm balíčků, yt-dlp si při prvním startu stáhne do ./bin.
 */
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const { fork } = require("node:child_process");

const ROOT = __dirname;
process.chdir(ROOT);
process.env.NODE_ENV = "production";

// .env / .env.local ze složky serveru (Next je načte i sám, broadcaster taky).
try {
  require("@next/env").loadEnvConfig(ROOT, false, { info() {}, error: console.error });
} catch {
  // @next/env je součástí balíčku next — bez něj jen proměnné z panelu
}

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 8787);
const RADIO_PORT = Number(process.env.RADIO_STREAM_PORT || 8788);
process.env.PORT = String(PORT);
process.env.RADIO_STREAM_PORT = String(RADIO_PORT);
process.env.RADIO_BROKER_URL = process.env.RADIO_BROKER_URL || `http://127.0.0.1:${RADIO_PORT}`;
process.env.RADIO_MIC_PROXY = "1";

const log = (...args) => console.log("[start]", ...args);

// ───────── nástroje ─────────

function useBinaryFromPackage(envKey, pkg, pick) {
  if (process.env[envKey]) return;
  try {
    const p = pick(require(pkg));
    if (p && fs.existsSync(p)) {
      try {
        fs.chmodSync(p, 0o755);
      } catch {
        // jen pro čtení — zkusíme i tak
      }
      process.env[envKey] = p;
      log(`${envKey} = ${p}`);
    }
  } catch {
    log(`Balíček ${pkg} chybí — spusť "npm install".`);
  }
}

useBinaryFromPackage("FFMPEG_PATH", "ffmpeg-static", (m) => m);
useBinaryFromPackage("FFPROBE_PATH", "ffprobe-static", (m) => m.path);

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "miss-radio" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          download(res.headers.location, dest, redirects - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const tmp = `${dest}.part`;
        const out = fs.createWriteStream(tmp);
        res.pipe(out);
        out.on("finish", () => out.close(() => {
          fs.renameSync(tmp, dest);
          resolve();
        }));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

/** yt-dlp jako samostatný soubor (nepotřebuje Python). */
async function ensureYtDlp() {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) return;
  const bin = path.join(ROOT, "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (!fs.existsSync(bin)) {
    const asset =
      process.platform === "win32"
        ? "yt-dlp.exe"
        : process.platform === "darwin"
          ? "yt-dlp_macos"
          : process.arch === "arm64"
            ? "yt-dlp_linux_aarch64"
            : "yt-dlp_linux";
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    log(`Stahuji yt-dlp (${asset})…`);
    try {
      await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, bin);
      fs.chmodSync(bin, 0o755);
    } catch (err) {
      log(`yt-dlp se nepodařilo stáhnout (${err.message}) — import ze Spotify nebude fungovat.`);
      return;
    }
  }
  process.env.YTDLP_PATH = bin;
}

/** Build vznikl na jiném počítači — opravit absolutní cestu projektu. */
function fixBuildPaths() {
  const file = path.join(ROOT, ".next", "required-server-files.json");
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data.appDir !== ROOT) {
      data.appDir = ROOT;
      fs.writeFileSync(file, JSON.stringify(data));
    }
  } catch {
    // soubor chybí — nevadí
  }
}

// ───────── broadcaster ─────────

let broadcaster = null;
let shuttingDown = false;
let restartDelay = 1000;

function startBroadcaster() {
  broadcaster = fork(path.join(ROOT, "dist", "broadcaster.cjs"), [], {
    env: process.env,
    stdio: "inherit",
  });
  const startedAt = Date.now();
  broadcaster.on("exit", (code) => {
    broadcaster = null;
    if (shuttingDown) return;
    // Rychlý pád hned po startu → čekat déle, ať se to netočí dokola.
    restartDelay = Date.now() - startedAt > 60_000 ? 1000 : Math.min(restartDelay * 2, 30_000);
    log(`Broadcaster skončil (kód ${code}), restart za ${restartDelay / 1000} s…`);
    setTimeout(startBroadcaster, restartDelay);
  });
}

// ───────── web + mikrofon na jednom portu ─────────

/** WebSocket mikrofonu (/mic) přeposlat na broadcaster beze změny. */
function proxyMicUpgrade(req, socket, head) {
  if (!req.url || !req.url.startsWith("/mic")) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(RADIO_PORT, "127.0.0.1", () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    raw += "\r\n";
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

async function main() {
  fixBuildPaths();
  await ensureYtDlp();
  startBroadcaster();

  const next = require("next");
  const app = next({ dev: false, dir: ROOT, hostname: "0.0.0.0", port: PORT });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = http.createServer((req, res) => handle(req, res));
  server.on("upgrade", proxyMicUpgrade);
  server.listen(PORT, "0.0.0.0", () => {
    log(`Miss Radio běží na portu ${PORT} — přehrávač /player, studio /studio`);
  });

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("Vypínám…");
    if (broadcaster) broadcaster.kill("SIGTERM");
    server.close();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Pterodactyl umí poslat příkaz "stop" do konzole.
  process.stdin.on("data", (d) => {
    if (String(d).trim().toLowerCase() === "stop") shutdown();
  });
}

main().catch((err) => {
  console.error("[start] Start selhal:", err);
  process.exit(1);
});
