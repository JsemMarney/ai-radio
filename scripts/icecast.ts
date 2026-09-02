import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { loadEnvFiles } from "../src/lib/load-env";
import {
  getIcecastConfigPath,
  getIcecastPort,
  isIcecastEnabled,
  resolveIcecastBin,
} from "../src/lib/icecast-config";

loadEnvFiles();

function portInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);
  });
}

function runtimePaths(bin: string, config: string) {
  const binDir = path.dirname(bin);
  const configDir = path.dirname(config);
  const installDir =
    path.basename(binDir).toLowerCase() === "bin"
      ? path.dirname(binDir)
      : configDir;
  const configFile =
    path.resolve(configDir) === path.resolve(installDir)
      ? path.basename(config)
      : config;
  return { binDir, installDir, configFile };
}

async function main(): Promise<void> {
  if (!isIcecastEnabled()) {
    console.log("[icecast] Vypnuto (ICECAST_ENABLED=0).");
    return;
  }

  const bin = resolveIcecastBin();
  const config = getIcecastConfigPath();

  if (!bin) {
    console.warn("[icecast] Icecast není nainstalovaný.");
    console.warn("[icecast] Nastav ICECAST_BIN v .env.local");
    await new Promise<void>(() => {});
    return;
  }

  if (!existsSync(config)) {
    console.error(`[icecast] Chybí config: ${config}`);
    process.exit(1);
  }

  const { binDir, installDir, configFile } = runtimePaths(bin, config);
  let child: ChildProcess | null = null;
  let stopping = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let warnedCrash = false;

  const spawnIcecast = async (): Promise<void> => {
    if (stopping) return;

    const port = getIcecastPort();
    if (await portInUse(port)) {
      console.log(
        `[icecast] Port ${port} už běží — předpokládám spuštěný Icecast server.`,
      );
      await new Promise<void>(() => {});
      return;
    }

    console.log(
      `[icecast] Start → ${bin} -c ${configFile} (cwd: ${installDir})`,
    );

    child = spawn(bin, ["-c", configFile], {
      cwd: installDir,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      stdio: "inherit",
      windowsHide: false,
    });

    child.on("error", (err) => {
      console.error("[icecast] Start selhal:", err.message);
      scheduleRestart();
    });

    child.on("close", (code) => {
      child = null;
      if (stopping) return;
      if (code === 0) return;
      if (!warnedCrash) {
        warnedCrash = true;
        console.warn(`[icecast] Proces skončil (kód ${code ?? "?"}). Restart…`);
      }
      scheduleRestart();
    });
  };

  const scheduleRestart = () => {
    if (stopping || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void spawnIcecast();
    }, 3_000);
  };

  const shutdown = () => {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    child?.kill("SIGTERM");
    setTimeout(() => child?.kill("SIGKILL"), 2_000);
    setTimeout(() => process.exit(0), 2_500);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await spawnIcecast();
}

void main();
