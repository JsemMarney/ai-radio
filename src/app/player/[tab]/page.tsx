import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStationConfig } from "@/lib/station-config";
import { LISTENER_TABS } from "@/lib/page-tabs";
import { PlayerClient } from "../PlayerClient";

type Props = { params: Promise<{ tab: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tab } = await params;
  const t = LISTENER_TABS.find((x) => x.slug === tab && x.slug);
  const station = getStationConfig();
  return { title: t ? `${t.label} — ${station.name}` : station.name };
}

export default async function PlayerTabPage({ params }: Props) {
  const { tab } = await params;
  const t = LISTENER_TABS.find((x) => x.slug === tab && x.slug);
  if (!t) notFound();
  return <PlayerClient station={getStationConfig()} initialTab={t.tab} />;
}
