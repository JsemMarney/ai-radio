import net from "node:net";
import {
  getIcecastAdminBaseUrl,
  getIcecastAdminPassword,
  getIcecastAdminUser,
  getIcecastHost,
  getIcecastMount,
  getIcecastPort,
  getIcecastSourcePassword,
  getIcecastStationName,
  isIcecastEnabled,
} from "@/lib/icecast-config";
import { getStationConfig } from "@/lib/station-config";
import { getStreamBitrate } from "@/lib/ffmpeg";

/** Posílá MP3 z RadioEngine do Icecast mountu (SOURCE / ICE/1.0). */
export class IcecastSource {
  private socket: net.Socket | null = null;
  private started = false;
  private stopping = false;
  private connecting = false;
  private connected = false;
  private pendingTitle = "";
  private currentTitle = "";
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private writeQueue: Buffer[] = [];
  private draining = false;
  private warnedOnce = false;
  private failCount = 0;

  async start(_ffmpegPath?: string): Promise<void> {
    if (!isIcecastEnabled()) return;
    this.stopping = false;
    await this.connect();
    this.started = true;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get active(): boolean {
    return this.started && !this.stopping;
  }

  setTitle(title: string): void {
    if (!title || title === this.pendingTitle || title === this.currentTitle) {
      return;
    }
    this.pendingTitle = title;
    if (this.connected) {
      void this.pushMetadata(title);
    }
  }

  write(chunk: Buffer): void {
    if (this.stopping || !this.connected) return;
    this.enqueueWrite(chunk);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.writeQueue = [];
    this.connected = false;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
    }
    this.started = false;
  }

  private enqueueWrite(chunk: Buffer): void {
    this.writeQueue.push(chunk);
    if (!this.draining) this.flushWrites();
  }

  private flushWrites(): void {
    const socket = this.socket;
    if (!socket?.writable || this.stopping) return;

    this.draining = true;
    while (this.writeQueue.length > 0) {
      const chunk = this.writeQueue[0];
      try {
        const ok = socket.write(chunk);
        if (!ok) {
          socket.once("drain", () => {
            this.draining = false;
            this.flushWrites();
          });
          return;
        }
        this.writeQueue.shift();
      } catch {
        this.handleDisconnect();
        this.draining = false;
        return;
      }
    }
    this.draining = false;
  }

  private warnOnce(message: string): void {
    if (this.warnedOnce) return;
    this.warnedOnce = true;
    console.warn(`[icecast-source] ${message}`);
  }

  private async connect(): Promise<void> {
    if (this.stopping || this.connecting || this.connected) return;
    this.connecting = true;

    const host = getIcecastHost();
    const port = getIcecastPort();
    const mount = getIcecastMount();
    const password = getIcecastSourcePassword();
    const station = getIcecastStationName();
    const tagline = getStationConfig().tagline;
    const bitrateKbps = Math.floor(getStreamBitrate() / 1000);

    await new Promise<void>((resolve) => {
      const socket = net.connect({ host, port });
      let headerBuf = "";
      const headerTimeout = setTimeout(() => {
        fail("Icecast neodpovídá");
      }, 5_000);

      const fail = (_reason: string) => {
        clearTimeout(headerTimeout);
        socket.destroy();
        this.connecting = false;
        this.failCount += 1;
        if (this.failCount === 1) {
          this.warnOnce(
            "Icecast neběží — stream jede přes :8788/stream. Zapni Icecast nebo nastav ICECAST_ENABLED=0.",
          );
        }
        if (!this.stopping && this.failCount < 20) {
          this.scheduleReconnect();
        }
        resolve();
      };

      socket.setNoDelay(true);
      socket.setTimeout(0);

      socket.on("data", (buf) => {
        headerBuf += buf.toString("utf8");
        if (!headerBuf.includes("\r\n\r\n") && !headerBuf.includes("\n\n")) {
          return;
        }
        if (!/200|OK/i.test(headerBuf)) {
          fail("Icecast odmítl source");
          return;
        }

        clearTimeout(headerTimeout);
        this.socket = socket;
        this.connected = true;
        this.connecting = false;
        this.failCount = 0;
        this.warnedOnce = false;
        console.log(`[icecast-source] Připojeno → ${host}:${port}${mount}`);

        socket.removeAllListeners("data");
        socket.on("error", () => this.handleDisconnect());
        socket.on("close", () => this.handleDisconnect());

        if (this.pendingTitle) {
          void this.pushMetadata(this.pendingTitle);
        }

        this.flushWrites();
        resolve();
      });

      socket.on("error", () => fail("connect failed"));

      socket.on("connect", () => {
        const auth = Buffer.from(`source:${password}`).toString("base64");
        const headers = [
          `SOURCE ${mount} ICE/1.0`,
          `Authorization: Basic ${auth}`,
          "Content-Type: audio/mpeg",
          `Ice-Name: ${sanitizeHeader(station)}`,
          `Ice-Description: ${sanitizeHeader(tagline || station)}`,
          "Ice-Genre: Various",
          "Ice-Public: 1",
          `ice-audio-info: bitrate=${bitrateKbps};samplerate=44100;channels=2`,
          "",
          "",
        ].join("\r\n");
        socket.write(headers);
      });
    });
  }

  private handleDisconnect(): void {
    if (this.stopping) return;

    this.connected = false;
    this.connecting = false;
    this.socket?.destroy();
    this.socket = null;
    this.writeQueue = [];

    if (!this.stopping && this.failCount < 20) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.restartTimer) return;
    const delay = Math.min(60_000, 5_000 * Math.max(1, this.failCount));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.connect();
    }, delay);
  }

  private async pushMetadata(title: string): Promise<void> {
    const auth = Buffer.from(
      `${getIcecastAdminUser()}:${getIcecastAdminPassword()}`,
    ).toString("base64");
    const mount = encodeURIComponent(getIcecastMount());
    const song = encodeURIComponent(title);

    try {
      const res = await fetch(
        `${getIcecastAdminBaseUrl()}/admin/metadata?mount=${mount}&mode=updinfo&song=${song}`,
        {
          headers: { Authorization: `Basic ${auth}` },
          cache: "no-store",
          signal: AbortSignal.timeout(3_000),
        },
      );
      if (res.ok) {
        this.currentTitle = title;
        this.pendingTitle = "";
      }
    } catch {
      // tichý fallback
    }
  }
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 240);
}
