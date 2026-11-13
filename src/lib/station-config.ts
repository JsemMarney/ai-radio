export type StationConfig = {
  name: string;
  tagline: string;
  logoUrl: string;
  colorAccent: string;
  colorAccentSoft: string;
  colorBg: string;
  colorBgMid: string;
  colorBgPanel: string;
};

/** Paleta značky: rádiová červená, jantarový doplněk a teplá skoro-černá. */
export const BRAND = {
  accent: "#e5202e",
  accentSoft: "#ff7a7f",
  accent2: "#ffb547",
  bg: "#0d0b0b",
  bgMid: "#161212",
  bgPanel: "#201919",
  /** Slogan stanice (podtitul v hlavičce, tickeru, PWA i v Icecastu). */
  tagline: "Hraje, co si přeješ",
} as const;

export function getStationConfig(): StationConfig {
  return {
    name: process.env.STATION_NAME ?? "Miss Radio",
    // Slogan je součást značky — staré STATION_TAGLINE v .env.local se ignoruje.
    tagline: BRAND.tagline,
    logoUrl: process.env.STATION_LOGO_URL ?? "/brand/logo.svg",
    // Barvy značky Miss Radio (červená + jantarová) jsou pevně dané — staré
    // STATION_COLOR_* v .env.local se už nepoužívají.
    colorAccent: BRAND.accent,
    colorAccentSoft: BRAND.accentSoft,
    colorBg: BRAND.bg,
    colorBgMid: BRAND.bgMid,
    colorBgPanel: BRAND.bgPanel,
  };
}
