/** Adresy záložek studia a přehrávače (/studio/library, /player/message …). */

export type StudioTab = "live" | "hosts" | "library" | "stats" | "import" | "system";

export const STUDIO_TABS: { tab: StudioTab; slug: string; label: string }[] = [
  { tab: "live", slug: "", label: "Vysílání" },
  { tab: "hosts", slug: "hosts", label: "Moderátoři" },
  { tab: "library", slug: "library", label: "Knihovna" },
  { tab: "stats", slug: "stats", label: "Statistiky" },
  { tab: "import", slug: "import", label: "Import" },
  { tab: "system", slug: "system", label: "Systém" },
];

export function studioPath(tab: StudioTab): string {
  const slug = STUDIO_TABS.find((t) => t.tab === tab)?.slug ?? "";
  return slug ? `/studio/${slug}` : "/studio";
}

export function studioTabFromPath(pathname: string): StudioTab {
  const slug = pathname.replace(/^\/studio\/?/, "").split("/")[0] ?? "";
  return STUDIO_TABS.find((t) => t.slug === slug)?.tab ?? "live";
}

export type ListenerTab = "request" | "suggest" | "quiz";

export const LISTENER_TABS: { tab: ListenerTab; slug: string; label: string; short: string }[] = [
  { tab: "request", slug: "", label: "Přát si písničku", short: "Přát si" },
  { tab: "suggest", slug: "suggest", label: "Navrhnout novou", short: "Navrhnout" },
  { tab: "quiz", slug: "kviz", label: "Kvíz a otázka dne", short: "Kvíz" },
];

/** Staré adresy záložek, které už nejsou — přesměrují se na přehrávač. */
export const RETIRED_PLAYER_SLUGS = ["library", "message"];

export function playerPath(tab: ListenerTab): string {
  const slug = LISTENER_TABS.find((t) => t.tab === tab)?.slug ?? "";
  return slug ? `/player/${slug}` : "/player";
}

export function listenerTabFromPath(pathname: string): ListenerTab {
  const slug = pathname.replace(/^\/player\/?/, "").split("/")[0] ?? "";
  return LISTENER_TABS.find((t) => t.slug === slug)?.tab ?? "request";
}
