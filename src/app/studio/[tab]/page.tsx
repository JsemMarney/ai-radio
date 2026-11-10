import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStationConfig } from "@/lib/station-config";
import { STUDIO_TABS } from "@/lib/page-tabs";
import { StudioClient } from "../StudioClient";

type Props = { params: Promise<{ tab: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tab } = await params;
  const t = STUDIO_TABS.find((x) => x.slug === tab && x.slug);
  return { title: t ? `Studio — ${t.label}` : "Studio" };
}

export default async function StudioTabPage({ params }: Props) {
  const { tab } = await params;
  const t = STUDIO_TABS.find((x) => x.slug === tab && x.slug);
  if (!t) notFound();
  return <StudioClient station={getStationConfig()} initialTab={t.tab} />;
}
