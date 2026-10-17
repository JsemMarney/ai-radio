/**
 * npm run library — zabalí knihovnu skladeb pro nahrání na server.
 *
 *   release/knihovna-<datum>.zip  →  na serveru Unarchive do kořene rádia
 *
 * Ze skladeb bere jen to, co rádio k vysílání potřebuje: info.json
 * a hotový broadcast soubor (už zmasterovaný). Stav rádia, statistiky
 * ani .env se nepřenáší. Na serveru se nové skladby objeví do ~30 s.
 *
 *   npm run library -- --since 2026-10-17   jen skladby přidané od data
 *   npm run library -- --max-mb 500          větší části (default 190 MB)
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOWNLOADS = path.join(ROOT, "downloads");
const RELEASE = path.join(ROOT, "release");
const STAGE = path.join(RELEASE, ".library-stage");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sinceArg = process.argv.indexOf("--since");
const since = sinceArg > 0 ? Date.parse(process.argv[sinceArg + 1] ?? "") : NaN;

if (!existsSync(DOWNLOADS)) {
  console.error("✗ Složka downloads/ neexistuje — nejdřív něco naimportuj ve studiu.");
  process.exit(1);
}

// Panel Pterodactyl mívá limit na velikost uploadu — dělit na části.
const maxArg = process.argv.indexOf("--max-mb");
const maxBytes = (maxArg > 0 ? Number(process.argv[maxArg + 1]) || 190 : 190) * 1024 * 1024;

const tracks = [];
let skipped = 0;
for (const name of readdirSync(DOWNLOADS).sort()) {
  if (!UUID_RE.test(name)) continue;
  const dir = path.join(DOWNLOADS, name);
  const infoPath = path.join(dir, "info.json");
  if (!existsSync(infoPath)) continue;

  let info;
  try {
    info = JSON.parse(readFileSync(infoPath, "utf8"));
  } catch {
    continue;
  }
  if (info.status !== "ready") {
    skipped++;
    continue;
  }
  if (Number.isFinite(since) && Date.parse(info.createdAt ?? "") < since) continue;

  // Hotový zmasterovaný soubor; starší skladby bez něj pošlou track.mp3
  const audio = ["track.broadcast.mp3", "track.mp3"].find((f) => existsSync(path.join(dir, f)));
  if (!audio) {
    skipped++;
    continue;
  }
  tracks.push({ name, dir, audio, size: statSync(path.join(dir, audio)).size });
}

if (!tracks.length) {
  console.error("✗ Žádné hotové skladby k zabalení.");
  process.exit(1);
}

const parts = [[]];
let partSize = 0;
for (const t of tracks) {
  if (partSize + t.size > maxBytes && parts.at(-1).length) {
    parts.push([]);
    partSize = 0;
  }
  parts.at(-1).push(t);
  partSize += t.size;
}

const d = new Date();
const two = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
const tarBin =
  process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe") : null;

console.log("");
for (const [i, part] of parts.entries()) {
  rmSync(STAGE, { recursive: true, force: true });
  for (const t of part) {
    const out = path.join(STAGE, "downloads", t.name);
    mkdirSync(out, { recursive: true });
    cpSync(path.join(t.dir, "info.json"), path.join(out, "info.json"));
    cpSync(path.join(t.dir, t.audio), path.join(out, t.audio));
  }
  const suffix = parts.length > 1 ? `-cast${i + 1}z${parts.length}` : "";
  const zipName = `knihovna-${stamp}${suffix}.zip`;
  const zipPath = path.join(RELEASE, zipName);
  const res =
    tarBin && existsSync(tarBin)
      ? spawnSync(tarBin, ["-a", "-c", "-f", zipPath, "-C", STAGE, "downloads"], { stdio: "inherit" })
      : spawnSync("zip", ["-r", "-q", zipPath, "downloads"], { cwd: STAGE, stdio: "inherit" });
  if (res.status !== 0) {
    rmSync(STAGE, { recursive: true, force: true });
    console.error("✗ Zabalení selhalo.");
    process.exit(1);
  }
  const mb = (statSync(zipPath).size / 1024 / 1024).toFixed(0);
  console.log(`✓ release/${zipName} — ${part.length} skladeb, ${mb} MB`);
}
rmSync(STAGE, { recursive: true, force: true });

console.log(`\nCelkem ${tracks.length} skladeb.`);
if (skipped) console.log(`${skipped} skladeb přeskočeno (nehotové nebo bez audia).`);
console.log("Na serveru: každou část nahraj do kořene rádia (vedle index.js) a dej Unarchive.");
console.log("Existující skladby se přepíšou, nic jiného se nesmaže. Větší části: --max-mb 500");
