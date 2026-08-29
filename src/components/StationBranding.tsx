"use client";

import { useEffect, useState } from "react";
import type { StationConfig } from "@/lib/types";
import { OnAirLamp, StationHeader } from "@/components/player/BroadcastUi";

export function StationBranding({
  showTagline = true,
  size = "md",
  config: configProp,
}: {
  showTagline?: boolean;
  size?: "sm" | "md" | "lg";
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

  if (!showTagline) {
    return <StationHeader config={{ ...config, tagline: "" }} size={size} />;
  }

  return <StationHeader config={config} size={size} />;
}

export function OnAirBadge({ live }: { live: boolean }) {
  return <OnAirLamp live={live} />;
}
