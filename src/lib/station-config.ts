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
    colorAccent: process.env.STATION_COLOR_ACCENT ?? "#e5322d",
    colorAccentSoft: process.env.STATION_COLOR_ACCENT_SOFT ?? "#ff6b55",
    colorBg: process.env.STATION_COLOR_BG ?? "#120b0a",
    colorBgMid: process.env.STATION_COLOR_BG_MID ?? "#1b1110",
    colorBgPanel: process.env.STATION_COLOR_BG_PANEL ?? "#241614",
  };
}
