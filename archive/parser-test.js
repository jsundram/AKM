// Parser unit test. Run from repo root:  node archive/parser-test.js
// Exercises the ported parser against the real Tuesday grid structure. parse() is user-agnostic;
// whose day it is comes from userCtx (roster row) + mineOf/lessonsOf, exercised here as Jason.
require("../roster-data.js");   // defines globalThis.Roster; app.js fams() now derives from Roster.instKind
const { parse, rowsFrom, evblocks, userCtx, mineOf, lessonsOf, coachingOf, freeOf } = require("../app.js");
const R = (...vals) => ({ c: vals.map(v => v === null ? null : { v: String(v) }) });
const N = null;

const gv = { table: { rows: [
  R(N, "T U E S D A Y  J U N E   3 0     |     W E E K   O N E"),
  R(N, "9:00 - 9:30", "New Participant Tour\nMeet Matt at the fountain. All welcome!"),
  R(N, "9:30 - 10:20", "Full Festival Informational Meeting\n(Lesachtalerhof Terrace)"),
  R(N, N, "A1", "A2", "AH", "KS", "BAND\nROOM", "THEATRE", "CHAPEL", "WERNER", "A4"),
  // Group B carries someone else's private-lessons block (no Jason) — must NOT surface
  // Group B also holds two same-composer quintets of DIFFERENT families: "Schubert Cello Quintet"
  // (the D.956 string quintet) and "Schubert Piano Quintet" (D.667). The grid's informal "Cello" vs
  // the canonical "String" makes both cells tie on {schubert,quintet} — the argmax must lean on fits()
  // so each player gets only their own quintet (wk-2 2026-07 parked both in one Group D and dropped both).
  R(N, "9:00 - 10:15\nGroup B", "Schubert Cello Quintet\nYoanna - P", "Grieg Quartet\nClaudia - C", "Prokofiev Quintet\nEmi - P\nChad - C", "Casarrubios Piano Trio\nSteve - C", "Schubert Piano Trio\nTanya - C", "Schumann Piano Trio\nNathan - P", "Shostakovich Quartet no. 9\nGijs - C", "Dvorak Quartet\nYoojin - C", "Schubert Piano Quintet\nMira - P", "Claudia\nPrivate Lessons\n9:00 - Korn\n9:30 - Chia\n10:00 - Steph"),
  // the sheet's live curveball: a new room (A4) appears in the header, a faculty rehearsal is
  // parked in a room column mid-day, and the cell mixes a coach line with an "in A4" note
  R(N, "11:50 - 12:40\nGroup A", "Faculty Rehearsal\nSchumann Marchenerzahlungen", N, N, N, N, "Faculty Rehearsal\nRavel Duo", N, N, "Elgar Piano Quintet\nGijs - P (half)\nin A4"),
  // Group C: Jason's block is shoved into the WERNER column (no LESSONS column here) — must surface his
  // 10:55 (not Maya's 10:25) and report WERNER as the room he reports to
  R(N, "10:25 - 11:40\nGroup C", "Beethoven String Trio\nIlinca - P", "Korngold Suite\nYoanna - P", "Mozart Clarinet Quintet\nJesus - P", "Faure Piano Quartet\nClaudia - P", "Schumann Piano Quartet\nSteve - C", "Ravel Piano Trio\nJames - P", "Jacob Oboe Quartet\nChad - C", "Jesus\nPrivate Lessons\n10:25 - Maya\n10:55 - Jason\n11:25 - Steph"),
  R(N, "1 3 : 0 0 - 1 4 : 3 0\nL U N C H @ Mascha Wirt"),
  R(N, N, "A1", "A2", "AH", "KS", "BAND ROOM", "THEATRE", "CHAPEL", "WERNER"),
  R(N, "14:30 - 15:45\nGroup E", "Beethoven Piano Trio\nJesus - P", "Brahms Clarinet Quintet\nChad/Ilinca - P", "Dvorak Piano Quintet\nJames - P", "Bruch Octet\nGijs/Nathan - P", "Loeffler Two Rhapsodies\nTanya - C", "Reinecke Trio", "Debussy Quartet\nClaudia - P"),
  R(N, "17:20 - 19:00\nPractice Block / Free Reading", N, N, "Faculty Rehearsal\nWebern Langsamer Satz", "Faculty Rehearsal\nFaure Piano Quartet"),
  R(N, "1 9 : 0 0\nD I N N E R @ Lesachtalerhof"),
  R(N, "2 0 : 0 0\nF A C U L T Y   C O N C E R T @ Kultursaal"),
  R(N, "20:00\nPractice Block / Free Reading", N, N, N, N, N, "Closed"),
] } };

const roster = [
  { name: "Jason Sundram", type: "", hotel: "Musikhof Lexer", notes: "",
    pieces: "BCE: Dvorak String Quartet no. 14 in Ab major, op. 105 | Faure Piano Quartet no. 1 in C minor, op. 15 | Bruch String Octet in Bb major, op. posth" },
  { name: "Felicia Weiss", type: "", hotel: "Lesachtalerhof", notes: "",
    pieces: "BC: Schumann Piano Trio no. 2 in F major, op. 80 | Korngold Suite, op. 23, I & IV" },
  { name: "Claire Maugham", type: "", hotel: "Haus Anita", notes: "",
    pieces: "B: Andrea Casarrubios: luzAzul" },
  // stale-letter traps (the week-2 failure mode): same composer, wrong ensemble/instrument
  { name: "Yoojin Jang", type: "F", hotel: "", notes: "",
    pieces: "E: Brahms String Sextet no. 1 in Bb major, op. 18" },
  { name: "Felix Nobody", type: "", hotel: "", notes: "",
    pieces: "E: Schumann Piano Trio no. 2 in F major, op. 80" },
  { name: "Chia-Hsuan Lin", type: "", hotel: "", notes: 'Sounds a bit like "Jay-Shen"',
    pieces: "" },
  // "Steph" fits both — the slot's coach instrument breaks the tie (Claudia V1 vs Jesus VC)
  { name: "Stephanie Wingfield", type: "", instrument: "VC", hotel: "", notes: "", pieces: "" },
  { name: "Stephen Lustig", type: "", instrument: "V1", hotel: "", notes: "", pieces: "" },
  // Claudia is week-1-only faculty ("F, W1") — her shared pieces mark those groups week-1-only
  { name: "Claudia Ajmone-Marsan", type: "F, W1", instrument: "V1", hotel: "", notes: "",
    pieces: "ACE: Bacewicz Quartet for Four Violins | Faure Piano Quartet no. 1 in C minor, op. 15 | Debussy String Quartet in G minor, op. 10" },
  { name: "Jesus Morales", type: "F", instrument: "VC", hotel: "", notes: "", pieces: "" },
  { name: "Angelina Freeman", type: "W1", instrument: "VA", hotel: "", notes: "",
    pieces: "E: Debussy String Quartet in G minor, op. 10" },
  // both live in the BAND ROOM column, whose morning header wraps ("BAND\nROOM")
  { name: "Isadora Banyai", type: "", instrument: "Piano", hotel: "", notes: "Goes by Dora",
    pieces: "E: Loeffler Two Rhapsodies for Oboe, Viola, Piano" },
  { name: "Cara Wunder", type: "", instrument: "VC", hotel: "", notes: "",
    pieces: "B: Schubert Piano Trio no. 1 in Bb major, D. 898" },
  { name: "Kian Woo", type: "", instrument: "Piano", hotel: "", notes: "",
    pieces: "A: Elgar Piano Quintet in A minor, op. 84" },
  // the two colliding quintets, one player each — the string player's canonical name says "String",
  // the grid cell says "Cello"; the piano player's is the D.667. Neither may claim the other's cell.
  { name: "Nora Vance", type: "", instrument: "VC", hotel: "", notes: "",
    pieces: "B: Schubert String Quintet in C major, D. 956" },
  { name: "Dana Poole", type: "", instrument: "Piano", hotel: "", notes: "",
    pieces: "B: Schubert Piano Quintet in A major, D. 667" },
];
const w2day = { ...parse(rowsFrom(gv)), eyebrow: "Week Two" };   // same grid, week-two masthead
const me = userCtx(roster, "Jason Sundram");
const day = parse(rowsFrom(gv));
day.mine = mineOf(day, me); day.lessons = lessonsOf(day, me);
const felicia = mineOf(day, userCtx(roster, "Felicia Weiss"));
const claire = mineOf(day, userCtx(roster, "Claire Maugham"));
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
  ["morning all-hands above grid + evening concert", day.allhands.length === 3],
  ["all-hands times chronological", day.allhands.map(e => e[0]).join(",") === "9:00,9:30,20:00"],
  ["concert parsed with venue", day.allhands.some(e => e[2] === "Faculty Concert" && e[3] === "Kultursaal")],
  ["only his private lesson surfaces", day.lessons.length === 1],
  ["lesson 10:55–11:25 with Jesus in WERNER", day.lessons[0].join("|") === "10:55|11:25|Jesus|WERNER"],
  ["two evening blocks split out", blocks.length === 2],
  ["post-dinner free rooms (all but closed THEATRE)", blocks[1].free.join(",") === "A1,A2,AH,KS,BAND ROOM,CHAPEL,WERNER,A4"],
  ["closed room flagged, not free", blocks[1].closed.join(",") === "THEATRE" && !blocks[1].free.includes("THEATRE")],
  ["faculty-booked rooms excluded from free", !blocks[0].free.includes("AH") && !blocks[0].free.includes("KS")],
  // another user's view off the same parse: similar titles in one block must not cross-match
  ["Felicia: Schumann PT (not Casarrubios PT) + Korngold", felicia.map(e => e[2]).join(",") === "Schumann Piano Trio,Korngold Suite"],
  ["Felicia: rooms THEATRE/A2", felicia.map(e => e[3]).join(",") === "THEATRE,A2"],
  // the grid's informal name for luzAzul still resolves by surname
  ["Claire: luzAzul matches 'Casarrubios Piano Trio'", claire.length === 1 && claire[0][2] === "Casarrubios Piano Trio" && claire[0][3] === "KS"],
  // stale-letter guards: group E holds "Brahms Clarinet Quintet" — a sextet player must not claim it
  // (ensemble/instrument mismatch), nor a Schumann player anything (no composer token in the block)
  ["sextet player claims nothing in group E", mineOf(day, userCtx(roster, "Yoojin Jang")).length === 0],
  ["wrong-composer player claims nothing", mineOf(day, userCtx(roster, "Felix Nobody")).length === 0],
  // colliding same-composer quintets: the fits() guard (cello≈string, piano≠string) breaks the tie
  ["D.956 string player gets the Cello Quintet, not the Piano Quintet", (m => m.length === 1 && m[0][2] === "Schubert Cello Quintet")(mineOf(day, userCtx(roster, "Nora Vance")))],
  ["D.667 piano player gets the Piano Quintet, not the Cello Quintet", (m => m.length === 1 && m[0][2] === "Schubert Piano Quintet")(mineOf(day, userCtx(roster, "Dana Poole")))],
  // lesson diminutive: the 9:30 slot says "Chia" — unambiguous prefix of Chia-Hsuan
  ["Chia-Hsuan gets the 'Chia' lesson slot", lessonsOf(day, userCtx(roster, "Chia-Hsuan Lin")).map(l => l.join("|")).join() === "9:30|10:00|Claudia|"],
  // ambiguous "Steph": the coach's instrument decides — violinist Claudia's slot is Stephen's,
  // cellist Jesus's is Stephanie's, and neither ever gets the other's
  ["'Steph' + violin coach → Stephen", lessonsOf(day, userCtx(roster, "Stephen Lustig")).map(l => l.join("|")).join() === "10:00|10:30|Claudia|"],
  ["'Steph' + cello coach → Stephanie", lessonsOf(day, userCtx(roster, "Stephanie Wingfield")).map(l => l.join("|")).join() === "11:25|11:55|Jesus|WERNER"],
  // the wrapped "BAND\nROOM" header must not drop its column (it ate Loeffler + Schubert PT)
  ["Isadora: Loeffler @ BAND ROOM", mineOf(day, userCtx(roster, "Isadora Banyai")).map(e => `${e[2]}@${e[3]}`).join() === "Loeffler Two Rhapsodies@BAND ROOM"],
  ["Cara: Schubert PT @ BAND ROOM", mineOf(day, userCtx(roster, "Cara Wunder")).some(e => e[2] === "Schubert Piano Trio" && e[3] === "BAND ROOM" && e[0] === "9:00")],
  // a double-coached cell ("Emi - P" + "Chad - C") strips clean: both names, the playing tag
  ["double coach lines strip to Emi/Chad, tag P", (r => r && r[4] === "Emi/Chad" && r[5] === "P")(day.rehearsals.find(r => r[2] === "Prokofiev Quintet"))],
  // the live curveballs of 7/3: a new room learned from the header, a mid-line coach + "in A4"
  // note stripped clean, and a daytime faculty cell that must NOT fabricate a practice block
  ["new room A4 adopted + claimed", (m => m.length === 1 && m[0][2] === "Elgar Piano Quintet" && m[0][3] === "A4" && m[0][4] === "Gijs" && m[0][5] === "P")(mineOf(day, userCtx(roster, "Kian Woo")))],
  ["daytime faculty cells → parsed but never rehearsals/blocks", day.fac.length === 2 && day.fac.some(f => f.join("|") === "11:50|12:40|Schumann Marchenerzahlungen|A1") && blocks.length === 2],
  // unscheduled blocks are called out per user: every Group slot with no conflicting rehearsal/
  // lesson/self-added event — and only on a day you're actually scheduled
  ["Jason's one free block is 11:50 (Group A)", freeOf(day, [...day.mine, ...day.lessons]).map(f => f.join("-")).join() === "11:50-12:40"],
  ["Kian free in the three blocks he doesn't play", freeOf(day, mineOf(day, userCtx(roster, "Kian Woo"))).length === 3],
  ["a self-added event fills the free block", freeOf(day, [...day.mine, ...day.lessons, ["12:00", "12:30"]]).length === 0],
  ["no schedule → no phantom free time", freeOf(day, []).length === 0],
  // week gating: W1-only Claudia shares Jason's Fauré, so that group dies after week 1;
  // a W1-annotated player gets nothing at all on a Week Two day
  ["Jason week two: Fauré gone, Dvořák+Bruch stay", mineOf(w2day, me).map(e => e[2]).join(",") === "Dvorak Quartet,Bruch Octet"],
  ["W1 player claims nothing in week two", mineOf(w2day, userCtx(roster, "Angelina Freeman")).length === 0 && mineOf(day, userCtx(roster, "Angelina Freeman")).length === 1],
  // faculty view: a coach sees pieces they RUN but don't play. Claudia (F) coaches Grieg (—she doesn't
  // play it), and also Fauré/Debussy (which she plays) — the latter are her brass playing cards, so
  // coachingOf must surface only Grieg, never double-list the two she plays.
  ["coach sees Grieg (runs it) but not Fauré/Debussy (plays them)", (c => c.length === 1 && c[0][2] === "Grieg Quartet" && c[0][3] === "A2")(coachingOf(day, userCtx(roster, "Claudia Ajmone-Marsan")))],
  ["Yoojin (F) coaches the Dvořák Quartet he sits out", (c => c.length === 1 && c[0][2] === "Dvorak Quartet")(coachingOf(day, userCtx(roster, "Yoojin Jang")))],
  ["a non-coach gets no coaching cards", coachingOf(day, userCtx(roster, "Felicia Weiss")).length === 0],
  ["W1-only coach gets no coaching cards in week two", coachingOf(w2day, userCtx(roster, "Claudia Ajmone-Marsan")).length === 0],
];
let pass = 0;
for (const [n, r] of checks) { console.log((r ? "PASS" : "FAIL") + "  " + n); pass += r ? 1 : 0; }
console.log(`\n${pass}/${checks.length}`);
process.exit(pass === checks.length ? 0 : 1);
