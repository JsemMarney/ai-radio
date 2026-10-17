/**
 * npm run release — sestaví web a zabalí ZIP pro Pterodactyl (Node.js egg).
 *
 *   release/miss-radio-v<verze>-<datum>.zip
 *
 * V ZIPu: index.js (startér), package.json (jen runtime závislosti),
 * .next (build webu), dist/broadcaster.cjs (engine rádia v jednom souboru),
 * public, šablony configu a návod. Žádné .env.local ani knihovna skladeb.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = path.join(ROOT, "release");
const STAGE = path.join(RELEASE, ".stage");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

function step(msg) {
  console.log(`\n▸ ${msg}`);
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) {
    console.error(`\n✗ Příkaz selhal: ${cmd} ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
}

// 1) Build webu
step("Build webu (next build)…");
run("npx", ["next", "build"]);

// 2) Čistá pracovní složka
step("Připravuji balík…");
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

// 3) Broadcaster jako jeden soubor (bez TypeScriptu a tsx na serveru)
await build({
  entryPoints: [path.join(ROOT, "scripts", "broadcaster.ts")],
  outfile: path.join(STAGE, "dist", "broadcaster.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  tsconfig: path.join(ROOT, "tsconfig.json"),
  logLevel: "warning",
});

// next.config.ts → .mjs (server pak nepotřebuje TypeScript)
await build({
  entryPoints: [path.join(ROOT, "next.config.ts")],
  outfile: path.join(STAGE, "next.config.mjs"),
  bundle: false,
  platform: "node",
  format: "esm",
  logLevel: "warning",
});

// 4) Build webu bez dev/cache
cpSync(path.join(ROOT, ".next"), path.join(STAGE, ".next"), {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(path.join(ROOT, ".next"), src).split(path.sep);
    return !["cache", "dev", "trace", "trace-build", "diagnostics", "types"].includes(rel[0]);
  },
});
cpSync(path.join(ROOT, "public"), path.join(STAGE, "public"), { recursive: true });
mkdirSync(path.join(STAGE, "config"), { recursive: true });
cpSync(path.join(ROOT, "config", "icecast.example.xml"), path.join(STAGE, "config", "icecast.example.xml"));

const deploy = path.join(ROOT, "deploy", "pterodactyl");
for (const name of ["index.js", "README.md"]) {
  cpSync(path.join(deploy, name), path.join(STAGE, name));
}
// Hotové nastavení serveru (deploy/pterodactyl/.env.local, v gitu ignorované)
// jde do ZIPu rovnou jako .env.local; jinak jen šablona k vyplnění.
const envFile = existsSync(path.join(deploy, ".env.local")) ? ".env.local" : ".env.example";
cpSync(path.join(deploy, envFile), path.join(STAGE, envFile));

// 5) package.json jen s tím, co server opravdu potřebuje
const runtimePkg = {
  name: "miss-radio",
  version: pkg.version,
  private: true,
  main: "index.js",
  engines: { node: ">=20" },
  scripts: { start: "node index.js" },
  dependencies: {
    next: pkg.dependencies.next,
    react: pkg.dependencies.react,
    "react-dom": pkg.dependencies["react-dom"],
    "ffmpeg-static": "^5.2.0",
    "ffprobe-static": "^3.1.0",
  },
};
writeFileSync(path.join(STAGE, "package.json"), `${JSON.stringify(runtimePkg, null, 2)}\n`);

// 6) ZIP — soubory přímo v kořeni (Pterodactyl je rozbalí do /home/container)
const d = new Date();
const two = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
const zipName = `miss-radio-v${pkg.version}-${stamp}.zip`;
const zipPath = path.join(RELEASE, zipName);
const entries = ["index.js", "package.json", "next.config.mjs", envFile, "README.md", ".next", "dist", "public", "config"];

step(`Balím ${zipName}…`);
const tarBin =
  process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : null;
let res;
if (tarBin && existsSync(tarBin)) {
  // Windows tar (bsdtar) umí ZIP přes -a podle přípony
  res = spawnSync(tarBin, ["-a", "-c", "-f", zipPath, "-C", STAGE, ...entries], { stdio: "inherit" });
} else {
  res = spawnSync("zip", ["-r", "-q", zipPath, ...entries], { cwd: STAGE, stdio: "inherit" });
}
if (res.status !== 0) {
  console.error("\n✗ Zabalení selhalo (potřeba tar.exe na Windows nebo zip na Linux/macOS).");
  process.exit(1);
}

rmSync(STAGE, { recursive: true, force: true });
const mb = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ Hotovo: release/${zipName} (${mb} MB)`);
console.log(
  envFile === ".env.local"
    ? "  Obsahuje .env.local (tajné údaje!) — nahraj na Pterodactyl, rozbal, MAIN_FILE = index.js."
    : "  Nahraj na Pterodactyl, rozbal, .env.example → .env.local, MAIN_FILE = index.js.",
);
