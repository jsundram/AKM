// Live smoke test for dress-rehearsal personalization — both the (KS) student dress and the faculty
// dress (a Faculty Concert's run-through).  Run from repo root:  node scripts/dress-test.js
//
// The bugs this guards were BOTH live-data problems the offline harness (archive/parser-test.js) can't
// see: the schedule sheet, the concert program (concert-data.js), and the repertoire tab name the same
// piece three different ways, and dressOf must reconcile them. A 7/10 slot mislabelled "Beethoven Piano
// Trio" mis-resolved to a trio that had already played (a phantom card); a "Haydn String Quartet" slot
// tied two Haydns in the old whole-repertoire matcher and silently dropped the card.
//
// dressOf's authority is the **date-scoped concert program**: a dress rehearsal is the run-through for
// that day's concert, so the slot means whichever program piece it composer-matches (the date pins the
// week, so a Wk-1 Haydn can't be confused for the Wk-2 one). This test judges dressOf against exactly
// that authority — for every concert piece on a dress day, the people dressOf hands a "Dress rehearsal"
// card must be exactly the piece's printed cast (via the shared Concerts.matcher):
//   · a cast member who gets NO card → a dropped/misrouted slot (the Haydn class)
//   · a card for someone NOT in the cast → a false card (the Beethoven class)
// Cards are linked to pieces by the short title dressOf emits (p.s), so the sloppy slot text never enters
// the ground-truth chain — the mistake that made an earlier draft of this test reproduce the very bug.
//
// It also cross-checks the **repertoire tab** (Group · Piece · Player 1…8 — the personnel ground truth)
// WEEK-AWARE: every printed cast member should have a repertoire assignment by that composer for the
// concert's week. A miss is a likely who-list typo in concert-data.js — the one failure mode no
// program-only check can see (there's no other source for "who's really on stage"). It's a WARN, not a
// FAIL: the repertoire is a looser, cross-week superset, so only a *composer-level* gap is high-signal.
//
// Network-gated like schedule-test.js / network-test.js: public gviz (no auth), so any box with outbound
// HTTPS runs it — unreachable sheets (offline / locked-down sandbox) → SKIP (exit 0), never a red fail.
// Roster/repertoire are PII, so there are deliberately no committed fixtures to fall back to.
require("../roster-data.js");                      // globalThis.Roster (derive) — the repertoire join
require("../concert-data.js");                     // globalThis.Concerts — the program dressOf resolves against
const C = require("../app.js");
const RD = require("../roster-data.js");
const https = require("https");
const RSID = "1j__RMUvFWQlX9UuT-Uxkw7BkqWHCQkbR_hKsTyNwiyo";   // roster + repertoire tabs
const SSID = "1AvNjAUQMFPjJAlwY4Day2MgHt5-2Vd8EDocpdxJQ6_A";   // the schedule
const FEST = ["2026-06-29", "2026-07-12"];

const get = u => new Promise((res, rej) =>
  https.get(u, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(d)); }).on("error", rej));
const url = (sid, q) => `https://docs.google.com/spreadsheets/d/${sid}/gviz/tq?tqx=out:json&${q}`;
const unwrap = t => JSON.parse(t.slice(t.indexOf("(") + 1, t.lastIndexOf(")"))).table;
const cells = t => (t.rows || []).map(r => (r.c || []).map(c => c ? String(c.v ?? c.f ?? "").trim() : ""));
function header(t, rows) {
  let h = (t.cols || []).map(c => (c.label || "").toLowerCase()), s = 0;
  if (!h.includes("name") && !h.includes("piece")) {
    const i = rows.findIndex(r => r.some(x => /^(name|piece)$/i.test(x))); h = (rows[i] || []).map(x => x.toLowerCase()); s = i + 1;
  }
  return { h, s };
}
function festTabs() {
  const out = [], d = new Date(FEST[0] + "T12:00:00"), end = new Date(FEST[1] + "T12:00:00");
  for (; d <= end; d.setDate(d.getDate() + 1))
    out.push({ tab: d.toLocaleDateString("en-US", { weekday: "short" }) + " " + (d.getMonth() + 1) + "/" + d.getDate(),
               date: d.toISOString().slice(0, 10) });
  return out;
}

(async () => {
  let rosterRaw, repRaw;
  try {
    rosterRaw = await get(url(RSID, "gid=800090339"));
    repRaw = await get(url(RSID, "gid=244347893"));
  } catch (e) { console.log("skipped — sheets unreachable (" + e.message + ")"); process.exit(0); }

  const rt = unwrap(rosterRaw), rr = cells(rt), { h: rh, s: rs } = header(rt, rr), gi = k => rh.indexOf(k);
  let people = rr.slice(rs).filter(r => r[gi("name")]).map(r => ({
    name: r[gi("name")], type: r[gi("type")], instrument: r[gi("instrument")],
    pieces: "", notes: r[gi("notes")], hotel: r[gi("hotel")] }));
  const D = RD.derive(people, cells(unwrap(repRaw)));
  people = people.map(p => ({ ...p, pieces: D.byPerson[p.name] || "" }));
  globalThis.Roster.cached = () => people;         // prime the shared matcher (localStorage is empty in Node)
  const match = globalThis.Concerts.matcher(people);
  const ctx = new Map(people.map(p => [p.name, C.userCtx(people, p.name)]));

  // repertoire ground truth, week-aware: name → { all title tokens a person plays in W1, in W2 }.
  // Full token set (not just the leading word) so a program surname ("Beach", "Coleridge-Taylor") still
  // matches a repertoire title that leads with a first name ("Amy Beach") or hyphenates across tokens.
  const repTok = {};                               // name → { 1:Set(token), 2:Set(token) }
  for (const p of people) {
    const w = repTok[p.name] = { 1: new Set(), 2: new Set() };
    (D.byPerson[p.name] || "").split("|").forEach(s => {
      const m = s.match(/\((W1|W2)\)\s*$/i), base = s.replace(/\s*\((W1|W2)\)\s*$/i, "").trim();
      const ts = C.words(base); if (!ts.length) return;
      if (!m || /w1/i.test(m[1])) ts.forEach(t => w[1].add(t));
      if (!m || /w2/i.test(m[1])) ts.forEach(t => w[2].add(t));
    });
  }
  const playsComposer = (name, Pc, wk) => { const t = repTok[name]; return !t || C.words(Pc).every(x => t[wk].has(x)); };   // no repertoire row → don't guess (faculty/guests aren't in the tab)

  const days = {};
  for (const { tab, date } of festTabs()) { try { days[date] = C.parse(C.rowsFrom({ table: unwrap(await get(url(SSID, "sheet=" + encodeURIComponent(tab)))) })); } catch {} }

  const out = [], warns = []; let pass = 0, dressDays = 0, slotsSeen = 0, cardsSeen = 0, facDays = 0;
  const ok = (cond, label) => { out.push((cond ? "ok  " : "FAIL") + "  " + label); pass += cond ? 1 : 0; return cond; };
  const cast = P => new Set((P.who || []).map(([w, i]) => (match(w, i) || { name: w }).name));
  const castRoster = P => new Set((P.who || []).map(([w, i]) => match(w, i)).filter(Boolean).map(x => x.name));   // only roster-resolvable performers can get a personalized card (guests/choir/flugelhorn stay off)

  for (const [date, day] of Object.entries(days)) {
    const wk = /week\s+two/i.test(day.eyebrow) ? 2 : 1;
    const cps = globalThis.Concerts.all.filter(c => c.id.startsWith(date)).flatMap(c => (c.pieces || []).filter(p => !p.brk));

    // faculty dress (a Faculty Concert's run-through, inline in day.evening/day.fac) — surfaced per-performer
    // by facDressOf against the SAME program, so the same cast==cards guard applies, scoped to the pieces the
    // day's faculty-dress slots actually cover (a composer/nick token shared with a slot).
    const facSlots = C.facDressSlots(day);
    if (facSlots.length) {
      facDays++;
      const gotF = {};
      for (const p of people) for (const d of C.facDressOf(day, ctx.get(p.name), date)) (gotF[d[2]] || (gotF[d[2]] = new Set())).add(p.name);
      const dressed = cps.filter(P => facSlots.some(([, , title]) => {
        const st = new Set(C.words(title));
        return [...C.words(P.c), ...C.words(P.nick || "")].some(t => st.has(t));
      }));
      let fdrop = 0, ffalse = 0;
      for (const P of dressed) {
        const want = castRoster(P), got = gotF[P.s] || new Set();   // guests can't get a personalized card, so judge against the roster-resolvable cast
        for (const n of want) if (!got.has(n)) { fdrop++; warns.push(`${date} facdress "${P.s}": ${n} is in the printed cast but got NO dress card`); }
        for (const n of got) if (!want.has(n)) { ffalse++; warns.push(`${date} facdress "${P.s}": ${n} got a dress card but isn't in the printed cast`); }
      }
      ok(fdrop === 0, `${date} (wk${wk}): faculty dress — every covered piece's printed cast gets a card (${fdrop} dropped)`);
      ok(ffalse === 0, `${date} (wk${wk}): faculty dress — no card goes to a non-cast member (${ffalse} false)`);
    }

    const slots = day.dress || []; if (!slots.length) continue;
    dressDays++; slotsSeen += slots.length;
    // every user's dress cards once, indexed by the short title dressOf emits
    const gotByTitle = {};                         // p.s → Set(names who got that dress card)
    for (const p of people) for (const d of C.dressOf(day, ctx.get(p.name), date)) { cardsSeen++; (gotByTitle[d[2]] || (gotByTitle[d[2]] = new Set())).add(p.name); }

    let dropped = 0, falsecard = 0;
    for (const P of cps) {
      const want = cast(P), got = gotByTitle[P.s] || new Set();
      for (const n of want) if (!got.has(n)) { dropped++; warns.push(`${date} "${P.s}": ${n} is in the printed cast but got NO dress card`); }
      for (const n of got) if (!want.has(n)) { falsecard++; warns.push(`${date} "${P.s}": ${n} got a dress card but isn't in the printed cast`); }
      // repertoire cross-check (WARN): a printed performer with no week-`wk` repertoire piece by this composer.
      // If the WHOLE cast lacks it, the piece is just absent from the repertoire tab (a gap, not a typo) —
      // report that once; a lone missing performer is the higher-signal "wrong name on the who-list".
      const missing = [...want].filter(n => repTok[n] && !playsComposer(n, P.c, wk));
      if (missing.length && missing.length === want.size) warns.push(`~ ${date} "${P.s}": no ${P.c} in the Wk-${wk} repertoire for any of its cast — piece likely not in the repertoire tab`);
      else missing.forEach(n => warns.push(`~ ${date} "${P.s}": ${n} is credited but plays no ${P.c} in the Wk-${wk} repertoire — check the who-list`));
    }
    ok(dropped === 0, `${date} (wk${wk}): every printed cast member of every program piece gets their dress card (${dropped} dropped)`);
    ok(falsecard === 0, `${date} (wk${wk}): no dress card goes to a non-cast member (${falsecard} false)`);
    // unexplained slots: a dress slot whose composer isn't on the day's program at all
    for (const [s, , title] of slots) if (!cps.some(p => C.words(p.c).every(t => C.words(title).includes(t))))
      warns.push(`~ ${date} ${s} "${title}": no program piece by this composer — unexplained dress slot`);
  }
  ok(dressDays >= 1, `swept ${Object.keys(days).length} tabs, ${dressDays} dress days (${slotsSeen} slots, ${cardsSeen} cards) checked`);
  ok(facDays >= 1, `faculty dress checked on ${facDays} day(s)`);

  out.forEach(l => console.log(l));
  const fails = warns.filter(w => !w.startsWith("~")), soft = warns.filter(w => w.startsWith("~"));
  if (fails.length) { console.log("\n--- cast/card mismatches (these failed an assertion) ---"); fails.forEach(w => console.log("  " + w)); }
  if (soft.length) { console.log("\n--- soft warnings (review, not a failure) ---"); soft.forEach(w => console.log("  " + w)); }
  console.log(`\n${pass}/${out.length}`);
  process.exit(pass === out.length ? 0 : 1);
})();
