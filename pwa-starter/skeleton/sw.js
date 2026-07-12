// Service worker: offline shell + cache-busting.
//
// THE ONE RULE: bump V whenever you change a precached SHELL file. A new V is what evicts the
// stale cache on activate — forget the bump and your fix ships to the repo but never to anyone's
// installed home-screen copy (iOS caches the SW aggressively). scripts/sw-lint.py nags about this.
//
// Strategy: shell files are network-first (a push is visible on the next reload without waiting
// for a SW swap; falls back to cache offline); big static assets stay cache-first for speed
// (a V bump is what refreshes them). Cross-origin *data* (your APIs) passes straight through.

const V = "app-v1";   // <-- BUMP ON EVERY SHELL CHANGE
const SHELL = [
  "./", "./index.html", "./manifest.json",
  "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png",
  // ...list every file the app needs to run offline: css, js, json, fonts-if-self-hosted
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))   // evict old versions
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);

  // Google Fonts (if used): cache-first so the type survives offline.
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(V).then(c =>
      c.match(e.request).then(r => r || fetch(e.request).then(resp => { c.put(e.request, resp.clone()); return resp; }))));
    return;
  }

  // Cross-origin data (your APIs, third-party JSON): straight to network, don't touch the cache.
  if (u.origin !== location.origin) return;

  // Same-origin: HTML/JS/JSON + navigations → network-first; other assets (images) → cache-first.
  const live = e.request.mode === "navigate" || u.pathname.endsWith("/") || /\.(html|js|json)$/.test(u.pathname);
  if (live) {
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(V).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(V).then(c => c.put(e.request, copy));
        return resp;
      }))
    );
  }
});
