import path from "node:path";
import net from "node:net";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { getStationConfig } from "@/lib/station-config";

function envFlag(name: string, defaultOn = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isIcecastEnabled(): boolean {
  return envFlag("ICECAST_ENABLED", false);
}

export function getIcecastHost(): string {
  return process.env.ICECAST_HOST?.trim() || "127.0.0.1";
}

export function getIcecastPort(): number {
  const raw = Number(process.env.ICECAST_PORT ?? 8000);
  return Number.isFinite(raw) && raw > 0 ? raw : 8000;
}

export function getIcecastMount(): string {
  const mount = process.env.ICECAST_MOUNT?.trim() || "/radio.mp3";
  return mount.startsWith("/") ? mount : `/${mount}`;
}

export function getIcecastSourcePassword(): string {
  return process.env.ICECAST_SOURCE_PASSWORD?.trim() || "";
}

export function getIcecastRelayPassword(): string {
  return (
    process.env.ICECAST_RELAY_PASSWORD?.trim() || getIcecastSourcePassword()
  );
}

const WEAK_ICECAST_PASSWORDS = new Set(["", "hackme", "admin", "password", "changeme", "change-me"]);

/** Vrátí popis problému, když Icecast hesla chybí nebo jsou výchozí. */
export function getIcecastSecretProblem(): string | null {
  const weak = (v: string) => WEAK_ICECAST_PASSWORDS.has(v.toLowerCase()) || v.length < 12;
  if (weak(getIcecastSourcePassword())) {
    return "ICECAST_SOURCE_PASSWORD chybí nebo je slabé (min. 12 znaků, ne „hackme“).";
  }
  if (weak(getIcecastAdminPassword())) {
    return "ICECAST_ADMIN_PASSWORD chybí nebo je slabé (min. 12 znaků, ne „hackme“).";
  }
  return null;
}

export function getIcecastAdminUser(): string {
  return process.env.ICECAST_ADMIN_USER?.trim() || "admin";
}

export function getIcecastAdminPassword(): string {
  return process.env.ICECAST_ADMIN_PASSWORD?.trim() || "";
}

/** Veřejná URL pro posluchače (může být jiná než interní host). */
export function getIcecastListenUrl(origin?: string): string {
  const explicit = process.env.ICECAST_LISTEN_URL?.trim();
  if (explicit) return explicit;

  const publicHost = process.env.ICECAST_PUBLIC_HOST?.trim();
  if (publicHost) {
    const port = process.env.ICECAST_PUBLIC_PORT?.trim();
    const mount = getIcecastMount();
    if (publicHost.includes("://")) {
      return `${publicHost.replace(/\/$/, "")}${mount}`;
    }
    const withPort = port ? `${publicHost}:${port}` : publicHost;
    return `http://${withPort}${mount}`;
  }

  if (origin && process.env.ICECAST_PROXY_PATH?.trim()) {
    const proxyPath = process.env.ICECAST_PROXY_PATH.trim();
    return `${origin.replace(/\/$/, "")}${proxyPath}${getIcecastMount()}`;
  }

  return `http://${getIcecastHost()}:${getIcecastPort()}${getIcecastMount()}`;
}

export function getIcecastSourceUrl(): string {
  const host = getIcecastHost();
  const port = getIcecastPort();
  const mount = getIcecastMount();
  const pass = encodeURIComponent(getIcecastSourcePassword());
  return `icecast://source:${pass}@${host}:${port}${mount}`;
}

export function getIcecastAdminBaseUrl(): string {
  return `http://${getIcecastHost()}:${getIcecastPort()}`;
}

/** Šablona configu v repu — hesla se doplní z env. */
export function getIcecastTemplatePath(): string {
  return path.join(process.cwd(), "config", "icecast.example.xml");
}

function escapeXml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderIcecastConfig(template: string): string {
  return template
    .replace(/\{\{ICECAST_SOURCE_PASSWORD\}\}/g, () => escapeXml(getIcecastSourcePassword()))
    .replace(/\{\{ICECAST_RELAY_PASSWORD\}\}/g, () => escapeXml(getIcecastRelayPassword()))
    .replace(/\{\{ICECAST_ADMIN_PASSWORD\}\}/g, () => escapeXml(getIcecastAdminPassword()));
}

export function getIcecastConfigPath(): string {
  return (
    process.env.ICECAST_CONFIG?.trim() ||
    path.join(process.cwd(), "config", "icecast.xml")
  );
}

/** Počká, až Icecast HTTP port odpoví (max ~30 s). */
export async function waitForIcecastReady(
  timeoutMs = 30_000,
): Promise<boolean> {
  const port = getIcecastPort();
  const host = getIcecastHost();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 800);
    });
    if (open) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const ICECAST_BIN_CANDIDATES = [
  process.env.ICECAST_BIN,
  "icecast",
  "icecast2",
  path.join(process.env.USERPROFILE ?? "", "scoop", "shims", "icecast.exe"),
  path.join(process.env.ProgramFiles ?? "", "Icecast", "bin", "icecast.exe"),
  "C:\\Program Files\\Icecast\\bin\\icecast.exe",
  "/usr/bin/icecast2",
  "/usr/local/bin/icecast",
  "/opt/homebrew/bin/icecast",
];

export function resolveIcecastBin(): string | null {
  for (const candidate of ICECAST_BIN_CANDIDATES) {
    if (!candidate) continue;
    if (candidate.includes(path.sep) || candidate.includes("/")) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const out = execFileSync(cmd, [candidate], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split(/\r?\n/)[0];
      if (out && existsSync(out)) return out;
    } catch {
      // not in PATH
    }
  }
  return null;
}

export function getPublicStreamUrl(origin?: string): string {
  if (isIcecastEnabled()) return getIcecastListenUrl(origin);
  if (origin) return `${origin.replace(/\/$/, "")}/api/radio/stream`;
  return "/api/radio/stream";
}

export function getIcecastStationName(): string {
  return getStationConfig().name;
}
