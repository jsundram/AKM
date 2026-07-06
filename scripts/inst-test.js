// Offline unit test for the shared instrument classifier.  Run:  node scripts/inst-test.js
//
// roster.html, app.js (lesson-family matching) and network.js all derive their instrument
// handling from one function — Roster.instKind (roster-data.js). They used to be three separate
// prefix-ladders that drifted apart (a "Cello" showed as Clarinet on the roster because only that
// copy lacked the "ce" branch). This pins instKind, and checks network's Winds grouping downstream,
// so the three can't silently diverge again. Pure logic — no network, runs anywhere.
const R = require("../roster-data.js");
const N = require("../network.js");

let pass = 0, fail = 0;
const eq = (got, exp, label) => { const ok = got === exp; console.log((ok ? "ok  " : "FAIL") + "  " + label + (ok ? "" : `  → got ${JSON.stringify(got)}, want ${JSON.stringify(exp)}`)); ok ? pass++ : fail++; };

// abbreviations AND full names resolve to the same canonical kind; unknown → "" (never a wrong guess)
[
  ["VC", "vc"], ["Cello", "vc"], ["cello", "vc"], ["Violoncello", "vc"], ["Vlc", "vc"],
  ["VA", "va"], ["VA1", "va"], ["Viola", "va"], ["Vla", "va"],
  ["V", "v"], ["V1", "v"], ["V4", "v"], ["Violin", "v"], ["Vln", "v"],
  ["V/VA", "v/va"],
  ["Bass", "bass"], ["B", "bass"], ["Contrabass", "bass"], ["Double Bass", "bass"], ["CB", "bass"],
  ["Piano", "piano"], ["P", "piano"],
  ["Clarinet", "clarinet"], ["Clar", "clarinet"], ["Cl", "clarinet"],
  ["Oboe", "oboe"], ["Ob", "oboe"],
  ["", ""], ["Kazoo", ""], ["C", ""],                   // unknown/blank → "", not a mislabel
].forEach(([raw, kind]) => eq(R.instKind(raw), kind, `instKind(${JSON.stringify(raw)})`));

// the exact regression: "Cello" must not read as a wind
eq(R.instKind("Cello") === "clarinet", false, `"Cello" is not clarinet (the reported bug)`);

// network folds clarinet + oboe into "Winds"; strings/piano keep their own label
eq(N.instLabel("Cello"), "VC", `network "Cello" → VC`);
eq(N.instLabel("Viola"), "VA", `network "Viola" → VA`);
eq(N.instLabel("Clarinet"), "Winds", `network "Clarinet" → Winds`);
eq(N.instLabel("Oboe"), "Winds", `network "Oboe" → Winds`);

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
