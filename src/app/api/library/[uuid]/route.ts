import { NextResponse } from "next/server";
import { deleteLibraryTrack, getTrack } from "@/lib/library";
import { brokerFetch } from "@/lib/radio-broker";
import { readRadioState, writePlaylistState } from "@/lib/radio-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function detachFromRadio(uuid: string): Promise<void> {
  await brokerFetch("/queue/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uuid }),
  }).catch(() => {});

  const state = await readRadioState();
  const inBag = state.playlistBag.includes(uuid);
  const isNowPlaying = state.nowPlaying?.uuid === uuid;

  if (inBag || state.lastPlayedUuid === uuid) {
    await writePlaylistState(
      state.playlistBag.filter((id) => id !== uuid),
      state.lastPlayedUuid === uuid ? null : state.lastPlayedUuid,
    );
  }

  if (isNowPlaying) {
    await brokerFetch("/skip", { method: "POST" }).catch(() => {});
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ uuid: string }> },
) {
  try {
    const { uuid } = await context.params;
    const trimmed = uuid?.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Chybí uuid." }, { status: 400 });
    }

    const track = await getTrack(trimmed);
    if (!track) {
      return NextResponse.json({ error: "Skladba nenalezena." }, { status: 404 });
    }

    await detachFromRadio(trimmed);
    await deleteLibraryTrack(trimmed);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "";
    const locked =
      code === "EBUSY" ||
      code === "EPERM" ||
      (error instanceof Error && /EBUSY|EPERM|locked|používá/i.test(error.message));
    const message =
      error instanceof Error ? error.message : "Smazání selhalo.";

    return NextResponse.json(
      {
        error: locked
          ? "Soubor je zámčený (právě hraje ve streamu). Zkus Skip a smaž znovu."
          : message,
      },
      { status: locked ? 409 : 500 },
    );
  }
}
