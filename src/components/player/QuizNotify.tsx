"use client";

import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

/** „Upozornit, když začne kvíz“ — Web Push (na iPhonu jen v aplikaci přidané na plochu). */
export function QuizNotify() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const standalone =
          window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true;
        if (!("Notification" in window) || !("PushManager" in window)) {
          setState(ios && !standalone ? "ios-install" : "unsupported");
          return;
        }
        if (Notification.permission === "denied") {
          setState("denied");
          return;
        }
        const reg = await registration();
        if (!reg) {
          setState("unsupported");
          return;
        }
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? "on" : "off");
      })().catch(() => setState("unsupported"));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const reg = await registration();
      if (!reg) throw new Error("Upozornění tu nejdou zapnout.");
      if (state === "on") {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/radio/push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint, off: true }),
          }).catch(() => {});
          await sub.unsubscribe();
        }
        setState("off");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const keyRes = await fetch("/api/radio/push", { cache: "no-store" });
      const { publicKey } = (await keyRes.json()) as { publicKey?: string };
      if (!publicKey) throw new Error("Rádio je teď offline, zkus to za chvíli.");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      const res = await fetch("/api/radio/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) {
        await sub.unsubscribe().catch(() => {});
        throw new Error(data.error ?? "Upozornění se nepodařilo zapnout.");
      }
      setState("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upozornění se nepodařilo zapnout.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "unsupported") return null;

  return (
    <div className="rounded-md border border-[var(--line-strong)] bg-[var(--bg-deep)] p-3 text-sm">
      {state === "ios-install" ? (
        <p className="text-[var(--ink-muted)]">
          🔔 Chceš upozornění, když začne kvíz? Na iPhonu nejdřív přidej rádio na plochu (Sdílet → Přidat na
          plochu) a otevři ho odtamtud.
        </p>
      ) : state === "denied" ? (
        <p className="text-[var(--ink-muted)]">
          🔔 Upozornění máš v prohlížeči zakázaná. Povol je v nastavení webu, pak je tu můžeš zapnout.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[var(--ink-muted)]">
            {state === "on"
              ? "🔔 Dáme ti vědět, když začne kvíz."
              : "🔔 Upozornit tě, když začne kvíz? I když zrovna neposloucháš."}
          </p>
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={busy}
            className={`shrink-0 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
              state === "on"
                ? "border border-[var(--line-strong)] text-[var(--ink)] hover:border-[var(--accent)]"
                : "bg-[var(--accent)] text-[var(--ink)] hover:bg-[var(--accent-soft)]"
            }`}
          >
            {busy ? "Chvilku…" : state === "on" ? "Vypnout" : "Zapnout"}
          </button>
        </div>
      )}
      {error ? (
        <p className="mt-2 text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
