import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { resolveAudioPath } from "@/lib/library";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".opus":
    case ".ogg":
      return "audio/ogg";
    case ".webm":
      return "audio/webm";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ uuid: string }> },
) {
  const { uuid: raw } = await context.params;
  const uuid = decodeURIComponent(raw);

  if (!UUID_RE.test(uuid)) {
    return new Response("Neplatné UUID.", { status: 400 });
  }

  const filepath = await resolveAudioPath(uuid);
  if (!filepath || !existsSync(filepath)) {
    return new Response("Soubor nenalezen.", { status: 404 });
  }

  const finalName = path.basename(filepath);
  const { size } = statSync(filepath);
  const stream = createReadStream(filepath);

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": contentTypeFor(finalName),
      "Content-Length": String(size),
      "Content-Disposition": `inline; filename="${finalName}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
