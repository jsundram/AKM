// E2E test of the concerts.html recordings gate — self-contained and PII-free. It builds its OWN
// encrypted blob from a tiny fixture (two real, public concert-data.js keys) with a known test
// password and serves it in place of recordings.enc.js, so the test never touches the gitignored
// recordings.json or the real deployed password. Serves the repo over localhost (a secure context,
// so crypto.subtle works) and drives Chromium: locked → wrong pw → right pw reveals links →
// persists across reload → lock again. Skips (exit 0) when no Chromium is present (offline/CI).
// Run: `npm run test:rec`.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
import { webcrypto as wc } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const PW = "test-passphrase";

// two real (public — not PII) keys, so recLink finds them against concert-data.js
const FIX = {
  "2026-07-04-aft | Fauré | Piano Quartet No. 1 in C minor, Op. 15": "https://drive.google.com/file/d/FIXTUREaaa/view",
  "2026-07-11-eve | Shaw | Thousandth Orange": "https://drive.google.com/file/d/FIXTUREbbb/view",
};

// same recipe as scripts/build-recordings.js
async function buildBlob(map, pw){
  const data = new TextEncoder().encode(JSON.stringify(map));
  const salt = wc.getRandomValues(new Uint8Array(16)), iv = wc.getRandomValues(new Uint8Array(12)), iter = 200000;
  const km = await wc.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  const key = await wc.subtle.deriveKey({ name:"PBKDF2", salt, iterations:iter, hash:"SHA-256" },
    km, { name:"AES-GCM", length:256 }, false, ["encrypt"]);
  const ct = new Uint8Array(await wc.subtle.encrypt({ name:"AES-GCM", iv }, key, data));
  const b64 = u => Buffer.from(u).toString("base64");
  return `window.RecEnc = {v:1,iter:${iter},salt:"${b64(salt)}",iv:"${b64(iv)}",ct:"${b64(ct)}"};\n`;
}

function findChromium(){
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if(!existsSync(base)) return null;
  const dirs = readdirSync(base).sort().reverse();
  for(const pat of ["headless_shell", "chrome"]) for(const d of dirs){
    const p = join(base, d, "chrome-linux", pat); if(existsSync(p)) return p;
  }
  return null;
}
const EXE = findChromium();
if(!EXE){ console.log("SKIP  no Chromium found (set PW_CHROMIUM or run in Claude Code on the web)."); process.exit(0); }
let chromium;
try{ ({ chromium } = require("playwright-core")); }
catch{ console.log("SKIP  playwright-core not installed (`npm install`)."); process.exit(0); }

const BLOB = await buildBlob(FIX, PW);
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".json":"application/json",
  ".css":"text/css", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg" };
const server = createServer(async (req,res)=>{
  let p = decodeURIComponent(new URL(req.url,"http://x").pathname);
  if(p === "/recordings.enc.js"){                                 // serve the fixture blob, not the real one
    res.writeHead(200, { "content-type":"text/javascript" }); res.end(BLOB); return;
  }
  try{
    if(p.endsWith("/")) p += "index.html";
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(body);
  }catch{ res.writeHead(404); res.end("nf"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let pass=0, fail=0;
const ok=(n,c)=>{ c?pass++:fail++; console.log((c?"PASS ":"FAIL ")+n); };

const browser = await chromium.launch({ executablePath: EXE });
try{
  const page = await browser.newPage();
  await page.goto(`${BASE}/concerts.html`, { waitUntil:"domcontentloaded" });
  await page.waitForTimeout(400);

  ok("secure context (crypto.subtle)", await page.evaluate(() => !!(window.isSecureContext && crypto.subtle)));
  ok("lock bar shown + locked", await page.evaluate(() =>
    !document.querySelector("#reclock").hidden && !!document.querySelector("#recpw")));
  ok("no recording links while locked", await page.$$eval("a.rec", e => e.length) === 0);

  await page.fill("#recpw", "wrong"); await page.click("#reclock button[type=submit]"); await page.waitForTimeout(200);
  ok("wrong password → error, still locked", await page.evaluate(() =>
    !document.querySelector("#recerr").hidden && document.querySelectorAll("a.rec").length === 0));

  await page.fill("#recpw", PW); await page.click("#reclock button[type=submit]"); await page.waitForTimeout(300);
  ok("right password → 2 fixture links", await page.$$eval("a.rec", e => e.length) === 2);
  ok("links point at Drive", await page.$$eval("a.rec", e => e.every(a => a.href.includes("drive.google.com/file/d/"))));
  ok("map cached in localStorage", await page.evaluate(() => !!localStorage.getItem("akm-rec")));

  await page.reload({ waitUntil:"domcontentloaded" }); await page.waitForTimeout(400);
  ok("still unlocked after reload (no re-prompt)", await page.$$eval("a.rec", e => e.length) === 2 && !(await page.$("#recpw")));

  await page.click("#reclock-fwd"); await page.waitForTimeout(200);
  ok("lock again → links gone, form back", await page.evaluate(() =>
    document.querySelectorAll("a.rec").length === 0 && !!document.querySelector("#recpw") && !localStorage.getItem("akm-rec")));
}finally{ await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
