// Liesing/Klebas map: draws the baked OSM vector basemap (map-data.json, metres) as a custom
// SVG, with the festival POIs pinned on an HTML overlay. No tiles, no libs — fully offline.
// Pan/zoom move a transform on #scene; markers are repositioned in screen space each frame so
// pins stay a constant size and labels never scale into mush.
const $ = s => document.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const el = (t, c) => { const e = document.createElementNS(NS, t); if (c) e.setAttribute("class", c); return e; };
const pts = p => { let s = ""; for (let i = 0; i < p.length; i += 2) s += p[i] + "," + p[i + 1] + " "; return s; };
const XL = "http://www.w3.org/1999/xlink";
const MINZ = 1, MAXZ = 20;                          // zoom clamp ×fitS: out-floor is fit-to-extent (edges touch), in only from there
const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function roadLabel(o, i) {                          // curved name following the road, flipped to read L→R
  const p = o.p, rev = p[0] > p[p.length - 2], a = [];
  for (let j = 0; j < p.length; j += 2) a.push(p[j] + "," + p[j + 1]);
  if (rev) a.reverse();
  const id = "rd" + i, path = el("path", "rdpath");
  path.setAttribute("id", id); path.setAttribute("d", "M" + a.join("L")); scene.appendChild(path);
  const t = el("text", "glab road"), tp = el("textPath");
  tp.setAttribute("href", "#" + id); tp.setAttributeNS(XL, "href", "#" + id);
  const off = o.no == null ? 0.5 : rev ? 1 - o.no : o.no;   // sit on the in-view stretch, flipped if reversed
  tp.setAttribute("startOffset", (off * 100).toFixed(1) + "%"); tp.textContent = o.name.toUpperCase();
  t.appendChild(tp); scene.appendChild(t);
}

const map = $("#map"), scene = $("#scene"), markers = $("#markers"), meEl = $("#me"), accEl = $("#me .acc");
let W, H, view = { s: 1, tx: 0, ty: 0 }, fitS = 1, pins = [], raf = 0, me = null, watching = false;

const sx = x => view.tx + view.s * x;            // scene metres → screen px
const sy = y => view.ty + view.s * y;

function drawScene(d) {
  scene.replaceChildren();
  $("#cliprect").setAttribute("width", d.meta.w);   // clip everything to the bbox for a clean edge
  $("#cliprect").setAttribute("height", d.meta.h);
  ["map-relief.jpg map-relief rl", "map-aerial.jpg map-aerial ae"].forEach(spec => {
    const [src, , cls] = spec.split(" "), e = el("image", cls);   // raster basemaps, behind the vector
    e.setAttribute("href", "./" + src);
    e.setAttributeNS("http://www.w3.org/1999/xlink", "href", "./" + src);   // older Safari
    e.setAttribute("x", 0); e.setAttribute("y", 0);
    e.setAttribute("width", d.meta.w); e.setAttribute("height", d.meta.h);
    e.setAttribute("preserveAspectRatio", "none");
    scene.appendChild(e);
  });
  const add = (cls, items, tag, attr) => items.forEach(o => {
    const e = el(tag, cls + (o.k ? " " + o.k : ""));
    e.setAttribute(attr, pts(o.p));
    scene.appendChild(e);
  });
  add("green", d.land, "polygon", "points");
  d.water.forEach(w => {
    const closed = w.k === "body";
    const e = el(closed ? "polygon" : "polyline", closed ? "body" : w.k);
    e.setAttribute("points", pts(w.p));
    scene.appendChild(e);
  });
  d.roads.forEach(o => {
    const e = el("polyline", "road " + o.k); e.setAttribute("points", pts(o.p)); scene.appendChild(e);
  });
  d.buildings.forEach(o => {
    const e = el("polygon", "bldg" + (o.a || o.n ? " has" : ""));
    e.setAttribute("points", pts(o.p));
    if (o.a || o.n) e.__info = o;                  // address/name shown on tap
    scene.appendChild(e);
  });
  d.pois.forEach(p => {                            // highlighted footprints under the pins
    if (!p.fp) return;
    const e = el("polygon", "fp fp-" + (p.mine ? "mine" : p.cat));
    e.setAttribute("points", pts(p.fp));
    scene.appendChild(e);
  });
  d.labels.forEach(l => {
    const t = el("text", "glab " + (l.k || "hamlet"));
    t.setAttribute("x", l.xy[0]); t.setAttribute("y", l.xy[1]); t.textContent = l.t;
    scene.appendChild(t);
  });
  d.roads.forEach((o, i) => { if (o.name) roadLabel(o, i); });   // last, so buildings don't cover the road names
}

function makeMarkers(d) {
  markers.replaceChildren();
  pins = d.pois.map(p => {
    const mk = document.createElement("div");
    mk.className = "mk cat-" + p.cat + (p.mine ? " mine" : "");
    const code = p.aliases ? `<span class="code">${p.aliases.join(" · ")}</span>` : "";
    mk.innerHTML = `<span class="dot"></span><span class="lab">${p.name.replace(" / ", "<br>")}${code}</span>`;
    markers.appendChild(mk);
    return { mk, p };
  });
}

// arrive from a "→ map" link elsewhere (#<place>, by POI name or room-code alias): centre on it,
// force its label on, and pulse the pin so it's easy to spot among the others.
function focusPoi(key) {
  if (!key) return;
  const k = key.trim().toLowerCase();
  const hit = pins.find(({ p }) => p.name.toLowerCase() === k || (p.aliases || []).some(a => a.toLowerCase() === k));
  if (!hit) return;
  hit.mk.classList.add("on", "focus");
  view.s = Math.min(fitS * MAXZ, fitS * 5);
  view.tx = W / 2 - view.s * hit.p.xy[0]; view.ty = H / 2 - view.s * hit.p.xy[1];
  render();
}

function toggleLabel(mk) {                          // flip a pin's label, overriding the auto (zoom/hover/mine) rules
  const lab = mk.querySelector(".lab"), showing = getComputedStyle(lab).display !== "none";
  mk.classList.toggle("on", !showing);
  mk.classList.toggle("off", showing);
}

const binfo = $("#binfo");
function showInfo(o, cx, cy) {                      // tap a building → its OSM name/address, above the tap point
  const r = map.getBoundingClientRect();
  binfo.innerHTML = (o.n ? `<b>${esc(o.n)}</b>` : "") + (o.a ? `<span>${esc(o.a)}</span>` : "");
  binfo.style.left = cx - r.left + "px";
  binfo.style.top = cy - r.top + "px";
  binfo.hidden = false;
}
const hideInfo = () => { binfo.hidden = true; };

function place() {
  markers.classList.toggle("zoom", view.s > fitS * 2.1);
  pins.forEach(({ mk, p }) => {
    const x = sx(p.xy[0]);
    mk.style.left = x + "px";
    mk.style.top = sy(p.xy[1]) + "px";
    mk.classList.toggle("rev", x > W * 0.62);
  });
  if (me) {
    meEl.style.left = sx(me.x) + "px"; meEl.style.top = sy(me.y) + "px";
    const d = 2 * me.acc * view.s;                                // accuracy is metres → screen px scales with zoom
    accEl.style.width = accEl.style.height = d + "px";
  }
}

// live "you are here" dot: watchPosition → project lat/lon into scene metres (same equirectangular
// projection as build-map.py), then place() repositions it in screen space like the pins.
function onPos(pos) {
  const b = D.meta.bbox;                                          // [S, W, N, E]
  const KX = 111320 * Math.cos((b[0] + b[2]) / 2 * Math.PI / 180), KY = 110540;
  me = { x: (pos.coords.longitude - b[1]) * KX, y: (b[2] - pos.coords.latitude) * KY, acc: pos.coords.accuracy || 0 };
  meEl.hidden = false; $("#loc").classList.add("on"); schedule();
}
function locate() {
  if (!watching && navigator.geolocation) {
    watching = true;
    navigator.geolocation.watchPosition(onPos, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  }
}

function render() {
  scene.parentNode.setAttribute("viewBox", `0 0 ${W} ${H}`);
  scene.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.s})`);
  place();
  scale();
}
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

function scale() {
  const mpp = 1 / view.s;                          // metres per screen px (scene units are metres)
  const pow = Math.pow(10, Math.floor(Math.log10(120 * mpp)));
  const v = 120 * mpp / pow, m = (v >= 5 ? 5 : v >= 2 ? 2 : 1) * pow;
  $("#sl").style.width = Math.round(m / mpp) + "px";
  $("#sl-lab").textContent = m >= 1000 ? m / 1000 + " km" : m + " m";
}

function fit() {
  const r = map.getBoundingClientRect(); W = r.width; H = r.height;
  fitS = Math.min(W / D.meta.w, H / D.meta.h);       // contain: binding axis fills the area (edges touch); the rest of the bbox stays visible
  view = { s: fitS, tx: (W - fitS * D.meta.w) / 2, ty: (H - fitS * D.meta.h) / 2 };
  render();
}

function zoom(f, ax, ay) {
  ax = ax == null ? W / 2 : ax; ay = ay == null ? H / 2 : ay;
  const s = Math.max(fitS * MINZ, Math.min(fitS * MAXZ, view.s * f));
  if (s === view.s) return;
  view.tx = ax - (ax - view.tx) * (s / view.s);
  view.ty = ay - (ay - view.ty) * (s / view.s);
  view.s = s; render();
}

// one pointer pans; two pinch-zoom; a still single tap toggles the pin's label (mouse + touch alike)
const ptrs = new Map();
let g = null, down = null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rel = e => { const r = map.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

map.addEventListener("pointerdown", e => {
  if (e.target.closest(".tl, .ctl")) return;        // controls keep their own clicks
  hideInfo();                                       // any new gesture dismisses an open building chip
  try { map.setPointerCapture(e.pointerId); } catch {}
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) {
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.target, moved: false };
    g = { mode: "pan", tx: view.tx, ty: view.ty, x: e.clientX, y: e.clientY };
  } else if (ptrs.size === 2) { down = null; pinchStart(); }
});

function pinchStart() {
  const [a, b] = [...ptrs.values()], r = map.getBoundingClientRect();
  g = { mode: "pinch", d: dist(a, b), s: view.s, tx: view.tx, ty: view.ty,
        cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top };
}

map.addEventListener("pointermove", e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (g.mode === "pinch" && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const s = Math.max(fitS * MINZ, Math.min(fitS * MAXZ, g.s * dist(a, b) / g.d));
    view.s = s;                                     // keep the two-finger midpoint anchored
    view.tx = g.cx - (g.cx - g.tx) * (s / g.s);
    view.ty = g.cy - (g.cy - g.ty) * (s / g.s);
    schedule();
  } else if (g.mode === "pan") {
    if (Math.abs(e.clientX - down.x) > 6 || Math.abs(e.clientY - down.y) > 6) down.moved = true;
    view.tx = g.tx + (e.clientX - g.x);
    view.ty = g.ty + (e.clientY - g.y);
    map.classList.add("drag");
    schedule();
  }
});

function lift(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  map.classList.remove("drag");
  if (ptrs.size === 1) {                             // pinch → pan: re-baseline to the finger left down
    const p = [...ptrs.values()][0];
    g = { mode: "pan", tx: view.tx, ty: view.ty, x: p.x, y: p.y }; down = null;
  } else if (ptrs.size === 0) {
    if (down && !down.moved) {                       // a still tap
      const dot = down.t.closest && down.t.closest(".dot");
      if (dot) { dot.parentNode.classList.remove("focus"); toggleLabel(dot.parentNode); }   // pin → stop its pulse + toggle label
      else if (down.t.__info) showInfo(down.t.__info, down.x, down.y);   // building → its name/address
    }
    g = down = null;
  }
}
map.addEventListener("pointerup", lift);
map.addEventListener("pointercancel", lift);
map.addEventListener("wheel", e => {
  e.preventDefault();
  const p = rel(e);
  zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y);
}, { passive: false });

$("#in").addEventListener("click", () => zoom(1.4));
$("#out").addEventListener("click", () => zoom(1 / 1.4));
$("#fit").addEventListener("click", fit);
$("#loc").addEventListener("click", () => {                       // request/centre on my location
  locate();
  if (me) {
    view.s = Math.min(fitS * MAXZ, Math.max(view.s, fitS * 4));
    view.tx = W / 2 - view.s * me.x; view.ty = H / 2 - view.s * me.y;
    render();
  }
});
$("#pins").addEventListener("click", e => {
  const b = e.currentTarget, on = b.getAttribute("aria-pressed") === "true";
  b.setAttribute("aria-pressed", String(!on));
  markers.classList.toggle("off", on);
});

const ATTR = {
  map: 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  relief: 'Relief: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>',
  aerial: 'Aerial © <a href="https://basemap.at" target="_blank" rel="noopener">basemap.at</a> · CC BY',
};
const seg = $("#seg");
function setMode(m) {
  map.classList.remove("mode-map", "mode-relief", "mode-aerial");
  map.classList.add("mode-" + m);
  seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.m === m));
  $("#attr").innerHTML = ATTR[m];
}
seg.addEventListener("click", e => { const b = e.target.closest("button"); if (b) setMode(b.dataset.m); });

// "your base" (the one warm-brass POI) follows the schedule page's picked identity via the roster's
// Hotel column — the mine flag baked into map-data.json is cleared so brass stays the picked user's.
// No pick / unmapped lodging (Haus Simona, Haus Salcher) → no brass pin, everything else as usual.
function myBase(d) {
  d.pois.forEach(p => delete p.mine);
  const who = (Roster.cached() || []).find(x => x.name === Roster.me());
  const t = who && Roster.hotelPoi(who.hotel);
  const poi = t && d.pois.find(p => p.name.toLowerCase() === t.toLowerCase());
  if (poi) poi.mine = true;
}

let D;
fetch("./map-data.json").then(r => r.json()).then(d => {
  D = d; myBase(d); drawScene(d); makeMarkers(d); setMode("map"); fit();
  let at = ""; try { at = decodeURIComponent(location.hash.slice(1)); } catch {}
  focusPoi(at); locate();
  new ResizeObserver(() => { const r = map.getBoundingClientRect(); W = r.width; H = r.height; render(); }).observe(map);
});
