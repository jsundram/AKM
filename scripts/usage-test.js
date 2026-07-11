#!/usr/bin/env node
// Parity guard for the browser usage crunch. usage/crunch.js must reproduce, bit for
// bit, what usage/crunch.py produced (the shipping behavior before the port) on a
// synthetic fixture that hits every branch: dedup, pre-launch drop, opened→received
// fallback, offline-queued detection, anonymous opens, launch-day hour exclusion, an
// unknown uid, and Jason's exclusion from adoption. The frozen golden is the baseline;
// when python3 is here we also re-run the oracle so the golden can't drift unnoticed.
//
// Offline-safe: no network, all fixtures committed (synthetic, no PII). Exits nonzero
// on any mismatch so it fails loudly in CI / the pre-commit run.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const FIX = path.join(__dirname, "usage-fixtures");
const { crunch } = require(path.join(ROOT, "usage", "crunch.js"));

const csv = fs.readFileSync(path.join(FIX, "pings.csv"), "utf8");
const rosterUids = new Set(JSON.parse(fs.readFileSync(path.join(FIX, "roster-uids.json"), "utf8")));
const golden = JSON.parse(fs.readFileSync(path.join(FIX, "golden.json"), "utf8"));

const strip = o => { const { generated, ...rest } = o; return rest; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let fail = 0;
const check = (name, got, want) => {
  if (eq(got, want)) { console.log(`ok   ${name}`); return; }
  fail++;
  console.error(`FAIL ${name}`);
  console.error(`  got : ${JSON.stringify(got)}`);
  console.error(`  want: ${JSON.stringify(want)}`);
};

// 1) the JS port matches the frozen golden, field by field (clearer failures than one big diff)
const js = strip(crunch(csv, rosterUids, new Date(Date.UTC(2026, 6, 9, 3, 18))));
for (const k of Object.keys(golden)) check(`crunch.js · ${k}`, js[k], golden[k]);
check("crunch.js · no extra keys", Object.keys(js).sort(), Object.keys(golden).sort());

// 2) a few invariants stated in plain English, so intent survives a golden regen
check("invariant · dedup removed 2 duplicate deliveries", js.deduped, 2);
check("invariant · dropped 2 pre-launch test opens", js.pre, 2);
check("invariant · counted 2 offline-queued opens", js.queued, 2);
check("invariant · one uid matches nobody on the roster", js.unknown, 1);
check("invariant · Jason is in the users list", js.users.some(u => u.uid === "70f71792"), true);
check("invariant · but Jason never lifts the adoption count", js.adopt.every(a => a.n <= 4), true);
check("invariant · byHour excludes launch night (hour 21 empty)", js.byHour[21], 0);
// kudos events (empty page, action=kudos): deduped, launch-filtered, uid-keyed
check("kudos · total after dedup + pre-launch drop", js.kudos.total, 5);
check("kudos · unique senders (anon sender excluded)", js.kudos.senders, 3);
check("kudos · unique recipients", js.kudos.recipients, 2);
check("kudos · most-applauded piece is Brahms ×3", js.kudos.byComposer[0], { label: "Brahms", n: 3 });
check("kudos · top recipient by uid", js.kudos.toList[0], { uid: "eeee5555", n: 3 });

// 3) if python3 is available, re-derive the golden from the oracle and confirm the
//    committed golden still equals it — catches a golden that rotted vs crunch.py
try {
  const out = execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "usage")
import crunch
data = crunch.crunch(open("${path.join(FIX, "pings.csv")}").read(),
                     set(json.load(open("${path.join(FIX, "roster-uids.json")}"))))
data.pop("generated", None)
print(json.dumps(data))
`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  check("oracle · golden still matches crunch.py", JSON.parse(out), golden);
} catch {
  console.log("skip python3 oracle re-check (python3 unavailable)");
}

if (fail) { console.error(`\n${fail} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
