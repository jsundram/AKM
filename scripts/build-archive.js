// scripts/build-archive.js — bake the FROZEN festival snapshot into ../schedule-archive.js.
//
// The festival's over; the schedule Google Sheet may be deleted or moved, and the live schedule +
// weather otherwise live only in each device's localStorage — so a fresh phone (or the site after
// the sheet is gone) would show nothing. This bakes a self-contained snapshot into the repo, which
// app.js reads as a data FLOOR (any live/cached day still wins), so the festival renders anywhere.
//
// Schedule: pulled per day via gviz and parsed through app.js's OWN parse() — no logic copy.
// Weather: observed ERA5 from archive-api.open-meteo.com, falling back to the forecast host's
// best-match blend when the archive host is unreachable (a proxy-locked sandbox, say). The whole
// festival range is in the past, so the forecast host returns settled data for it. Same day-shape
// either way via app.js's exported normWx(), so it can't drift from what wxcard() renders.
//
// Hand-run, network-tolerant, NOT in the pre-commit hook:   node scripts/build-archive.js
// Then bump sw.js V (schedule-archive.js is precached). CAVEAT: ERA5 archive lags real-time by a
// few days — run this a few days after the festival so the final days (7/11–7/12) are covered; a
// still-missing tail day just falls back to the forecast host (or fill it from a device cache).
const fs = require("fs");
const path = require("path");
const https = require("https");
const C = require("../app.js");

const SSID = "1AvNjAUQMFPjJAlwY4Day2MgHt5-2Vd8EDocpdxJQ6_A";   // schedule sheet (matches app.js SID)
const FEST = ["2026-06-29", "2026-07-12"];                     // [start, end] inclusive — matches app.js
const LAT = 46.6928, LON = 12.8166, TZ = "Europe/Vienna";     // Kultursaal default (app.js refines from the map POI at runtime; the valley is within forecast tolerance)

const get = u => new Promise((res, rej) =>
  https.get(u, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(d)); }).on("error", rej));
const unwrap = t => JSON.parse(t.slice(t.indexOf("(") + 1, t.lastIndexOf(")"))).table;
const enc = encodeURIComponent;

function festDays() {
  const out = [], d = new Date(FEST[0] + "T12:00:00"), end = new Date(FEST[1] + "T12:00:00");
  for (; d <= end; d.setDate(d.getDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const tabName = iso => { const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" }) + " " + (d.getMonth() + 1) + "/" + d.getDate(); };
const schedUrl = tab => `https://docs.google.com/spreadsheets/d/${SSID}/gviz/tq?tqx=out:json&sheet=${enc(tab)}`;

const WX = "&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,weathercode" +
  "&hourly=temperature_2m,precipitation,weathercode&temperature_unit=fahrenheit" +
  `&timezone=${enc(TZ)}&start_date=${FEST[0]}&end_date=${FEST[1]}`;
const WX_SRC = { archive: "Open-Meteo · ERA5 archive", forecast: "Open-Meteo · best match" };

async function weather() {
  for (const [host, key] of [["https://archive-api.open-meteo.com/v1/archive", "archive"],
                             ["https://api.open-meteo.com/v1/forecast", "forecast"]]) {
    try {
      const days = C.normWx(JSON.parse(await get(`${host}?latitude=${LAT}&longitude=${LON}${WX}`)));
      if (Object.keys(days).length) {
        for (const k in days) days[k].src = WX_SRC[key];
        console.log(`weather: ${Object.keys(days).length} days via ${WX_SRC[key]}`);
        return days;
      }
    } catch (e) { console.log(`weather: ${key} host unavailable (${e.message}) — trying next`); }
  }
  console.log("weather: no source reachable — baking schedule only");
  return {};
}

async function schedule() {
  const sched = {};
  for (const iso of festDays()) {
    const tab = tabName(iso);
    try {
      const p = C.parse(C.rowsFrom({ table: unwrap(await get(schedUrl(tab))) }));
      if (p.rehearsals.length || p.meals.length || p.allhands.length || p.evening.length || p.slots.length || p.info.length) {
        sched[iso] = p;
        console.log(`sched ${iso} (${tab}): ${p.rehearsals.length} reh · ${p.meals.length} meal · ${p.evening.length} eve · ${p.slots.length} slot · ${(p.dress || []).length} dress`);
      } else console.log(`sched ${iso} (${tab}): empty / unposted — skipped`);
    } catch (e) { console.log(`sched ${iso} (${tab}): unreachable (${e.message}) — skipped`); }
  }
  return sched;
}

// one day per line, so schedule-archive.js greps by date and git-diffs per day (leaves stay inline,
// like build-map.py's write_json) rather than exploding into thousands of lines.
function byLine(obj) {
  const keys = Object.keys(obj).sort();
  if (!keys.length) return "{}";
  return "{\n" + keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`).join(",\n") + "\n }";
}

(async () => {
  const sched = await schedule();
  const wx = await weather();
  const out =
`// window.Archive — the FROZEN festival snapshot (schedule + weather), baked into the repo so the
// festival renders on ANY device with zero dependency on the live schedule sheet (which may be
// deleted/moved post-festival). app.js reads it as a data FLOOR: any live or cached day wins, this
// fills the gaps. GENERATED — do not hand-edit; regenerate with  node scripts/build-archive.js
// (then bump sw.js V, since this file is precached). Schedule is parsed through app.js's own
// parse(); weather is observed ERA5 (archive-api), falling back to best-match when that host is
// unreachable. Performer/lesson names appear here like the concert programs — the PII rule is
// lodging + phones, which never enter the schedule.
(() => {
const g = typeof window !== "undefined" ? window : globalThis;   // Node-requirable, harmless
g.Archive = {
 "sched": ${byLine(sched)},
 "wx": ${byLine(wx)}
};
})();
`;
  fs.writeFileSync(path.join(__dirname, "..", "schedule-archive.js"), out);
  console.log(`\nwrote schedule-archive.js — ${Object.keys(sched).length} schedule days, ${Object.keys(wx).length} weather days`);
})();
