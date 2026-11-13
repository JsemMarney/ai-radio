"use client";

import { useEffect } from "react";

/** Zaregistruje service worker (instalace na plochu). Ve vývoji ne — HMR by se pletl. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
