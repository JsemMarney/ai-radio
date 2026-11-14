import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { CSSProperties } from "react";
import { Montserrat } from "next/font/google";
import { RadioProvider } from "@/components/RadioProvider";
import { PwaRegister } from "@/components/PwaRegister";
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
  applicationName: station.name,
  appleWebApp: {
    capable: true,
    title: station.name,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/brand/logo.svg", type: "image/svg+xml" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/icons/icon-32.png",
    // ?v= obejde ikonu, kterou si Safari zapamatoval dřív (jinak dá na plochu jen písmeno).
    apple: [{ url: "/apple-touch-icon.png?v=3", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: station.colorBg,
  colorScheme: "dark",
  // Obsah až pod výřez/notch (aplikace na ploše); okraje řeší safe-area paddingy.
  viewportFit: "cover",
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
        <PwaRegister />
        <RadioProvider>{children}</RadioProvider>
      </body>
    </html>
  );
}
