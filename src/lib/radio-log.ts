/**
 * Přehledný výpis do konzole (Pterodactyl / terminál): čas, ikona, barva podle typu.
 * NO_COLOR=1 vypne barvy.
 */

const useColor = !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const c = {
  dim: paint("2"),
  bold: paint("1"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  magenta: paint("35"),
  cyan: paint("36"),
  boldRed: paint("1;31"),
  boldYellow: paint("1;33"),
};

function clock(): string {
  return new Date().toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Jeden řádek: „14:03:12  ▶  text  · detail“. */
export function radioLog(icon: string, text: string, detail?: string): void {
  const line = `${c.dim(clock())}  ${icon}  ${text}${detail ? `  ${c.dim(detail)}` : ""}`;
  process.stdout.write(line + "\n");
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec || !Number.isFinite(sec)) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Varování a chyby z celého procesu dostanou čas a barvu (žlutá / červená),
 * ať se v konzoli neztratí mezi skladbami.
 */
export function installConsoleFormat(): void {
  const warn = console.warn.bind(console);
  const error = console.error.bind(console);
  const log = console.log.bind(console);
  console.warn = (...args: unknown[]) => warn(c.dim(clock()), c.yellow("⚠"), ...args);
  console.error = (...args: unknown[]) => error(c.dim(clock()), c.boldRed("✖"), ...args);
  console.log = (...args: unknown[]) => log(c.dim(clock()), " ", ...args);
  console.info = console.log;
}
