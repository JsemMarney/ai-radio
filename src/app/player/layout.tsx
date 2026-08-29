import type { Metadata } from "next";
import { getStationConfig } from "@/lib/station-config";

const station = getStationConfig();

export const metadata: Metadata = {
  title: `${station.name} — Live Player`,
  description: `Poslouchej živý stream ${station.name}.`,
};

export default function PlayerLayout({ children }: LayoutProps<"/player">) {
  return children;
}
