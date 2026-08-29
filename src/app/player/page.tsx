import { getStationConfig } from "@/lib/station-config";
import { PlayerClient } from "./PlayerClient";

export default function PlayerPage() {
  return <PlayerClient station={getStationConfig()} />;
}
