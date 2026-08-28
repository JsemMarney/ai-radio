import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { DM_Sans, Fraunces } from "next/font/google";
import { RadioProvider } from "@/components/RadioProvider";
import { getStationConfig } from "@/lib/station-config";
import "./globals.css";

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
});

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
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
      className={`${sans.variable} ${display.variable} h-full antialiased`}
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
