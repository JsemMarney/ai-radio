"use client";

import { useEffect, useState } from "react";
import type { StationConfig } from "@/lib/types";
import { LiveBadge, StationHeader } from "@/components/player/BroadcastUi";

export function StationBranding({
  showTagline = true,
  compact = false,
  config: configProp,
}: {
  showTagline?: boolean;
  compact?: boolean;
  config?: StationConfig;
}) {
  const [fetched, setFetched] = useState<StationConfig | null>(null);

  useEffect(() => {
    if (configProp) return;
    void fetch("/api/station/config")
      .then((r) => r.json())
      .then((data: StationConfig) => setFetched(data))
      .catch(() => {});
  }, [configProp]);

  const config =
    configProp ??
    fetched ?? {
      name: "Miss Radio",
      tagline: showTagline ? "24/7 music" : "",
      logoUrl: "/brand/logo.svg",
      colorAccent: "#d4a24c",
      colorAccentSoft: "#e8c57a",
      colorBg: "#0a0e0c",
      colorBgMid: "#111916",
      colorBgPanel: "#171f1b",
    };

  return (
    <StationHeader
      config={showTagline ? config : { ...config, tagline: "" }}
      compact={compact}
    />
  );
}

export function OnAirBadge({
  live,
  listeners = 0,
}: {
  live: boolean;
  listeners?: number;
}) {
  return <LiveBadge live={live} listeners={listeners} />;
}
