import Link from "next/link";
import type { ReactNode } from "react";
import { getStationConfig } from "@/lib/station-config";

/** Shared layout for the English legal pages (Privacy Policy, Terms of Use). */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  const station = getStationConfig();
  return (
    <div lang="en" className="ambient flex min-h-screen flex-col pt-[env(safe-area-inset-top)]">
      <header className="border-b border-[var(--line)] bg-[var(--bg-deep)]/60 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/player" className="flex items-center gap-2 font-bold tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={station.logoUrl} alt="" className="h-7 w-7" />
            {station.name}
          </Link>
          <Link
            href="/player"
            className="text-sm text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            ← Back to the radio
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">Last updated: {updated}</p>
        <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-[var(--ink)]/90 [&_a]:text-[var(--accent-soft)] [&_a]:underline [&_a]:underline-offset-2 [&_h2]:!mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-[var(--ink)] [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <footer className="border-t border-[var(--line)] pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-x-5 gap-y-2 px-4 py-5 text-xs text-[var(--ink-muted)] sm:px-6">
          <span>{station.name}</span>
          <Link href="/privacy" className="hover:text-[var(--ink)]">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-[var(--ink)]">
            Terms of Use
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** How to reach the operator: STATION_CONTACT_EMAIL, otherwise the Suggest form. */
export function ContactLine() {
  const email = process.env.STATION_CONTACT_EMAIL?.trim();
  return email ? (
    <a href={`mailto:${email}`}>{email}</a>
  ) : (
    <>
      the <Link href="/player/suggest">Suggest form</Link> on the player page (mention “privacy” in your
      note)
    </>
  );
}
