"use client";

import { useCallback, useEffect, useState } from "react";
import { VoiceNoteControls } from "@/components/studio/VoiceNoteControls";
import type { ListenerMessage } from "@/lib/messages";

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "teď";
  if (min < 60) return `před ${min} min`;
  if (min < 1440) return `před ${Math.round(min / 60)} h`;
  return `před ${Math.round(min / 1440)} d`;
}

/** Vzkazy posluchačů do studia — nové nahoře, přečíst / smazat. */
export function MessagesPanel({ onUnread }: { onUnread?: (n: number) => void }) {
  const [messages, setMessages] = useState<ListenerMessage[]>([]);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/studio/messages", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: ListenerMessage[] };
      const list = data.messages ?? [];
      setMessages(list);
      onUnread?.(list.filter((m) => !m.read).length);
    } catch {
      // offline
    }
  }, [onUnread]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function act(action: "read" | "delete" | "readAll", id?: string) {
    // Hned v UI, server dorovná při dalším načtení.
    setMessages((list) =>
      action === "delete"
        ? list.filter((m) => m.id !== id)
        : list.map((m) => (action === "readAll" || m.id === id ? { ...m, read: true } : m)),
    );
    try {
      await fetch("/api/studio/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
    } finally {
      void load();
    }
  }

  const unread = messages.filter((m) => !m.read);
  const visible = showAll ? messages : unread.length ? unread : messages.slice(0, 3);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="label">Vzkazy</h2>
        {unread.length ? (
          <span className="flex items-center gap-3">
            <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs font-semibold text-[var(--ink)]">
              {unread.length} nové
            </span>
            <button
              type="button"
              onClick={() => void act("readAll")}
              className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              Vše přečteno
            </button>
          </span>
        ) : null}
      </div>

      {!messages.length ? (
        <p className="text-sm text-[var(--ink-muted)]">Zatím žádné vzkazy.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((m) => (
            <li
              key={m.id}
              className={`rounded-xl p-3 ${m.read ? "bg-[var(--bg-deep)]/30 text-[var(--ink-muted)]" : "bg-[var(--bg-deep)]/70"}`}
            >
              {m.text ? <p className="text-sm leading-snug">{m.text}</p> : null}
              {m.voiceSec !== undefined ? <VoiceNoteControls id={m.id} sec={m.voiceSec} /> : null}
              <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--ink-faint)]">
                <span className="min-w-0 flex-1 truncate">
                  {m.from ? `od ${m.from}` : "anonym"} · {ago(m.createdAt)}
                  {m.flagged ? <span className="text-[var(--danger)]"> · cenzurováno</span> : null}
                </span>
                {!m.read ? (
                  <button type="button" onClick={() => void act("read", m.id)} className="hover:text-[var(--ink)]">
                    Přečteno
                  </button>
                ) : null}
                <button type="button" onClick={() => void act("delete", m.id)} className="hover:text-[var(--danger)]">
                  Smazat
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {messages.length > visible.length || showAll ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
        >
          {showAll ? "Jen nové" : `Všechny vzkazy (${messages.length})`}
        </button>
      ) : null}
    </section>
  );
}
