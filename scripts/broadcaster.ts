import { loadEnvFiles } from "../src/lib/load-env";

loadEnvFiles();

import("../src/broadcaster/server")
  .then(({ startBroadcaster }) => startBroadcaster())
  .catch((error: unknown) => {
    console.error("[broadcaster] Start selhal:", error);
    process.exit(1);
  });
