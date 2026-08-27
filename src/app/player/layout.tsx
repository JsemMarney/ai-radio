import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Radio — Live Player",
  description: "Poslouchej živý stream z AI Radio knihovny.",
};

export default function PlayerLayout({ children }: LayoutProps<"/player">) {
  return children;
}
