"use client";

import { useEffect, useMemo, useState } from "react";
import type { RadioNowPlaying } from "@/lib/types";
import { LogRow } from "@/components/player/BroadcastUi";

type LibraryTrack = RadioNowPlaying & { requestable: boolean };
type Sort = "artist" | "title" | "year";

const PAGE = 60;

function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function duration(sec: number | null | undefined): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

/** Všechny písničky, které rádio hraje — hledání a přání rovnou z knihovny. */
export function LibraryPanel({ onRequest }: { onRequest?: (track: RadioNowPlaying) => void }) {
  const [tracks, setTracks] = useState<LibraryTrack[] | null>(null);
  const [requests, setRequests] = useState(false);
  const [offline, setOffline] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("artist");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let stop = false;
    void (async () => {
      try {
        const res = await fetch("/api/radio/library");
        const data = (await res.json()) as {
          tracks?: LibraryTrack[];
          requests?: boolean;
          offline?: boolean;
        };
        if (stop) return;
        setOffline(Boolean(data.offline) || !res.ok);
        setTracks(data.tracks ?? []);
        setRequests(Boolean(data.requests));
      } catch {
        if (!stop) {
          setOffline(true);
          setTracks([]);
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  const artists = useMemo(
    () => new Set((tracks ?? []).map((t) => norm(t.artist.split(/,|&| feat/i)[0]!.trim()))).size,
    [tracks],
  );

  const list = useMemo(() => {
    const q = norm(query.trim());
    const out = (tracks ?? []).filter(
      (t) => !q || norm(`${t.artist} ${t.title} ${t.album ?? ""} ${t.year ?? ""}`).includes(q),
    );
    if (sort === "title") out.sort((a, b) => a.title.localeCompare(b.title, "cs", { sensitivity: "base" }));
    if (sort === "year") out.sort((a, b) => (b.year ?? "").localeCompare(a.year ?? ""));
    return out;
  }, [tracks, query, sort]);

  return (
    <section className="flex min-h-0 flex-col lg:h-full">
      <p id="library-hint" className="mb-3 text-sm text-[var(--ink-muted)]">
        {tracks === null
          ? "Načítám knihovnu…"
          : offline
            ? "Knihovnu teď nejde načíst — stanice neodpovídá."
            : `${tracks.length} písniček od ${artists} interpretů — všechno, co u nás může hrát.`}
      </p>
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
          placeholder="Hledej interpreta, skladbu nebo rok…"
          aria-describedby="library-hint"
          className="min-w-0 flex-1 rounded-full border border-[var(--line-strong)] bg-[var(--bg-deep)] px-4 py-2.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Řazení"
          className="shrink-0 rounded-full border border-[var(--line-strong)] bg-[var(--bg-deep)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
        >
          <option value="artist">Interpret</option>
          <option value="title">Název</option>
          <option value="year">Nejnovější</option>
        </select>
      </div>
      {query.trim() && tracks?.length ? (
        <p className="mt-2 text-xs text-[var(--ink-faint)]">Nalezeno {list.length}</p>
      ) : null}
      <ul className="mt-3 h-80 overflow-y-auto pr-3 lg:h-auto lg:min-h-48 lg:flex-1">
        {list.length ? (
          <>
            {list.slice(0, shown).map((track) => (
              <LogRow
                key={track.uuid}
                track={track}
                aside={
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden font-[family-name:var(--font-mono)] text-xs tabular-nums text-[var(--ink-faint)] sm:inline">
                      {[track.year, duration(track.durationSec)].filter(Boolean).join(" · ")}
                    </span>
                    {requests && onRequest ? (
                      track.requestable ? (
                        <button
                          type="button"
                          onClick={() => onRequest(track)}
                          className="rounded-full border border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        >
                          Přát si
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--ink-faint)]" title="Hrála nedávno nebo už je ve frontě">
                          Hrála nedávno
                        </span>
                      )
                    ) : null}
                  </div>
                }
              />
            ))}
            {list.length > shown ? (
              <li className="py-3 text-center">
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="rounded-full border border-[var(--line-strong)] px-4 py-1.5 text-xs text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
                >
                  Další ({list.length - shown})
                </button>
              </li>
            ) : null}
          </>
        ) : (
          <li className="py-6 text-center text-sm text-[var(--ink-muted)]">
            {tracks === null ? "Načítám…" : "Nic jsme nenašli."}
          </li>
        )}
      </ul>
    </section>
  );
}
