// Pins the shared printed-name → roster matcher (concert-data.js) — the rules that decide which
// concert names get a kudos link (concerts.html) and whose card turns brass (app.js). Offline +
// synthetic, runs anywhere:  node scripts/concert-match-test.js
//
// Every roster-side name here already appears in the public programs (concert-data.js), so no PII
// lands in the repo — the fixture instruments mirror the live sheet's abbreviations.
require("../roster-data.js");                     // instKind → globalThis.Roster
require("../concert-data.js");                    // matcher  → globalThis.Concerts
const A = require("../app.js");                   // myConcertPieces (uses both)

const R = [                                       // roster spellings ≠ printed spellings, on purpose
  {name:"Steve Buck",         instrument:"Piano"},   // programs print "Stephen Buck"
  {name:"Max Buck",           instrument:"VC"},
  {name:"Stephen Lustig",     instrument:"V1"},
  {name:"Stephanie Wingfield",instrument:"VC"},
  {name:"Tanya Bannister",    instrument:"Piano"},
  {name:"Tanya Jenkin",       instrument:"V4"},
  {name:"Robert Dembo",       instrument:"Clar"},
  {name:"Preet Saund",        instrument:"VC"},      // programs print "Preetcharn Saund"
  {name:"Aafke Koffeman",     instrument:"V"},
  {name:"Jesús Morales",      instrument:"VC"},
];
const find = Concerts.matcher(R);

let pass = 0, fail = 0;
const ok = (label, got) => { console.log(`${got ? "ok   " : "FAIL "} ${label}`); got ? pass++ : fail++; };
const is = (label, hit, want) => ok(label, (hit ? hit.name : null) === want);

// exact full names (incl. diacritic wobble) resolve to themselves — never a namesake
is("exact: Stephen Lustig → Stephen Lustig",  find("Stephen Lustig","vn"), "Stephen Lustig");
is("exact: Tanya Jenkin → Tanya Jenkin",      find("Tanya Jenkin","vn"),   "Tanya Jenkin");
is("accent wobble: Jesus Morales → Jesús",    find("Jesus Morales","vc"),  "Jesús Morales");
// surname-anchored first-name wobbles (the director + Preet)
is("Stephen Buck → Steve Buck (DIR)",         find("Stephen Buck","pf"),   "Steve Buck");
is("Preetcharn Saund → Preet Saund",          find("Preetcharn Saund","vc"), "Preet Saund");
is("surname wobble: Aafke Koffemann → Koffeman", find("Aafke Koffemann","vn"), "Aafke Koffeman");
// a guest full name with no roster surname stays unmatched — Robert the clarinetist is safe
is("guest: Robert Lexer (flugelhorn) → nobody", find("Robert Lexer","flugelhorn"), null);
is("Robert Dembo (cl) still himself",         find("Robert Dembo","cl"),   "Robert Dembo");
// bare first names: ambiguity never guesses; a unique prefix + instrument does
is("bare ambiguous: Tanya → nobody",          find("Tanya","vn"),          null);
is("bare prefix + inst: Steph (vc) → Stephanie", find("Steph","vc"),       "Stephanie Wingfield");
is("bare wrong inst: Robert (bass) → nobody", find("Robert","bass"),       null);

// myConcertPieces uses the same matcher: the brass card follows the resolved person, not the
// first name — the Stephen/Tanya namesakes were each getting the other's "you're performing".
globalThis.Roster = Object.assign(Object.create(globalThis.Roster), { cached: () => R });
const conc = { pieces: [
  {c:"Kühr", t:"Portraits",   who:[["Jesús Morales","vc"],["Stephen Buck","pf"]]},
  {c:"Brahms", t:"Qt. No. 3", who:[["Nathan Meltzer","vn"],["Stephen Lustig","vn"]]},
]};
const mine = u => A.myConcertPieces(conc, u).map(p => p.t).join("|");
ok("brass: Steve Buck owns the Kühr",          mine({name:"Steve Buck"})     === "Portraits");
ok("brass: Stephen Lustig owns the Brahms only", mine({name:"Stephen Lustig"}) === "Qt. No. 3");
ok("brass: Tanya Bannister claims nothing here", mine({name:"Tanya Bannister"}) === "");

console.log(`\n${pass}/${pass+fail}`);
process.exit(fail ? 1 : 0);
