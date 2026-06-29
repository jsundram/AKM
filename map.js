// Liesing/Klebas map: draws the baked OSM vector basemap (map-data.json, metres) as a custom
// SVG, with the festival POIs pinned on an HTML overlay. No tiles, no libs — fully offline.
// Pan/zoom move a transform on #scene; markers are repositioned in screen space each frame so
// pins stay a constant size and labels never scale into mush.
const $ = s => document.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const el = (t, c) => { const e = document.createElementNS(NS, t); if (c) e.setAttribute("class", c); return e; };
const pts = p => { let s = ""; for (let i = 0; i < p.length; i += 2) s += p[i] + "," + p[i + 1] + " "; return s; };

const map = $("#map"), scene = $("#scene"), markers = $("#markers");
let W, H, view = { s: 1, tx: 0, ty: 0 }, fitS = 1, pins = [], raf = 0;

const sx = x => view.tx + view.s * x;            // scene metres → screen px
const sy = y => view.ty + view.s * y;

function drawScene(d) {
  scene.replaceChildren();
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
  add("road", d.roads, "polyline", "points");
  add("bldg", d.buildings, "polygon", "points");
  d.pois.forEach(p => {                            // highlighted footprints under the pins
    if (!p.fp) return;
    const e = el("polygon", "fp fp-" + (p.mine ? "mine" : p.cat));
    e.setAttribute("points", pts(p.fp));
    scene.appendChild(e);
  });
  d.labels.forEach(l => {
    const t = el("text", "hamlet");
    t.setAttribute("x", l.xy[0]); t.setAttribute("y", l.xy[1]); t.textContent = l.t;
    scene.appendChild(t);
  });
}

function makeMarkers(d) {
  markers.replaceChildren();
  pins = d.pois.map(p => {
    const mk = document.createElement("div");
    mk.className = "mk cat-" + p.cat + (p.mine ? " mine" : "");
    mk.innerHTML = `<span class="dot"></span><span class="lab">${p.name}</span>`;
    const dot = mk.firstChild;
    dot.addEventListener("pointerdown", e => e.stopPropagation());   // don't start a map drag
    dot.addEventListener("click", e => {
      e.stopPropagation();
      const on = mk.classList.contains("active");
      pins.forEach(q => q.mk.classList.remove("active"));
      if (!on) mk.classList.add("active");
    });
    markers.appendChild(mk);
    return { mk, p };
  });
}

function place() {
  markers.classList.toggle("zoom", view.s > fitS * 2.1);
  pins.forEach(({ mk, p }) => {
    const x = sx(p.xy[0]);
    mk.style.left = x + "px";
    mk.style.top = sy(p.xy[1]) + "px";
    mk.classList.toggle("rev", x > W * 0.62);
  });
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
  fitS = Math.min(W / D.meta.w, H / D.meta.h) * 0.94;
  view = { s: fitS, tx: (W - fitS * D.meta.w) / 2, ty: (H - fitS * D.meta.h) / 2 };
  render();
}

function zoom(f, ax, ay) {
  ax = ax == null ? W / 2 : ax; ay = ay == null ? H / 2 : ay;
  const s = Math.max(fitS * 0.7, Math.min(fitS * 9, view.s * f));
  if (s === view.s) return;
  view.tx = ax - (ax - view.tx) * (s / view.s);
  view.ty = ay - (ay - view.ty) * (s / view.s);
  view.s = s; render();
}

let drag = null;
map.addEventListener("pointerdown", e => {
  map.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  map.classList.add("drag");
});
map.addEventListener("pointermove", e => {
  if (!drag) return;
  view.tx = drag.tx + (e.clientX - drag.x);
  view.ty = drag.ty + (e.clientY - drag.y);
  schedule();
});
const end = () => { drag = null; map.classList.remove("drag"); };
map.addEventListener("pointerup", end);
map.addEventListener("pointercancel", end);
map.addEventListener("wheel", e => {
  e.preventDefault();
  const r = map.getBoundingClientRect();
  zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

$("#in").addEventListener("click", () => zoom(1.4));
$("#out").addEventListener("click", () => zoom(1 / 1.4));
$("#fit").addEventListener("click", fit);
$("#pins").addEventListener("click", e => {
  const b = e.currentTarget, on = b.getAttribute("aria-pressed") === "true";
  b.setAttribute("aria-pressed", String(!on));
  markers.classList.toggle("off", on);
});

let D;
fetch("./map-data.json").then(r => r.json()).then(d => {
  D = d; drawScene(d); makeMarkers(d); fit();
  new ResizeObserver(() => { const r = map.getBoundingClientRect(); W = r.width; H = r.height; render(); }).observe(map);
});
