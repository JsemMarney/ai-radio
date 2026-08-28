"use client";

import { useEffect, useState } from "react";
import type { StationConfig } from "@/lib/types";

export function StationBranding({
  showTagline = true,
  size = "md",
}: {
  showTagline?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const [config, setConfig] = useState<StationConfig | null>(null);

  useEffect(() => {
    void fetch("/api/station/config")
      .then((r) => r.json())
      .then((data: StationConfig) => setConfig(data))
      .catch(() => {});
  }, []);

  const name = config?.name ?? "AI Radio";
  const tagline = config?.tagline ?? "24/7 auto DJ";
  const logoUrl = config?.logoUrl ?? "/brand/logo.svg";

  const logoSize =
    size === "lg" ? "h-16 w-16" : size === "sm" ? "h-8 w-8" : "h-12 w-12";
  const titleSize =
    size === "lg"
      ? "text-3xl"
      : size === "sm"
        ? "text-lg"
        : "text-2xl";

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt="" className={`${logoSize} rounded-full`} />
      <div>
        <h1
          className={`font-[family-name:var(--font-display)] ${titleSize} text-[var(--ink)]`}
        >
          {name}
        </h1>
        {showTagline && (
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{tagline}</p>
        )}
      </div>
    </div>
  );
}

export function OnAirBadge({ live }: { live: boolean }) {
  if (!live) return null;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-1 text-xs font-semibold tracking-wider text-[var(--danger)] uppercase">
      <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--danger)]" />
      On Air
    </span>
  );
}
