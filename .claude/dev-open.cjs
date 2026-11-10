// Lokální vývoj: studio bez hesla (Next nepřepíše už definovanou proměnnou z .env.local).
process.env.STUDIO_PASSWORD = "";
process.env.RADIO_NO_ALERTS = "1";
const { spawn } = require("node:child_process");
const p = spawn("npm", ["run", process.argv[2] || "dev"], { stdio: "inherit", shell: true, env: process.env });
p.on("exit", (c) => process.exit(c ?? 0));
