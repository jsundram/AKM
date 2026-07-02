// Browser test for the schedule page's personal-events flow (add / render / persist / delete).
// Self-contained: serves the repo over a throwaway http server and drives a pre-installed
// Chromium via playwright-core — no network, no fixtures with PII. Run: `npm run test:ui`.
//
// Needs the Chromium that ships in Claude Code on the web (/opt/pw-browsers, the `headless_shell`
// build). Locally: `PW_CHROMIUM=/path/to/chrome-headless-shell npm run test:ui`, or install a
// browser and point PW_CHROMIUM at it. Skips (exit 0) with a note if no browser is found.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";

const ROOT = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);

// --- locate the browser binary (env override, else scan the web env's browser dir) ---
function findChromium(){
  if(process.env.PW_CHROMIUM && existsSync(process.env.PW_CHROMIUM)) return process.env.PW_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if(!existsSync(base)) return null;
  // prefer chrome-headless-shell (old-headless, which playwright-core's default launch uses)
  const dirs = readdirSync(base).sort().reverse();
  for(const pat of ["headless_shell", "chrome"]){
    for(const d of dirs){
      const p = join(base, d, "chrome-linux", pat);
      if(existsSync(p)) return p;
    }
  }
  return null;
}

const EXE = findChromium();
if(!EXE){
  console.log("SKIP  no Chromium found (set PW_CHROMIUM or run in Claude Code on the web). Skipping browser test.");
  process.exit(0);
}

let chromium;
try{ ({ chromium } = require("playwright-core")); }
catch{ console.log("SKIP  playwright-core not installed (run `npm install`). Skipping browser test."); process.exit(0); }

// --- tiny static server for the repo root ---
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg" };
const server = createServer(async (req,res)=>{
  try{
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if(p.endsWith("/")) p += "index.html";
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(body);
  }catch{ res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let pass=0, fail=0;
const ok=(n,c)=>{ c?pass++:fail++; console.log((c?"PASS ":"FAIL ")+n); };

// a minimal parse()-shaped day so the timeline renders from cache alone (no gviz/open-meteo).
// Fake coach + generic pieces — no participant data.
const DAY = { eyebrow:"Week One", mine:[["14:30","15:30","Dvořák Quartet","A2","Coach","P","dvorak"]],
  meals:[["12:00","13:00","Lunch",""]], allhands:[], evening:[], lessons:[],
  rooms:["A1","A2","A3"], evLabels:{} };
const DK = "2026-07-02";

const browser = await chromium.launch({ executablePath: EXE });
try{
  const page = await browser.newPage();
  const errs=[]; page.on("pageerror", e=>errs.push(String(e)));

  // seed the cache before any app script runs (idempotent; leaves akm-mine untouched)
  await page.addInitScript(([day,dk])=>{
    localStorage.setItem("akm-cache", JSON.stringify({ sched:{ [dk]:day }, wx:{}, ts:new Date().toISOString() }));
  }, [DAY, DK]);

  await page.goto(BASE + "/index.html", { waitUntil:"load" });
  await page.waitForTimeout(400);
  // select July 2 (day-number "2" is unique in the festival range)
  await page.locator(".chip", { hasText:/\b2\b/ }).first().click();
  await page.waitForTimeout(200);
  ok("no page errors on load+select", errs.length===0 || (console.log(errs), false));
  ok("add button present", await page.locator("#addself").count()===1);

  await page.locator("#addself").click();
  await page.waitForTimeout(150);
  ok("add sheet opens", await page.locator("#addsheet").isVisible());
  ok("day label = tab name", (await page.locator("#add-day").textContent()).includes("Thu 7/2"));
  ok("room dropdown = existing rooms", (await page.locator("#f-room option").allTextContents()).join(",").includes("BAND ROOM"));
  const chipTimes = await page.locator("#addslots .slotchip").allTextContents();
  ok("candidate slots from calendar", chipTimes.includes("14:30") && chipTimes.includes("12:00"));

  // add a custom-time event in a free slot
  await page.fill("#f-s","17:20");
  await page.fill("#f-e","18:20");
  await page.fill("#f-what","Play-through");
  await page.fill("#f-who","A. Player, B. Player");
  await page.selectOption("#f-room","A1");
  await page.locator("#addsave").click();
  await page.waitForTimeout(200);

  ok("sheet closes after save", !(await page.locator("#addsheet").isVisible()));
  const card = page.locator(".row.self");
  ok("self card rendered", await card.count()===1);
  const txt = await card.textContent();
  ok("card shows what/who/room/time", txt.includes("Play-through") && txt.includes("A. Player") && txt.includes("A1") && txt.includes("17:20"));

  const order = await page.locator(".tl .row").evaluateAll(rows => rows.map(r=>r.className));
  const iMine = order.findIndex(c=>c.includes("self")), iReh = order.findIndex(c=>c.includes("mine") && !c.includes("self"));
  ok("self card sorted after 14:30 rehearsal", iMine>iReh && iReh>=0);

  await page.reload({ waitUntil:"load" });
  await page.locator(".chip", { hasText:/\b2\b/ }).first().click();
  await page.waitForTimeout(300);
  ok("survives reload (persisted)", await page.locator(".row.self").count()===1);
  ok("stored under akm-mine", await page.evaluate(dk=>!!(JSON.parse(localStorage.getItem("akm-mine")||"{}")[dk]), DK));

  await page.locator(".row.self .selfx").click();
  await page.waitForTimeout(200);
  ok("delete removes card", await page.locator(".row.self").count()===0);
  ok("delete clears store key", await page.evaluate(dk=>!(dk in JSON.parse(localStorage.getItem("akm-mine")||"{}")), DK));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
