// Live smoke test for the schedule's personalization.  Run from repo root:  node scripts/schedule-test.js
//
// archive/parser-test.js proves the parse/match *logic*, but only against frozen synthetic fixtures —
// it can't see the *live sheets* drifting from what userCtx()/mineOf() expect. That blind spot is
// exactly how a roster "Pieces" reformat once silently blanked every user's schedule. This pulls the
// real roster + repertoire, derives each person's pieces via the actual roster-data.js join, and
// sweeps EVERY festival day asserting the schedule still personalizes (mineOf isn't empty, and nobody
// claims more pieces than they play).
//
// Network-gated: the sheets are public (view-only gviz, no auth), so any environment with outbound
// HTTPS works — but if they're unreachable (offline / locked-down sandbox) it SKIPS (exit 0), never
// red-fails. Roster data is PII, so there are deliberately no committed fixtures to fall back to.
const C = require("../app.js");
const RD = require("../roster-data.js");                       // exercise the real derive(), not a copy
const https = require("https");
const RSID = "1j__RMUvFWQlX9UuT-Uxkw7BkqWHCQkbR_hKsTyNwiyo";   // roster + repertoire tabs
const SSID = "1AvNjAUQMFPjJAlwY4Day2MgHt5-2Vd8EDocpdxJQ6_A";   // the schedule
const FEST = ["2026-06-29", "2026-07-12"];                     // [start, end] inclusive — matches app.js

const get = u => new Promise((res, rej) =>
  https.get(u, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(d)); }).on("error", rej));
const url = (sid, q) => `https://docs.google.com/spreadsheets/d/${sid}/gviz/tq?tqx=out:json&${q}`;
const unwrap = t => JSON.parse(t.slice(t.indexOf("(") + 1, t.lastIndexOf(")"))).table;
const cells = t => (t.rows || []).map(r => (r.c || []).map(c => c ? String(c.v ?? c.f ?? "").trim() : ""));
function header(t, rows) {                                     // gviz may label the cols, or dump the header into row 0
  let h = (t.cols || []).map(c => (c.label || "").toLowerCase()), s = 0;
  if (!h.includes("name") && !h.includes("piece")) {
    const i = rows.findIndex(r => r.some(x => /^(name|piece)$/i.test(x))); h = (rows[i] || []).map(x => x.toLowerCase()); s = i + 1;
  }
  return { h, s };
}
function festTabs() {                                          // "Mon 7/6" … the same tab names app.js builds
  const out = [], d = new Date(FEST[0] + "T12:00:00"), end = new Date(FEST[1] + "T12:00:00");
  for (; d <= end; d.setDate(d.getDate() + 1))
    out.push(d.toLocaleDateString("en-US", { weekday: "short" }) + " " + (d.getMonth() + 1) + "/" + d.getDate());
  return out;
}

(async () => {
  let rosterRaw, repRaw;
  try {
    rosterRaw = await get(url(RSID, "gid=800090339"));
    repRaw = await get(url(RSID, "gid=244347893"));
  } catch (e) {
    console.log("skipped — sheets unreachable (" + e.message + ")"); process.exit(0);
  }
  // each schedule day fetched independently — a missing/unposted tab is skipped, not a failure
  const dayRaws = {};
  for (const tab of festTabs()) { try { dayRaws[tab] = await get(url(SSID, "sheet=" + encodeURIComponent(tab))); } catch {} }

  const rt = unwrap(rosterRaw), rr = cells(rt), { h: rh, s: rs } = header(rt, rr), gi = k => rh.indexOf(k);
  let people = rr.slice(rs).filter(r => r[gi("name")]).map(r => ({
    name: r[gi("name")], type: r[gi("type")], instrument: r[gi("instrument")],
    pieces: "", notes: r[gi("notes")], hotel: r[gi("hotel")] }));   // pieces derived below, NOT read from the (deleted) column
  const D = RD.derive(people, cells(unwrap(repRaw)));             // join repertoire → per-person pieces + group map
  people = people.map(p => ({ ...p, pieces: D.byPerson[p.name] || "" }));
  const PG = D.groups, ctx = new Map(people.map(p => [p.name, C.userCtx(people, p.name, PG)]));

  let pass = 0; const out = [];
  const ok = (cond, label) => { out.push((cond ? "ok  " : "FAIL") + "  " + label); pass += cond ? 1 : 0; };
  ok(people.length > 40, `roster pulled (${people.length} people)`);
  ok(Object.keys(PG).length > 30, `repertoire → pieces derived (${Object.keys(PG).length} pieces mapped to groups)`);
  ok(D.unresolved.length === 0, `every repertoire player reconciles to the roster (${D.unresolved.length} unmatched${D.unresolved.length ? ": " + [...new Set(D.unresolved)].join(", ") : ""})`);

  let played = 0;                                               // days with group rehearsals (the ones that must personalize)
  for (const [tab, raw] of Object.entries(dayRaws)) {
    let day; try { day = C.parse(C.rowsFrom({ table: unwrap(raw) })); } catch { continue; }
    const grouped = (day.rehearsals || []).some(r => r[6]);      // has a Group-lettered rehearsal block
    if (!grouped) { out.push(`--    ${tab}: no group rehearsals (off-day / concert-only) — skipped`); continue; }
    played++;
    const wk = /week\s+two/i.test(day.eyebrow) ? 2 : 1, other = wk === 2 ? 1 : 2;
    let total = 0, falsePos = 0;
    for (const p of people) {
      const u = ctx.get(p.name); if (!u) continue;
      const mine = C.mineOf(day, u); total += mine.length;
      if (mine.length > (u.mine || []).filter(x => x.week !== other).length) falsePos++;
    }
    ok(total > 0 && falsePos === 0, `${tab} (wk${wk}): personalizes ${total} matches, ${falsePos} over-claims`);
  }
  ok(played >= 8, `swept ${Object.keys(dayRaws).length} tabs, ${played} rehearsal days checked`);

  out.forEach(l => console.log(l));
  console.log(`\n${pass}/${out.filter(l => !l.startsWith("--")).length}`);
  process.exit(pass === out.filter(l => !l.startsWith("--")).length ? 0 : 1);
})();
