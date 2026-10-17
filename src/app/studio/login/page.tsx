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
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-10">
      <p className="label">Studio</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold leading-none text-[var(--ink)]">
        Přihlášení
      </h1>

      {searchParams.get("error") === "config" ? (
        <p className="mt-6 text-sm text-[var(--danger)]" role="alert">
          Studio je zamčené: heslo ve STUDIO_PASSWORD chybí nebo je slabé
          (min. 12 znaků). Nastav ho v .env.local a restartuj server.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="mt-10">
        <label htmlFor="password" className="text-xs text-[var(--ink-muted)]">
          Heslo
        </label>
        <input
          id="password"
          type="password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full border-b border-[var(--line-strong)] bg-transparent py-2 text-[var(--ink)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={loading}
          className="mt-8 w-full rounded-full bg-[var(--accent)] py-2.5 text-sm font-medium text-[var(--bg-deep)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
        >
          {loading ? "Přihlašuji…" : "Vstoupit"}
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
