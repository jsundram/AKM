// Parser unit test. Run from repo root:  node archive/parser-test.js
// Exercises the ported parser against the real Tuesday grid structure.
const { parse, rowsFrom, evblocks } = require("../app.js");
const R = (...vals) => ({ c: vals.map(v => v === null ? null : { v: String(v) }) });
const N = null;

const gv = { table: { rows: [
  R(N, "T U E S D A Y  J U N E   3 0     |     W E E K   O N E"),
  R(N, "9:00 - 9:30", "New Participant Tour\nMeet Matt at the fountain. All welcome!"),
  R(N, "9:30 - 10:20", "Full Festival Informational Meeting\n(Lesachtalerhof Terrace)"),
  R(N, N, "A1", "A2", "AH", "KS", "BAND\nROOM", "THEATRE", "CHAPEL", "WERNER"),
  // Group B carries someone else's private-lessons block (no Jason) — must NOT surface
  R(N, "9:00 - 10:15\nGroup B", "Schubert Cello Quintet\nYoanna - P", "Grieg Quartet\nClaudia - C", "Prokofiev Quintet\nEmi - P", "Casarrubios Piano Trio\nSteve - C", "Schubert Piano Trio\nTanya - C", "Schumann Piano Trio\nNathan - P", "Shostakovich Quartet no. 9\nGijs - C", "Dvorak Quartet\nYoojin - C", "Claudia\nPrivate Lessons\n9:00 - Korn\n9:30 - Chia"),
  // Group C: Jason's block is shoved into the WERNER column (no LESSONS column here) — must surface his
  // 10:55 (not Maya's 10:25) and report WERNER as the room he reports to
  R(N, "10:25 - 11:40\nGroup C", "Beethoven String Trio\nIlinca - P", "Korngold Suite\nYoanna - P", "Mozart Clarinet Quintet\nJesus - P", "Faure Piano Quartet\nClaudia - P", "Schumann Piano Quartet\nSteve - C", "Ravel Piano Trio\nJames - P", "Jacob Oboe Quartet\nChad - C", "Jesus\nPrivate Lessons\n10:25 - Maya\n10:55 - Jason"),
  R(N, "1 3 : 0 0 - 1 4 : 3 0\nL U N C H @ Mascha Wirt"),
  R(N, N, "A1", "A2", "AH", "KS", "BAND ROOM", "THEATRE", "CHAPEL", "WERNER"),
  R(N, "14:30 - 15:45\nGroup E", "Beethoven Piano Trio\nJesus - P", "Brahms Clarinet Quintet\nChad/Ilinca - P", "Dvorak Piano Quintet\nJames - P", "Bruch Octet\nGijs/Nathan - P", "Loeffler Two Rhapsodies\nTanya - C", "Reinecke Trio", "Debussy Quartet\nClaudia - P"),
  R(N, "17:20 - 19:00\nPractice Block / Free Reading", N, N, "Faculty Rehearsal\nWebern Langsamer Satz", "Faculty Rehearsal\nFaure Piano Quartet"),
  R(N, "1 9 : 0 0\nD I N N E R @ Lesachtalerhof"),
  R(N, "20:00\nPractice Block / Free Reading", N, N, N, N, N, "Closed"),
  // a headline evening event: faculty concert banner in the label column, no room grid — must surface
  R(N, "2 0 : 0 0\nF A C U L T Y   C O N C E R T @ Kultursaal"),
] } };

const day = parse(rowsFrom(gv));
const blocks = evblocks(day);   // [17:20 faculty rehearsals, 20:00 reading w/ THEATRE closed]
const checks = [
  ["eyebrow Week One", day.eyebrow === "Week One"],
  ["3 rehearsals", day.mine.length === 3],
  ["chronological order", day.mine.map(e => e[2]).join(",") === "Dvorak Quartet,Faure Piano Quartet,Bruch Octet"],
  ["rooms WERNER/KS/KS", day.mine.map(e => e[3]).join(",") === "WERNER,KS,KS"],
  ["Dvorak Piano Quintet excluded", !day.mine.some(e => e[2] === "Dvorak Piano Quintet")],
  ["lunch venue intact", day.meals.some(m => m[2] === "Lunch" && m[3] === "Mascha Wirt")],
  ["dinner venue", day.meals.some(m => m[2] === "Dinner" && m[3] === "Lesachtalerhof")],
  ["evening Webern + Faure faculty", day.evening.filter(e => e[4] === "faculty").length === 2],
  ["morning all-hands above grid", day.allhands.filter(e => /Meeting|Tour/.test(e[2])).length === 2],
  ["all-hands times chronological", day.allhands.map(e => e[0]).join(",") === "9:00,9:30,20:00"],
  ["faculty concert banner surfaces", day.allhands.some(e => e[0] === "20:00" && e[2] === "FACULTY CONCERT" && e[3] === "Kultursaal")],
  ["only his private lesson surfaces", day.lessons.length === 1],
  ["lesson 10:55–11:25 with Jesus in WERNER", day.lessons[0].join("|") === "10:55|11:25|Jesus|WERNER"],
  ["two evening blocks split out", blocks.length === 2],
  ["post-dinner free rooms (all but closed THEATRE)", blocks[1].free.join(",") === "A1,A2,AH,KS,BAND ROOM,CHAPEL,WERNER"],
  ["closed room flagged, not free", blocks[1].closed.join(",") === "THEATRE" && !blocks[1].free.includes("THEATRE")],
  ["faculty-booked rooms excluded from free", !blocks[0].free.includes("AH") && !blocks[0].free.includes("KS")],
];
let pass = 0;
for (const [n, r] of checks) { console.log((r ? "PASS" : "FAIL") + "  " + n); pass += r ? 1 : 0; }
console.log(`\n${pass}/${checks.length}`);
process.exit(pass === checks.length ? 0 : 1);
