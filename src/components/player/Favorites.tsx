"use client";

import { useEffect, useRef, useState } from "react";
import type { RadioNowPlaying } from "@/lib/types";

/**
 * Oblíbené písničky posluchače (jen v jeho prohlížeči). Když oblíbená začne hrát,
 * stránka ukáže upozornění — a když to posluchač dovolí, i systémovou notifikaci
 * (funguje i se stránkou na pozadí, dokud je otevřená).
 */

const KEY = "ai-radio-favorites";
type Fav = { uuid: string; title: string; artist: string };

function readFavs(): Fav[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Fav[];
    return Array.isArray(raw) ? raw.slice(0, 200) : [];
  } catch {
    return [];
  }
}

function writeFavs(list: Fav[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
  } catch {
    // storage nedostupný
  }
  window.dispatchEvent(new Event("ai-radio-favorites"));
}

function useFavs(): Fav[] {
  const [favs, setFavs] = useState<Fav[]>([]);
  useEffect(() => {
    const sync = () => setFavs(readFavs());
    const t = setTimeout(sync, 0);
    window.addEventListener("ai-radio-favorites", sync);
    window.addEventListener("storage", sync);
    return () => {
      clearTimeout(t);
      window.removeEventListener("ai-radio-favorites", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return favs;
}

/** Srdíčko u právě hrající písničky. */
export function FavoriteButton({ track }: { track: RadioNowPlaying | null }) {
  const favs = useFavs();
  if (!track) return null;
  const on = favs.some((f) => f.uuid === track.uuid);
  const toggle = () => {
    const list = readFavs();
    if (on) {
      writeFavs(list.filter((f) => f.uuid !== track.uuid));
      return;
    }
    writeFavs([{ uuid: track.uuid, title: track.title, artist: track.artist }, ...list]);
    // Povolení notifikací až po kliknutí (prohlížeče to jinak blokují).
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Odebrat z oblíbených" : "Přidat do oblíbených — upozorníme tě, až bude hrát"}
      title={on ? "V oblíbených — upozorníme tě, až zase pojede" : "Do oblíbených — upozorníme tě, až bude hrát"}
      className={`flex h-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors ${
        on
          ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--ink)]"
          : "border-[var(--line-strong)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
      }`}
    >
      <span aria-hidden>{on ? "♥" : "♡"}</span>
      {on ? "Oblíbená" : "Oblíbit"}
    </button>
  );
}

/** Upozornění, když začne hrát oblíbená písnička. */
export function FavoriteAlert({ track, stationName }: { track: RadioNowPlaying | null; stationName: string }) {
  const favs = useFavs();
  const [toast, setToast] = useState<Fav | null>(null);
  const lastUuid = useRef<string | null>(null);

  useEffect(() => {
    if (!track || track.uuid === lastUuid.current) return;
    const first = lastUuid.current === null;
    lastUuid.current = track.uuid;
    // Při otevření stránky neupozorňovat na to, co už hraje.
    if (first) return;
    const fav = favs.find((f) => f.uuid === track.uuid);
    if (!fav) return;
    const show = setTimeout(() => setToast(fav), 0);
    const hide = setTimeout(() => setToast(null), 12_000);
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(`♥ Hraje tvoje oblíbená — ${stationName}`, {
          body: `${track.title} — ${track.artist}`,
          icon: track.thumbnail ?? undefined,
          tag: "ai-radio-favorite",
        });
      } catch {
        // notifikace nejdou (např. iOS bez instalace na plochu)
      }
    }
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [track, favs, stationName]);

  if (!toast) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl border border-[var(--accent)] bg-[var(--bg-panel)] p-4 text-sm shadow-xl"
    >
      <p className="font-semibold text-[var(--ink)]">♥ Hraje tvoje oblíbená!</p>
      <p className="mt-1 text-[var(--ink-muted)]">
        {toast.title} — {toast.artist}
      </p>
      <button
        type="button"
        onClick={() => setToast(null)}
        className="mt-2 text-xs text-[var(--ink-faint)] hover:text-[var(--ink)]"
      >
        Zavřít
      </button>
    </div>
  );
}
