#!/usr/bin/env node
// Behavioral tests for sw.js's fetch handler — the offline / "lie-fi" contract that arrived with
// the pwa-starter 77fcb35 modernization. Loads sw.js UNMODIFIED under mocked SW globals (self,
// caches, fetch, Response, URL) and a FAKE clock, so the network-timeout bounds
// (NET_TIMEOUT_MS / NET_TIMEOUT_COLD_MS) run deterministically and instantly. No dependencies.
//
//     node scripts/sw.test.mjs
//
// Exits non-zero on any failed assertion.
import { readFileSync } from "node:fs";

// ---- fake clock ------------------------------------------------------------
let now = 0;
let nextTimer = 1;
const timers = new Map();
const fakeSetTimeout = (fn, ms) => { const id = nextTimer++; timers.set(id, { at: now + (ms || 0), fn }); return id; };
const fakeClearTimeout = (id) => { timers.delete(id); };
const flush = async (n = 60) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
async function tick(ms) {
  const target = now + ms;
  await flush();
  for (;;) {
    let dueId = null, dueAt = Infinity;
    for (const [id, t] of timers) if (t.at <= target && t.at < dueAt) { dueId = id; dueAt = t.at; }
    if (dueId === null) break;
    const t = timers.get(dueId);
    timers.delete(dueId);
    now = t.at;
    t.fn();
    await flush();
  }
  now = target;
  await flush();
}

// ---- mocked SW environment -------------------------------------------------
// Project-page-shaped scope so docKey()'s scope-stripping is exercised.
const ORIGIN = "https://ex.test";
const BASE = ORIGIN + "/akm/";
const b = (p) => BASE + p;

let fetchMode = "ok";        // "ok" | "slow" | "offline" | "offline-heal" | "redirect"
let fetchStatus = 200;
let fetchCalls = 0;
let healEntry = null;        // [url, response] inserted by "offline-heal" before it rejects
const CACHE = new Map();     // url -> response

const makeResponse = (body, { status = 200, redirected = false, type = "basic" } = {}) => ({
  _body: body, status, ok: status >= 200 && status < 300, redirected, type,
  clone() { return makeResponse(body, { status, redirected, type }); },
});
const href = (r) => (typeof r === "string" ? new URL(r, self.location).href : r.url);
const req = (url, mode = "no-cors") => ({ url, method: "GET", mode });

const self = {
  location: new URL(BASE + "sw.js"),
  registration: {},
  clients: { claim: async () => {} },
  skipWaiting: async () => {},
  _listeners: {},
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); },
};
const location = self.location;
const ResponseCtor = function (body, init = {}) { return makeResponse(body, { status: init.status || 200 }); };

const cacheApi = {
  async match(r) { return CACHE.get(href(r)); },
  async put(r, resp) { CACHE.set(href(r), resp); },
  async keys() { return [...CACHE.keys()].map((url) => ({ url })); },
};
const caches = {
  async open() { return cacheApi; },
  async match(r) { return CACHE.get(href(r)); },
  async keys() { return ["akm-v109"]; },
  async delete() { return true; },
};
const fetchImpl = async (r) => {
  fetchCalls++;
  if (fetchMode === "offline") throw new Error("offline");
  if (fetchMode === "offline-heal") { if (healEntry) CACHE.set(href(healEntry[0]), healEntry[1]); throw new Error("offline"); }
  if (fetchMode === "slow") return new Promise(() => {});   // never settles → only a timeout ends it
  // A navigation's redirect mode is "manual": the browser hands the SW an opaqueredirect
  // (status 0, ok false) that respondWith must pass back for the browser to follow.
  if (fetchMode === "redirect") return makeResponse("", { status: 0, type: "opaqueredirect" });
  return makeResponse("NET:" + href(r), { status: fetchStatus });
};

// ---- load sw.js under those globals ----------------------------------------
const src = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
new Function("self", "location", "caches", "fetch", "Response", "URL", "setTimeout", "clearTimeout", src)(
  self, location, caches, fetchImpl, ResponseCtor, URL, fakeSetTimeout, fakeClearTimeout,
);
const fetchHandler = self._listeners.fetch[0];

function start(request) {
  let settle;
  const done = new Promise((res) => (settle = res));
  fetchHandler({ request, respondWith: (p) => Promise.resolve(p).then(settle), waitUntil() {} });
  return done;
}
async function intercepts(request) {
  let called = false;
  fetchHandler({ request, respondWith: () => { called = true; }, waitUntil() {} });
  await flush();
  return called;
}
const bodyOf = (r) => (r ? (r._body ?? "(generated page)") : "(undefined!)");
const isPending = async (p) => (await Promise.race([p.then(() => false), flush().then(() => true)]));

// ---- assertions ------------------------------------------------------------
// Seed a FAILING exit code up front. The suite runs inside an async IIFE; if the fetch handler
// ever HANGS (e.g. a regression back to unbounded network-first), that IIFE never settles, and
// with only the fake clock there's no real timer keeping the process alive — node would drain the
// event loop and exit 0, silently green on the exact hang this suite exists to catch. The final
// process.exit() is the only sanctioned clean exit.
process.exitCode = 1;

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) { pass++; console.log("  ok   -", name); } else { fail++; console.log("  FAIL -", name, detail); } };
function reset(mode = "ok", status = 200) { CACHE.clear(); fetchMode = mode; fetchStatus = status; fetchCalls = 0; healEntry = null; now = 0; timers.clear(); }
// index dies without app.js + the three data scripts; network.html without d3/network.js/roster.
const seedIndex = () => {
  CACHE.set(BASE, makeResponse("CACHED_ROOT"));
  CACHE.set(b("index.html"), makeResponse("CACHED_INDEX"));
  CACHE.set(b("app.js"), makeResponse("CACHED_APP"));
  CACHE.set(b("roster-data.js"), makeResponse("CACHED_ROSTER"));
  CACHE.set(b("concert-data.js"), makeResponse("CACHED_CONCERTS"));
  CACHE.set(b("schedule-archive.js"), makeResponse("CACHED_ARCHIVE"));
};
const seedNetworkPage = () => {
  CACHE.set(b("network.html"), makeResponse("CACHED_NETWORK"));
  CACHE.set(b("d3.v7.min.js"), makeResponse("CACHED_D3"));
  CACHE.set(b("network.js"), makeResponse("CACHED_NETJS"));
  CACHE.set(b("roster-data.js"), makeResponse("CACHED_ROSTER"));
};

(async () => {
  // --- cache-first happy path: instant, zero network -----------------------
  reset("slow"); seedIndex();
  let r = await start(req(BASE, "navigate"));
  ok("cached+bootable index nav → cache, 0 fetches", bodyOf(r) === "CACHED_ROOT" && fetchCalls === 0, `body=${bodyOf(r)} fetches=${fetchCalls}`);

  reset("slow"); seedNetworkPage();
  r = await start(req(b("network.html"), "navigate"));
  ok("network.html nav → its OWN page (not index)", bodyOf(r) === "CACHED_NETWORK" && fetchCalls === 0);

  reset("slow"); seedIndex();
  r = await start(req(b("app.js")));
  ok("cached subresource → cache, 0 fetches", bodyOf(r) === "CACHED_APP" && fetchCalls === 0, `fetches=${fetchCalls}`);

  reset("slow");
  CACHE.set(b("programs/2026-07-08-evening.pdf"), makeResponse("CACHED_PDF"));
  r = await start(req(b("programs/2026-07-08-evening.pdf")));
  ok("precached program PDF → cache, 0 fetches (venue case)", bodyOf(r) === "CACHED_PDF" && fetchCalls === 0, `fetches=${fetchCalls}`);

  // --- first run ------------------------------------------------------------
  reset("ok");
  r = await start(req(BASE, "navigate"));
  ok("first-run online nav → network response", bodyOf(r) === "NET:" + BASE && fetchCalls === 1);

  reset("offline");
  r = await start(req(BASE, "navigate"));
  ok("first-run offline nav → real fallback page", r && r.status === 503, `status=${r && r.status}`);

  reset("offline");
  r = await start(req(b("icon-192.png")));
  ok("uncached image offline → real 504", r && r.status === 504, `status=${r && r.status}`);

  reset("offline");
  r = await start(req(b("map.js")));
  ok("uncached script offline → real 504, not HTML", r && r.status === 504, `status=${r && r.status}`);

  // wrong-document fallback is CLOSED: an uncached map.html nav offline must NOT get index.html
  reset("offline"); seedIndex();
  r = await start(req(b("map.html"), "navigate"));
  ok("uncached map.html nav offline → honest fallback, NOT index.html", r && r.status === 503 && bodyOf(r) !== "CACHED_INDEX", `status=${r && r.status} body=${bodyOf(r)}`);

  // --- the COLD (no-cache) path must be BOUNDED, not infinite ---------------
  reset("slow");
  let p = start(req(BASE, "navigate"));
  await tick(3001);
  ok("cold lie-fi nav still pending at 3s (WARM bound must not apply)", await isPending(p));
  await tick(14000);
  r = await p;
  ok("cold lie-fi nav → bounded, honest fallback", r && r.status === 503, `status=${r && r.status}`);

  // --- WARM bound: cached-but-unbootable + lie-fi resolves at 3s ------------
  reset("slow");
  CACHE.set(b("network.html"), makeResponse("CACHED_NETWORK"));   // doc cached, d3 absent → not bootable
  p = start(req(b("network.html"), "navigate"));
  await tick(2999);
  ok("warm lie-fi nav still pending just before 3s", await isPending(p));
  await tick(3);
  r = await p;
  ok("warm lie-fi nav → fallback at ~3s (does NOT wait 15s)", r && r.status === 503, `status=${r && r.status}`);

  // --- a navigation 5xx must NOT serve the unbootable cached doc ------------
  reset("ok", 500);
  CACHE.set(b("network.html"), makeResponse("CACHED_UNBOOTABLE_NETWORK"));
  r = await start(req(b("network.html"), "navigate"));
  ok("nav + server 500 → honest fallback, not bare doc", r && r.status === 503 && bodyOf(r) !== "CACHED_UNBOOTABLE_NETWORK", `status=${r && r.status} body=${bodyOf(r)}`);

  reset("ok", 500);
  r = await start(req(b("app.js")));
  ok("subresource + server 500 → returns the response (unchanged)", r && r.status === 500, `status=${r && r.status}`);

  reset("ok", 404);
  r = await start(req(b("typo.html"), "navigate"));
  ok("online nav + 404 → server's 404, not the offline lie", r && r.status === 404, `status=${r && r.status}`);

  reset("redirect");
  r = await start(req(b("programs"), "navigate"));
  ok("online nav + 301 → opaqueredirect passed back, not offline page", r && r.type === "opaqueredirect", `type=${r && r.type} status=${r && r.status}`);

  // --- the catch re-reads the cache, catching a mid-window repair -----------
  reset("offline-heal");
  CACHE.set(b("map.js"), makeResponse("CACHED_MAPJS"));
  CACHE.set(b("roster-data.js"), makeResponse("CACHED_ROSTER"));   // map.html's boot deps present
  healEntry = [b("map.html"), makeResponse("REPAIRED_MAP")];
  r = await start(req(b("map.html"), "navigate"));
  ok("catch re-reads cache → serves mid-window repair", bodyOf(r) === "REPAIRED_MAP", `body=${bodyOf(r)}`);

  // --- data + fonts branches ------------------------------------------------
  reset("slow");
  CACHE.set(b("map-data.json"), makeResponse("CACHED_MAPDATA"));
  r = await start(req(b("map-data.json")));
  ok("precached json → cache, 0 fetches (no discarded revalidate)", bodyOf(r) === "CACHED_MAPDATA" && fetchCalls === 0, `fetches=${fetchCalls}`);

  reset("ok");
  CACHE.set(b("extra.json"), makeResponse("CACHED_EXTRA"));
  r = await start(req(b("extra.json")));
  ok("non-shell json → cached copy + background refresh", bodyOf(r) === "CACHED_EXTRA" && fetchCalls === 1, `body=${bodyOf(r)} fetches=${fetchCalls}`);

  reset("slow");
  CACHE.set("https://fonts.gstatic.com/s/font.woff2", makeResponse("CACHED_FONT"));
  r = await start(req("https://fonts.gstatic.com/s/font.woff2"));
  ok("cached webfont → cache, 0 fetches", bodyOf(r) === "CACHED_FONT" && fetchCalls === 0, `fetches=${fetchCalls}`);

  // --- pass-throughs --------------------------------------------------------
  reset("ok");
  ok("sw.js version probe → not intercepted (old worker cached these)", !(await intercepts(req(b("sw.js?_=123"), "no-cors"))));
  reset("ok");
  ok("POST → not intercepted", !(await intercepts({ url: BASE, method: "POST", mode: "navigate" })));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
