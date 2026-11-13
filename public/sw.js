// Miss Radio — service worker pro instalaci jako aplikace (PWA).
// Nic nekešuje kromě ikon a offline stránky: stream, API i stránky jdou vždy živě ze sítě.
const CACHE = "miss-radio-v3";
const SHELL = ["/icons/icon-192.png", "/icons/icon-512.png", "/brand/logo.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const OFFLINE = `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#120b0a;color:#f4ece2;font-family:system-ui,sans-serif;text-align:center"><div><img src="/icons/icon-192.png" width="96" height="96" alt=""><h1 style="font-size:1.4rem">Jsi offline</h1><p style="opacity:.7">Rádio začne hrát, až bude zase internet.</p><button onclick="location.reload()" style="margin-top:1rem;padding:.7rem 1.4rem;border:0;border-radius:999px;background:#e5322d;color:#fff;font-weight:600">Zkusit znovu</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Stránky: ze sítě, bez internetu offline obrazovka.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
    );
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
