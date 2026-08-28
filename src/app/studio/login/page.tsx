"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function StudioLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/studio/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Přihlášení selhalo.");

      const next = searchParams.get("next") || "/studio";
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba přihlášení.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
        Studio přihlášení
      </h1>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        Import a správa knihovny jsou chráněné heslem.
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 p-5"
      >
        <label
          htmlFor="password"
          className="mb-2 block text-sm text-[var(--ink-muted)]"
        >
          Heslo
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--bg-deep)]/70 px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={loading}
          className="mt-4 w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-50"
        >
          {loading ? "Přihlašuju…" : "Přihlásit"}
        </button>
      </form>

      {error && (
        <p className="mt-4 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
