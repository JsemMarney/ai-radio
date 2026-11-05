import type { Metadata } from "next";
import { connection } from "next/server";
import type { CSSProperties } from "react";
import { Montserrat } from "next/font/google";
import { RadioProvider } from "@/components/RadioProvider";
import { getStationConfig } from "@/lib/station-config";
import "./globals.css";

// Montserrat všude — text, nadpisy i čísla (globals.css z něj skládá --font-sans/display/mono).
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin", "latin-ext"],
});

const station = getStationConfig();

export const metadata: Metadata = {
  title: `${station.name} — live radio`,
  description: station.tagline,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Dynamické renderování — jinak by Next nemohl doplnit CSP nonce ke skriptům.
  await connection();
  return (
    <html
      lang="cs"
      className={`${montserrat.variable} h-full antialiased`}
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
