import type { Metadata } from "next";
import { getStationConfig } from "@/lib/station-config";
import { StudioClient } from "./StudioClient";

export const metadata: Metadata = {
  title: "Studio",
};

export default function StudioPage() {
  return <StudioClient station={getStationConfig()} />;
}
