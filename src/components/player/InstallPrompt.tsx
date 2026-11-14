"use client";

import { useEffect, useState } from "react";

/** Chrome/Android: nativní „Nainstalovat aplikaci“ — událost si podržíme a spustíme na tlačítko. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = "miss-radio-install-dismissed";
/** Po „Teď ne“ se zeptáme znovu až za dva týdny. */
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;
/** Nevyskakovat hned — ať se posluchač nejdřív rozkouká. */
const SHOW_AFTER_MS = 6_000;

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="inline h-4 w-4 -translate-y-px" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

/** Nabídka „Přidat Miss Radio na plochu“ — na iPhonu návod, jinde nativní instalace. */
export function InstallPrompt({ name }: { name: string }) {
  const [mode, setMode] = useState<"ios" | "native" | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return;
    // iPadOS se hlásí jako Mac — pozná se podle dotyku.
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const timer = ios ? setTimeout(() => setMode("ios"), SHOW_AFTER_MS) : undefined;
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!installEvent) return;
    const timer = setTimeout(() => setMode("native"), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [installEvent]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // soukromé okno — zeptáme se příště znovu
    }
    setMode(null);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice.catch(() => ({ outcome: "dismissed" }));
    setInstallEvent(null);
    if (outcome === "accepted") setMode(null);
    else dismiss();
  }

  if (!mode) return null;

  return (
    <div
      role="dialog"
      aria-label={`Přidat ${name} na plochu`}
      className="animate-fade-up fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-sm sm:px-0 sm:pb-0"
    >
      <div className="rounded-xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] p-4 shadow-2xl shadow-black/60">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- malá statická ikona */}
          <img src="/icons/icon-192.png" alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-[14px]" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[var(--ink)]">Přidat {name} na plochu?</p>
            <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
              Rádio pak otevřeš jedním klepnutím jako aplikaci — s naším logem.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Zavřít"
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-[var(--ink-faint)] transition-colors hover:text-[var(--ink)]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {mode === "ios" ? (
          <ol className="mt-3 space-y-1.5 text-sm text-[var(--ink-muted)]">
            <li>
              <span className="font-semibold text-[var(--ink)]">1.</span> Klepni dole na <ShareIcon />{" "}
              <span className="text-[var(--ink)]">Sdílet</span> (v novém Safari je pod{" "}
              <span className="text-[var(--ink)]">⋯</span>).
            </li>
            <li>
              <span className="font-semibold text-[var(--ink)]">2.</span> Vyber{" "}
              <span className="text-[var(--ink)]">Přidat na plochu</span> a potvrď{" "}
              <span className="text-[var(--ink)]">Přidat</span>.
            </li>
            <li className="text-xs text-[var(--ink-faint)]">
              Máš na ploše starou ikonu jen s písmenem? Smaž ji a přidej rádio znovu.
            </li>
          </ol>
        ) : (
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md px-4 py-1.5 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
            >
              Teď ne
            </button>
            <button
              type="button"
              onClick={() => void install()}
              className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)]"
            >
              Přidat na plochu
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
