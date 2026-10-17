import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 1024 * 1024;

export type WsHandlers = {
  onBinary?: (data: Buffer) => void;
  onText?: (text: string) => void;
  onClose?: () => void;
};

/**
 * Minimální WebSocket server (RFC 6455) — jen to, co potřebuje mikrofon ze studia:
 * binární a textové rámce od klienta, ping/pong, close. Bez fragmentace.
 */
export class WsConnection {
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;

  constructor(
    private readonly socket: Duplex,
    private readonly handlers: WsHandlers,
  ) {
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("close", () => this.finish());
    socket.on("error", () => this.finish());
  }

  static accept(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    handlers: WsHandlers,
  ): WsConnection | null {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || req.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return null;
    }
    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const conn = new WsConnection(socket, handlers);
    if (head.length) conn.onData(head);
    return conn;
  }

  sendText(text: string): void {
    if (this.closed) return;
    const payload = Buffer.from(text, "utf8");
    this.socket.write(Buffer.concat([this.header(0x1, payload.length), payload]));
  }

  close(code = 1000): void {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code);
    this.socket.write(Buffer.concat([this.header(0x8, 2), payload]));
    this.socket.end();
    this.finish();
  }

  private header(opcode: number, length: number): Buffer {
    if (length < 126) return Buffer.from([0x80 | opcode, length]);
    if (length < 65536) {
      const h = Buffer.alloc(4);
      h[0] = 0x80 | opcode;
      h[1] = 126;
      h.writeUInt16BE(length, 2);
      return h;
    }
    const h = Buffer.alloc(10);
    h[0] = 0x80 | opcode;
    h[1] = 127;
    h.writeBigUInt64BE(BigInt(length), 2);
    return h;
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;

    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0]!;
      const b1 = this.buffer[1]!;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let length = b1 & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME_BYTES)) return this.close(1009);
        length = Number(big);
        offset = 10;
      }
      if (length > MAX_FRAME_BYTES) return this.close(1009);
      // Klient musí rámce maskovat (RFC 6455 5.1).
      if (!masked) return this.close(1002);
      if (this.buffer.length < offset + 4 + length) return;

      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i & 3]!;
      this.buffer = this.buffer.subarray(offset + 4 + length);

      switch (opcode) {
        case 0x1:
          this.handlers.onText?.(payload.toString("utf8"));
          break;
        case 0x2:
          this.handlers.onBinary?.(payload);
          break;
        case 0x8:
          this.close();
          return;
        case 0x9:
          this.socket.write(Buffer.concat([this.header(0xa, payload.length), payload]));
          break;
        default:
          break; // pong / continuation ignorujeme
      }
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onClose?.();
  }
}
