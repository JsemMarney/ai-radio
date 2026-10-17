"use client";

import { useState } from "react";

async function postPlay(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/radio/requests/play-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? null : data.error ?? "Nepovedlo se.";
  } catch {
    return "Broadcaster neodpovídá.";
  }
}

/** Hlasovka posluchače: poslech do sluchátek a puštění do éteru. */
export function VoiceNoteControls({ id, sec }: { id: string; sec?: number }) {
  const [onAir, setOnAir] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function play() {
    setError(null);
    const err = await postPlay({ id });
    if (err) {
      setError(err);
      return;
    }
    setOnAir(true);
    // Indikace jen přibližně — hlasovka má max. 30 s.
    setTimeout(() => setOnAir(false), ((sec ?? 30) + 3) * 1000);
  }

  async function stop() {
    await postPlay({ stop: true });
    setOnAir(false);
  }

  return (
    <div className="mt-3">
      <p className="mb-1 text-xs text-[var(--ink-muted)]">
        Hlasovka{sec ? ` · ${sec} s` : ""} — poslechni si ji ve sluchátkách, než ji pustíš.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <audio
          src={`/api/radio/requests/voice?id=${id}`}
          controls
          preload="none"
          className="h-9 max-w-full"
        />
        {onAir ? (
          <button
            type="button"
            onClick={() => void stop()}
            className="rounded-full bg-[var(--ink)] px-4 py-1.5 text-sm text-[var(--bg-deep)]"
          >
            Zastavit
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void play()}
            className="rounded-full border border-[var(--accent)] px-4 py-1.5 text-sm transition-colors hover:bg-[var(--accent)]"
          >
            Pustit do éteru
          </button>
        )}
      </div>
      {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
