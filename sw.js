// Service worker aplikace Standardy a audity.
// Strategie „nejdřív síť“: vždy se načte nejnovější verze, uložená kopie slouží jen při výpadku připojení.
// Požadavky na databázi (Supabase), ARES a jiné weby se neukládají.
const CACHE = "ia-audity-v47";
const CORE = ["./", "./index.html", "./styles.css", "./manifest.webmanifest", "./assets/interaction-logo.png", "./assets/icons/icon-192.png", "./assets/icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then(r => r || caches.match("./index.html")))
  );
});
