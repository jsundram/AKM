const V = "akm-v99";
const SHELL = ["./", "./index.html", "./app.js", "./roster-data.js", "./ping.js", "./nav.css", "./manifest.json",
               "./composer-bank.json", "./roster.html", "./notes.html", "./about.html",
               "./concerts.html", "./concert-data.js",
               "./network.html", "./network.js", "./d3.v7.min.js",
               "./map.html", "./map.js", "./map-data.json",
               "./map-relief.jpg", "./map-aerial.jpg", "./icon.svg",
               "./icon-180.png", "./icon-192.png", "./icon-512.png",
               // concert programs (PROGRAMS in app.js) — precached so they open offline at the venue
               "./programs/2026-07-04-afternoon.pdf", "./programs/2026-07-04-evening.pdf",
               "./programs/2026-07-08-evening.pdf",
               "./programs/2026-07-09-evening-draft.pdf", "./programs/2026-07-10-evening.pdf",
               "./programs/2026-07-11-morning.pdf", "./programs/2026-07-11-evening.pdf"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(V).then(c =>                 // cache fonts so the design survives offline
      c.match(e.request).then(r => r || fetch(e.request).then(resp => { c.put(e.request, resp.clone()); return resp; }))));
    return;
  }
  if (u.origin !== location.origin) return;   // let gviz + open-meteo go straight to network

  // App code/data + page navigations → network-first, so a push is visible on reload without
  // waiting for a service-worker swap; fall back to cache when offline. Big static assets
  // (images) stay cache-first for speed — a V bump refreshes those.
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
