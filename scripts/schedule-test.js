// Live smoke test for the schedule's personalization.  Run from repo root:  node scripts/schedule-test.js
//
// archive/parser-test.js proves the parse/match *logic*, but only against frozen synthetic fixtures —
// it can't see the *live sheets* drifting from what userCtx()/mineOf() expect. That blind spot is
// exactly how a roster "Pieces" reformat once silently blanked every user's schedule. This pulls the
// real roster + repertoire + a week-1 and a week-2 grid and asserts the schedule still personalizes
// (mineOf isn't empty, and nobody claims more pieces than they play).
//
// Network-gated: the sheets are public (view-only gviz, no auth), so any environment with outbound
// HTTPS works — but if they're unreachable (offline / locked-down sandbox) it SKIPS (exit 0), never
// red-fails. Roster data is PII, so there are deliberately no committed fixtures to fall back to.
const C = require("../app.js");
const https = require("https");
const RSID = "1j__RMUvFWQlX9UuT-Uxkw7BkqWHCQkbR_hKsTyNwiyo";   // roster + repertoire tabs
const SSID = "1AvNjAUQMFPjJAlwY4Day2MgHt5-2Vd8EDocpdxJQ6_A";   // the schedule
const DAYS = { "week 1 · Tue 6/30": "Tue 6/30", "week 2 · Mon 7/6": "Mon 7/6" };

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

(async () => {
  let rosterRaw, repRaw, dayRaws = {};
  try {
    rosterRaw = await get(url(RSID, "gid=800090339"));
    repRaw = await get(url(RSID, "gid=244347893"));
    for (const [label, tab] of Object.entries(DAYS)) dayRaws[label] = await get(url(SSID, "sheet=" + encodeURIComponent(tab)));
  } catch (e) {
    console.log("skipped — sheets unreachable (" + e.message + ")"); process.exit(0);
  }

  const rt = unwrap(rosterRaw), rr = cells(rt), { h: rh, s: rs } = header(rt, rr), gi = k => rh.indexOf(k);
  const people = rr.slice(rs).filter(r => r[gi("name")]).map(r => ({
    name: r[gi("name")], type: r[gi("type")], instrument: r[gi("instrument")],
    pieces: r[gi("pieces")], notes: r[gi("notes")], hotel: r[gi("hotel")] }));
  const pt = unwrap(repRaw), pr = cells(pt), { h: ph, s: ps } = header(pt, pr);
  const pi = ph.indexOf("piece"), g1 = ph.findIndex(x => x.includes("w1")), g2 = ph.findIndex(x => x.includes("w2")), PG = {};
  for (const r of pr.slice(ps)) { const pc = (r[pi] || "").replace(/\s*\((?:W1|W2)\)\s*$/i, "").trim();
    if (pc) PG[C.norm(pc)] = { 1: (g1 >= 0 ? r[g1] : "") || "", 2: (g2 >= 0 ? r[g2] : "") || "" }; }

  let pass = 0; const out = [];
  const ok = (cond, label) => { out.push((cond ? "ok  " : "FAIL") + "  " + label); pass += cond ? 1 : 0; };
  ok(people.length > 40, `roster pulled (${people.length} people)`);
  ok(Object.keys(PG).length > 30, `repertoire pulled (${Object.keys(PG).length} pieces mapped to groups)`);

  for (const [label, raw] of Object.entries(dayRaws)) {
    const day = C.parse(C.rowsFrom({ table: unwrap(raw) }));
    if (!day.rehearsals.length) { ok(false, `${label}: grid parsed (no rehearsals — tab missing/empty?)`); continue; }
    const wk = /week\s+two/i.test(day.eyebrow) ? 2 : 1, other = wk === 2 ? 1 : 2;
    let total = 0, falsePos = 0;
    for (const p of people) {
      const u = C.userCtx(people, p.name, PG); if (!u) continue;
      const mine = C.mineOf(day, u); total += mine.length;
      if (mine.length > (u.mine || []).filter(x => x.week !== other).length) falsePos++;   // more matches than pieces this week
    }
    ok(total > 20, `${label}: schedule personalizes (${total} rehearsal-matches — 0 would mean it went blank)`);
    ok(falsePos === 0, `${label}: no user over-claims (${falsePos})`);
  }

  out.forEach(l => console.log(l));
  console.log(`\n${pass}/${out.length}`);
  process.exit(pass === out.length ? 0 : 1);
})();
