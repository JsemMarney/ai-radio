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
    name: process.env.STATION_NAME ?? "Miss Radio",
    tagline: process.env.STATION_TAGLINE ?? "24/7 music",
    logoUrl: process.env.STATION_LOGO_URL ?? "/brand/logo.svg",
    colorAccent: process.env.STATION_COLOR_ACCENT ?? "#d4a24c",
    colorAccentSoft: process.env.STATION_COLOR_ACCENT_SOFT ?? "#e8c57a",
    colorBg: process.env.STATION_COLOR_BG ?? "#0a0e0c",
    colorBgMid: process.env.STATION_COLOR_BG_MID ?? "#111916",
    colorBgPanel: process.env.STATION_COLOR_BG_PANEL ?? "#171f1b",
  };
}
