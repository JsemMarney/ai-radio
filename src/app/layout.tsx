import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import { RadioProvider } from "@/components/RadioProvider";
import { getStationConfig } from "@/lib/station-config";
import "./globals.css";

const sans = Barlow({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
});

const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
});

const station = getStationConfig();

export const metadata: Metadata = {
  title: `${station.name} — live radio`,
  description: station.tagline,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="cs"
      className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}
      style={
        {
          "--accent": station.colorAccent,
          "--accent-soft": station.colorAccentSoft,
          "--bg-deep": station.colorBg,
          "--bg-mid": station.colorBgMid,
          "--bg-panel": station.colorBgPanel,
        } as CSSProperties
      }
    >
      <body className="flex min-h-full flex-col">
        <RadioProvider>{children}</RadioProvider>
      </body>
    </html>
  );
}
