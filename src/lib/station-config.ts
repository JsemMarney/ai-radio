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

export function getStationConfig(): StationConfig {
  return {
    name: process.env.STATION_NAME ?? "AI Radio",
    tagline: process.env.STATION_TAGLINE ?? "24/7 auto DJ",
    logoUrl: process.env.STATION_LOGO_URL ?? "/brand/logo.svg",
    colorAccent: process.env.STATION_COLOR_ACCENT ?? "#d4a24c",
    colorAccentSoft: process.env.STATION_COLOR_ACCENT_SOFT ?? "#e8c57a",
    colorBg: process.env.STATION_COLOR_BG ?? "#0f1a14",
    colorBgMid: process.env.STATION_COLOR_BG_MID ?? "#16241c",
    colorBgPanel: process.env.STATION_COLOR_BG_PANEL ?? "#1c2e24",
  };
}
