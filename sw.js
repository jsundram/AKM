const V = "akm-v6";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.json",
               "./composer-bank.json", "./roster.html",
               "./map.html", "./map.js", "./map-data.json", "./icon.svg",
               "./icon-180.png", "./icon-192.png", "./icon-512.png"];

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
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(V).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match("./index.html")))
  );
});
