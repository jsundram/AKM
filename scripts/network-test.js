// Verify the pieces↔roster join and render static SVG previews of both network views
// (chord + ego rings) against the real sheets — no browser. Reuses the pure functions
// from network.js so the previews are the same geometry/colour/order the page draws.
//
//   node scripts/network-test.js [pieces.json roster.json]   # uses fixtures or live fetch
//
// With no args it fetches the two view-only tabs live; pass two saved gviz responses to
// run offline. Writes network-preview-*.svg / network-ego-*.svg next to the script.

const fs = require("fs");
const path = require("path");
const C = require("../network.js");

const SID = "1j__RMUvFWQlX9UuT-Uxkw7BkqWHCQkbR_hKsTyNwiyo";
const url = gid => `https://docs.google.com/spreadsheets/d/${SID}/gviz/tq?tqx=out:json&gid=${gid}`;
const get = u => new Promise((res, rej) =>
  require("https").get(u, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(d)); }).on("error", rej));

(async () => {
  const [pArg, rArg] = process.argv.slice(2);
  let piecesRaw, rosterRaw;
  try {                                          // live fetch is network-gated; skip (not fail) when offline
    piecesRaw = pArg ? fs.readFileSync(pArg, "utf8") : await get(url("244347893"));
    rosterRaw = rArg ? fs.readFileSync(rArg, "utf8") : await get(url("800090339"));
  } catch (e) {
    if (pArg && rArg) throw e;                   // fixtures were passed but unreadable → a real failure
    console.log("skipped — sheets unreachable (" + e.message + ")"); process.exit(0);
  }

  const roster = C.parseRoster(C.unwrap(rosterRaw));
  const pieces = C.pieceRows(C.unwrap(piecesRaw));
  const g = C.buildGraph(pieces, roster);

  let pass = 0, fail = 0;
  const ok = (cond, label) => { (cond ? pass++ : fail++); console.log(`${cond ? "ok  " : "FAIL"}  ${label}`); };

  ok(roster.length > 50, `roster parsed (${roster.length} people)`);
  ok(pieces.length > 30, `pieces parsed (${pieces.length} pieces)`);
  ok(g.unresolved.length === 0, `every player resolves to the roster (${g.unresolved.length} unmatched${g.unresolved.length ? ": " + g.unresolved.join(", ") : ""})`);
  ok(g.nodes.length > 50, `nodes = playing musicians (${g.nodes.length})`);

  // matrix is symmetric, zero diagonal, integer weights
  const N = g.matrix.length, m = g.matrix;
  let sym = true, diag = true;
  for (let i = 0; i < N; i++) { if (m[i][i] !== 0) diag = false; for (let j = 0; j < N; j++) if (m[i][j] !== m[j][i]) sym = false; }
  ok(sym, "matrix symmetric");
  ok(diag, "matrix zero diagonal");

  // ordering: instrument-rank non-decreasing, first-name A→Z within a family
  const rank = s => { const i = C.INST_ORDER.indexOf(C.instLabel(s)); return i < 0 ? 99 : i; };  // blank instrument sorts last, as buildGraph does
  let ordered = true;
  for (let i = 1; i < g.nodes.length; i++) {
    const a = g.nodes[i - 1], b = g.nodes[i], ra = rank(a.instrument), rb = rank(b.instrument);
    if (ra > rb || (ra === rb && a.first.localeCompare(b.first) > 0)) ordered = false;
  }
  ok(ordered, "nodes sorted by instrument then first name");

  // Jason plays the three pieces we expect him in (Dvořák Qt, Fauré PQ, Bruch Octet)
  const ji = g.nodes.findIndex(x => x.name === "Jason Sundram");
  const jasonCo = ji >= 0 ? m[ji].reduce((a, b) => a + b, 0) : 0;
  ok(ji >= 0 && jasonCo >= 12, `Jason present with co-players (${jasonCo})`);

  // ego layout: rings from Jason, every node placed, edges classified orbit/radial
  const Plight = C.decorate(g.nodes, "light");
  const ego = C.buildEgo(Plight, g.matrix, { diameter: 760, labelPad: 100, labelFont: 11, nodeR: 5 });
  ok(ego.nodes.length === g.nodes.length, `ego places every node (${ego.nodes.length})`);
  ok(ego.maxDeg === 3 && ego.rings.length === 3, `ego has 3 rings (maxDeg ${ego.maxDeg})`);
  const ringSizes = [0, 1, 2, 3].map(d => ego.nodes.filter(n => n.deg === d).length);
  ok(ringSizes[0] === 1 && ego.nodes.find(n => n.deg === 0).mine, "Jason alone at the centre (ring 0)");
  ok(ringSizes.every(s => s > 0), `ring sizes ${ringSizes.join("/")} (0 unreached)`);
  const orbit = ego.edges.filter(e => e.kind === "orbit").length, radial = ego.edges.length - orbit;
  ok(orbit > 0 && radial > 0, `edges classified (${radial} radial spokes, ${orbit} orbit arcs)`);
  // BFS invariant: no edge spans more than one ring
  const degOf = {}; ego.nodes.forEach(n => degOf[n.name] = n.deg);
  ok(ego.edges.every(e => Math.abs(degOf[e.a] - degOf[e.b]) <= 1), "no edge skips a ring (BFS invariant)");

  // render previews — chord + ego, both themes
  const out = path.join(__dirname, "..");
  for (const theme of ["light", "dark"]) {
    const P = C.decorate(g.nodes, theme);
    const bg = theme === "dark" ? "#0F1817" : "#E9EDEC";
    const scene = C.buildScene(P, g.matrix, { diameter: 720, labelPad: 96, arcThickness: 13, labelFont: 12 });
    fs.writeFileSync(path.join(out, `network-preview-${theme}.svg`), C.sceneToSvg(scene, bg));
    const eg = C.buildEgo(P, g.matrix, { diameter: 760, labelPad: 100, labelFont: 11, nodeR: 5 });
    fs.writeFileSync(path.join(out, `network-ego-${theme}.svg`), C.egoToSvg(eg, bg));
  }
  console.log(`\nwrote network-preview-*.svg + network-ego-*.svg`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
