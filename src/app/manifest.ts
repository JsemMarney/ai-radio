import type { MetadataRoute } from "next";
import { getStationConfig } from "@/lib/station-config";

/** PWA — rádio jde přidat na plochu telefonu a běží jako aplikace. */
export default function manifest(): MetadataRoute.Manifest {
  const station = getStationConfig();
  return {
    name: station.name,
    short_name: station.name,
    description: station.tagline,
    id: "/player",
    start_url: "/player",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: station.colorBg,
    theme_color: station.colorBg,
    lang: "cs",
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
