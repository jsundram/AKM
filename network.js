// AKM co-performance network. Two view-only sheets, pulled live (gviz JSONP) and
// cached offline like the schedule: a "pieces" grid (Group · Piece · Player 1…8)
// and the roster (Name · Instrument · Type). We join the two — the pieces sheet
// writes people informally (first-name-only, "(W1)" tags), the roster has the
// canonical name + instrument + role — and build a co-occurrence matrix (weight =
// pieces two people share). Two views off the same data, behind a Rings | Chord
// toggle: a d3 chord (musicians by instrument then first name, a colour per family),
// and an ego-centric ring layout (Jason at the center, BFS rings around him).
// Faculty/fellows read bold; Jason is the one warm-brass mark.
//
// Geometry/colour/order/visibility live in pure functions (buildGraph, decorate,
// buildScene, buildEgo) that run under Node too, so scripts/network-test.js can verify
// the join and render static SVG previews of both views without a browser.

(function () {
  const isNode = typeof window === "undefined";
  const d3 = isNode ? require("./d3.v7.min.js") : window.d3;

  const SID = "1j__RMUvFWQlX9UuT-Uxkw7BkqWHCQkbR_hKsTyNwiyo";
  const PIECES_GID = "244347893";
  const ROSTER_GID = "800090339";
  const CK = "akm-network";               // localStorage cache (offline-first)
  // "me" follows the schedule page's picker (akm-me); the Node preview harness keeps Jason so
  // scripts/network-test.js renders a stable ego view without a browser.
  const MINE = isNode ? "Jason Sundram" : (()=>{ try { return localStorage.getItem("akm-me") || ""; } catch { return ""; } })();

  // Instruments collapse to this fixed set, shown + ordered as in roster.html
  // (V before V/VA before VA…); Cello folds into VC, clarinet + oboe into Winds.
  const INST_ORDER = ["V", "V/VA", "VA", "VC", "Bass", "Piano", "Winds"];
  function instLabel(s) {
    s = (s || "").trim(); if (!s) return ""; const l = s.toLowerCase();
    return l === "v/va" ? "V/VA"
      : l.startsWith("vc") || l.startsWith("ce") ? "VC"     // VC, Cello
      : l.startsWith("va") ? "VA"                            // VA, VA1
      : l.startsWith("v") ? "V"                              // V, V1…V4, V1/V2
      : l.startsWith("b") ? "Bass"
      : l.startsWith("p") ? "Piano"
      : l.startsWith("o") || l.startsWith("c") ? "Winds"     // Oboe, Clar, Clar.
      : s;
  }
  const instRank = s => { const i = INST_ORDER.indexOf(instLabel(s)); return i < 0 ? 99 : i; };

  // Hues spread for separation — VA (green) and VC (terracotta) deliberately far apart,
  // the rest fanned around them. Brass gold (#9A6B22) stays reserved for Jason, so no
  // instrument owns it. dark = lifted for the dark page.
  const PALETTE = {
    light: { V: "#3F6E92", "V/VA": "#5FA8C2", VA: "#5BA152", VC: "#BE6E45", Bass: "#5E5BA6",
             Piano: "#B65082", Winds: "#8C9B3C", "": "#8C9A9B" },
    dark:  { V: "#6FA3C6", "V/VA": "#84C6DA", VA: "#79C46B", VC: "#E0926A", Bass: "#8E8CD6",
             Piano: "#E07AA8", Winds: "#BFCE6A", "": "#869897" },
  };
  const MINE_FILL = { light: "#9A6B22", dark: "#D9A24C" };     // brass — the picked user only
  const BOLD = new Set(["F", "AF", "TF"]);                      // faculty + both fellow types
  const boldType = t => String(t || "").split(/[^A-Za-z0-9]+/).some(k => BOLD.has(k));   // "F, W1" is still faculty

  // Pieces sheet → roster name. Most tokens are full names or unambiguous first names; these are the
  // ones that don't: an informal first name ("Steve" = the director, Steve Buck), a drifted spelling
  // (Preetcham/Preetcharn), a two-word alias, and a bare first name that collides (two Tanyas).
  const ALIAS = { "Preetcham Saund": "Preet Saund", "Preetcharn Saund": "Preet Saund",
    "Seah Yu": "Seah Katherine Yu", "Tanya": "Tanya Bannister", "Steve": "Stephen Buck" };
  const stripTag = t => t.replace(/\s*\((?:W1|W2)\)\s*$/i, "").trim();

  // gviz wrapper → table rows as string arrays (Node fetch path; the browser JSONP
  // callback hands back the parsed object directly, see jsonp()).
  const unwrap = text => JSON.parse(text.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, "")).table;
  const cells = t => (t.rows || []).map(r => (r.c || []).map(c => (c ? String(c.v ?? c.f ?? "").trim() : "")));

  function parseRoster(table) {
    const rows = cells(table);
    const lc = (table.cols || []).map(c => (c.label || "").toLowerCase());
    let at = k => lc.findIndex(x => x.includes(k));
    let head = -1;
    if (at("name") < 0) {                                  // header landed in row 0, not cols
      head = rows.findIndex(r => r.some(x => x.toLowerCase() === "name"));
      const h = (rows[head] || []).map(x => x.toLowerCase());
      at = k => h.findIndex(x => x.includes(k));
    }
    const ni = at("name"), ii = at("instr"), ti = at("type");
    return rows.slice(head + 1)
      .map(r => ({ name: r[ni], instrument: r[ii] || "", type: (r[ti] || "").trim() }))
      .filter(p => p.name && p.name.toLowerCase() !== "name")
      .map(p => ({ ...p, first: p.name.split(/\s+/)[0] }));
  }
  // header-tolerant: locate the Piece column + the Player N columns by label (gviz may blank the
  // cols and drop the header into row 0), and return each piece's player tokens. Column-position-
  // independent, so inserting group columns before Piece can't shift the parse. Returns one token
  // array per piece.
  function pieceRows(table) {
    const rows = cells(table);
    let lc = (table.cols || []).map(c => (c.label || "").toLowerCase()), start = 0;
    if (!lc.includes("piece")) {                          // header landed in row 0, not the cols
      const h = rows.findIndex(r => r.some(x => x.toLowerCase() === "piece"));
      lc = (rows[h] || []).map(x => x.toLowerCase()); start = h + 1;
    }
    const pi = lc.indexOf("piece");
    let cols = lc.map((h, i) => (/^player/.test(h) ? i : -1)).filter(i => i >= 0);
    if (!cols.length) cols = lc.map((_, i) => i).filter(i => i > pi);   // fallback: everything right of Piece
    return rows.slice(start)
      .filter(r => (r[pi] || "").trim() && cols.some(i => (r[i] || "").trim()))
      .map(r => cols.map(i => r[i] || ""));
  }

  // Join: resolve each player token to a roster name, accumulate shared-piece weights,
  // keep only roster people who actually play, order them, emit a symmetric matrix.
  function buildGraph(pieces, roster) {
    const byName = new Set(roster.map(p => p.name));
    const byFirst = new Map();
    roster.forEach(p => { const k = p.first.toLowerCase(); (byFirst.get(k) || byFirst.set(k, []).get(k)).push(p.name); });
    const names = roster.map(p => p.name);
    const resolve = tok => {
      const t = stripTag(tok);
      if (ALIAS[t]) return ALIAS[t];
      if (byName.has(t)) return t;
      const f = byFirst.get(t.toLowerCase());
      if (f && f.length === 1) return f[0];
      const pref = names.filter(n => n.toLowerCase().startsWith(t.toLowerCase()));
      return pref.length === 1 ? pref[0] : null;
    };
    const wt = new Map(), present = new Set(), unresolved = new Set();
    for (const players of pieces) {
      const ps = [];
      for (const tok of players.filter(Boolean)) {
        const r = resolve(tok); if (r) { ps.push(r); present.add(r); } else unresolved.add(tok);
      }
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const k = [ps[i], ps[j]].sort().join("|"); wt.set(k, (wt.get(k) || 0) + 1);
      }
    }
    const nodes = roster.filter(p => present.has(p.name)).sort((a, b) =>
      instRank(a.instrument) - instRank(b.instrument) || a.first.localeCompare(b.first) || a.name.localeCompare(b.name));
    const idx = new Map(nodes.map((n, i) => [n.name, i]));
    const N = nodes.length;
    const matrix = Array.from({ length: N }, () => new Array(N).fill(0));
    for (const [k, w] of wt) {
      const [a, b] = k.split("|"); const i = idx.get(a), j = idx.get(b);
      if (i == null || j == null) continue; matrix[i][j] = w; matrix[j][i] = w;
    }
    return { nodes, matrix, unresolved: [...unresolved] };
  }

  // Compact, disambiguated arc labels: first name, +last initial only where two share one.
  function labelize(nodes) {
    const byFirst = {};
    nodes.forEach(n => (byFirst[n.first] = byFirst[n.first] || []).push(n));
    const out = new Map();
    nodes.forEach(n => {
      if (byFirst[n.first].length === 1) out.set(n.name, n.first);
      else { const last = n.name.split(/\s+/).slice(1)[0] || ""; out.set(n.name, `${n.first} ${last[0] || ""}.`); }
    });
    return out;
  }

  // Decorate nodes for a theme: final colour, label, bold + mine flags. Pure, so the
  // Node preview can decorate with the light palette and get pixel-identical output.
  function decorate(nodes, theme) {
    const pal = PALETTE[theme], labels = labelize(nodes);
    return nodes.map(n => ({
      name: n.name, label: labels.get(n.name), inst: instLabel(n.instrument),
      color: n.name === MINE ? MINE_FILL[theme] : pal[instLabel(n.instrument)] || pal[""],
      bold: boldType(n.type) || n.name === MINE, mine: n.name === MINE,
    }));
  }

  // Pure scene: arcs, ribbons, labels as plain primitives. The browser turns these into
  // SVG DOM (+ interaction); the Node preview turns them into an SVG string.
  function buildScene(P, matrix, opts) {
    const { diameter, labelPad, arcThickness, labelFont } = opts;
    const outer = diameter / 2 - labelPad, inner = outer - arcThickness;
    const layout = d3.chord().padAngle(0.015).sortGroups(null).sortSubgroups(null)(matrix);
    const arcGen = d3.arc().innerRadius(inner).outerRadius(outer);
    const ribGen = d3.ribbon().radius(inner);
    const blend = (i, j) => d3.interpolateRgb(P[i].color, P[j].color)(0.5);

    const ribbons = layout.map(d => ({
      d: ribGen(d), fill: blend(d.source.index, d.target.index),
      a: P[d.source.index].name, b: P[d.target.index].name,
      w: matrix[d.source.index][d.target.index], i: d.source.index, j: d.target.index,
    }));
    const arcs = layout.groups.map(g => ({
      d: arcGen(g), fill: P[g.index].color, name: P[g.index].name, inst: P[g.index].inst,
      mine: P[g.index].mine, index: g.index,
    }));

    // Radial labels just outside the arcs; flip text on the left half so it reads
    // outward. Font scales to each arc's tangential budget, floored at 7px; a greedy
    // walk hides labels that would collide with the last one shown.
    const lr = outer + 6, MINF = 7;
    const fontFor = g => Math.max(MINF, Math.min(labelFont, (g.endAngle - g.startAngle) * lr));
    let lastEnd = -Infinity;
    const labels = layout.groups.map(g => {
      const font = fontFor(g), mid = (g.startAngle + g.endAngle) / 2, half = font / 2 / lr;
      const show = mid - half >= lastEnd; if (show) lastEnd = mid + half;
      const deg = mid * 180 / Math.PI - 90, flip = deg > 90;
      return {
        index: g.index, text: P[g.index].label, font, show, bold: P[g.index].bold,
        color: P[g.index].mine ? P[g.index].color : null, anchor: flip ? "end" : "start",
        transform: `rotate(${deg}) translate(${lr})${flip ? " rotate(180)" : ""}`,
      };
    });
    return { size: diameter, arcs, ribbons, labels };
  }

  // Ego (radial) layout: Jason at the center, BFS rings around him — everyone he plays
  // with, then their other co-players, then theirs. Cross-ring edges are straight spokes;
  // same-ring edges bow inward as thin "orbit" arcs (deeper the farther apart). Rings ≥2
  // are ordered by the circular-mean angle of their inner-ring neighbours, so a co-player
  // sits near whoever pulled them in and the spokes mostly avoid crossing.
  function buildEgo(P, matrix, opts) {
    const { diameter, labelPad, labelFont, nodeR } = opts, N = P.length;
    const TAU = Math.PI * 2, TOP = -Math.PI / 2;
    let ego = P.findIndex(p => p.mine);
    if (ego < 0)                                           // nobody picked (or a non-player): centre the best-connected musician
      ego = matrix.reduce((bi, row, i) => row.filter(Boolean).length > matrix[bi].filter(Boolean).length ? i : bi, 0);

    const deg = new Array(N).fill(-1); deg[ego] = 0;
    const layers = [[ego]];
    for (let d = 0; layers[d] && layers[d].length; d++) {
      const next = [];
      for (const u of layers[d]) for (let v = 0; v < N; v++)
        if (matrix[u][v] > 0 && deg[v] < 0) { deg[v] = d + 1; next.push(v); }
      if (next.length) layers.push(next);
    }
    const maxDeg = layers.length - 1;
    const Rmax = diameter / 2 - labelPad;
    const ringR = d => d === 0 ? 0 : Rmax * d / maxDeg;

    // place inner→outer so each ring can read its inner neighbours' angles
    const ang = new Array(N).fill(0);
    layers.forEach((L, d) => {
      if (!d) return;
      const meanAng = v => {
        let sx = 0, sy = 0;
        for (let u = 0; u < N; u++) if (matrix[u][v] > 0 && deg[u] === d - 1) { sx += Math.cos(ang[u]); sy += Math.sin(ang[u]); }
        return Math.atan2(sy, sx);
      };
      const order = d === 1 ? L.slice().sort((a, b) => a - b)
        : L.map(v => [v, meanAng(v)]).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(x => x[0]);
      order.forEach((idx, i) => { ang[idx] = TOP + TAU * i / order.length; });
    });

    const f = n => n.toFixed(1);
    const pos = i => ({ x: ringR(deg[i]) * Math.cos(ang[i]), y: ringR(deg[i]) * Math.sin(ang[i]) });
    const nodes = P.map((p, i) => {
      const { x, y } = pos(i);
      return { x, y, r: i === ego ? nodeR * 1.7 : nodeR, fill: p.color, name: p.name,
               inst: p.inst, deg: deg[i], mine: p.mine, bold: p.bold, index: i };
    });

    const edges = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      if (!matrix[i][j]) continue;
      const a = pos(i), b = pos(j), same = deg[i] === deg[j];
      let path;
      if (same) {                                            // bow inward, deeper for wider spans
        const R = ringR(deg[i]);
        let dlt = ((ang[j] - ang[i]) % TAU + TAU) % TAU; if (dlt > Math.PI) dlt -= TAU;
        const mid = ang[i] + dlt / 2, cr = R - Math.min(R * 0.82, Math.abs(dlt) / Math.PI * R * 0.62 + nodeR * 1.5);
        path = `M${f(a.x)} ${f(a.y)}Q${f(cr * Math.cos(mid))} ${f(cr * Math.sin(mid))} ${f(b.x)} ${f(b.y)}`;
      } else path = `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`;
      edges.push({ d: path, fill: d3.interpolateRgb(P[i].color, P[j].color)(0.5),
                   kind: same ? "orbit" : "radial", a: P[i].name, b: P[j].name, w: matrix[i][j] });
    }

    // labels radially outward from each node; greedy per-ring de-overlap by angle
    const show = new Array(N).fill(true);
    layers.forEach((L, d) => {
      if (!d) return;
      const r = ringR(d) + nodeR + 6; let last = -Infinity;
      L.slice().sort((a, b) => ang[a] - ang[b]).forEach(idx => {
        const half = labelFont * 0.5 / r;
        if (ang[idx] - half >= last) { show[idx] = true; last = ang[idx] + half; } else show[idx] = false;
      });
    });
    const labels = P.map((p, i) => {
      if (i === ego) return { owner: p.name, text: p.label, font: labelFont + 1, show: true, bold: true,
        color: p.color, anchor: "middle", transform: `translate(0 ${f(nodes[i].r + labelFont + 3)})` };
      const r = ringR(deg[i]) + nodeR + 6, flip = Math.cos(ang[i]) < 0;
      return { owner: p.name, text: p.label, font: labelFont, show: show[i], bold: p.bold,
        color: p.mine ? p.color : null, anchor: flip ? "end" : "start",
        transform: `rotate(${(ang[i] * 180 / Math.PI).toFixed(2)}) translate(${f(r)})${flip ? " rotate(180)" : ""}` };
    });

    return { size: diameter, rings: layers.slice(1).map((_, k) => ringR(k + 1)), nodes, edges, labels, maxDeg };
  }

  // ---- Node previews: scene → standalone SVG string (scripts/network-test.js) ----
  function sceneToSvg(scene, bg) {
    const h = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const r = scene.size / 2;
    const rib = scene.ribbons.map(x => `<path d="${x.d}" fill="${x.fill}" fill-opacity="0.45"/>`).join("");
    const arc = scene.arcs.map(x =>
      `<path d="${x.d}" fill="${x.fill}"${x.mine ? ` stroke="${x.fill}" stroke-width="2"` : ""}/>`).join("");
    const lab = scene.labels.filter(l => l.show).map(l =>
      `<text transform="${l.transform}" dy="0.32em" font-size="${l.font.toFixed(1)}" text-anchor="${l.anchor}" ` +
      `font-family="Inter,sans-serif" font-weight="${l.bold ? 600 : 400}" ` +
      `fill="${l.color || (bg === "#0F1817" ? "#E9EEEC" : "#172526")}">${h(l.text)}</text>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.size}" height="${scene.size}" ` +
      `viewBox="${-r} ${-r} ${scene.size} ${scene.size}" style="background:${bg}">` +
      `<g>${rib}</g><g>${arc}</g><g>${lab}</g></svg>`;
  }

  function egoToSvg(scene, bg) {
    const h = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const r = scene.size / 2, dark = bg === "#0F1817";
    const ink = dark ? "#E9EEEC" : "#172526", line = dark ? "#2C3938" : "#CBD3D1";
    const rings = scene.rings.map(R => `<circle r="${R.toFixed(1)}" fill="none" stroke="${line}" stroke-dasharray="2 5" opacity="0.6"/>`).join("");
    const edges = scene.edges.map(e => `<path d="${e.d}" fill="none" stroke="${e.fill}" stroke-width="1" stroke-opacity="${e.kind === "orbit" ? 0.34 : 0.26}"/>`).join("");
    const nodes = scene.nodes.map(n => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r}" fill="${n.fill}" stroke="${n.mine ? ink : bg}" stroke-width="${n.mine ? 1.8 : 1}"/>`).join("");
    const labs = scene.labels.filter(l => l.show).map(l =>
      `<text transform="${l.transform}" dy="0.32em" font-size="${l.font.toFixed(1)}" text-anchor="${l.anchor}" ` +
      `font-family="Inter,sans-serif" font-weight="${l.bold ? 600 : 400}" fill="${l.color || ink}" ` +
      `paint-order="stroke" stroke="${bg}" stroke-width="2.4">${h(l.text)}</text>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.size}" height="${scene.size}" ` +
      `viewBox="${-r} ${-r} ${scene.size} ${scene.size}" style="background:${bg}">` +
      `<g>${rings}</g><g>${edges}</g><g>${nodes}</g><g>${labs}</g></svg>`;
  }

  // ---------------- Browser ----------------
  if (!isNode) {
    const $ = s => document.querySelector(s);
    const theme = () => matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

    function jsonp(gid) {
      return new Promise((res, rej) => {
        const cb = "__c" + Math.random().toString(36).slice(2), s = document.createElement("script");
        const to = setTimeout(() => { clean(); rej(Error("timeout")); }, 15000);
        function clean() { clearTimeout(to); delete window[cb]; s.remove(); }
        window[cb] = d => { clean(); res(d); };
        s.onerror = () => { clean(); rej(Error("script")); };
        s.src = `https://docs.google.com/spreadsheets/d/${SID}/gviz/tq?gid=${gid}&tqx=out:json;responseHandler:${cb}`;
        document.head.appendChild(s);
      });
    }

    // Hover/tap detail goes into a fixed, height-reserved strip (#info) above the
    // chart — never a floating tooltip that covers the graph (bad on mobile). When
    // nothing is focused it falls back to the per-view hint, so the box never empties
    // and the layout never shifts.
    let GRAPH = null, info = null, hintText = "";
    const show = html => { info.innerHTML = html; };
    const hide = () => { info.innerHTML = hintText; };

    let view = "rings";
    function render() {
      if (!GRAPH) return;
      const host = $("#chart"); host.innerHTML = "";
      const P = decorate(GRAPH.nodes, theme());
      (view === "chord" ? renderChord : renderEgo)(host, P);
      const hasMe = GRAPH.nodes.some(n => n.name === MINE);
      hintText = `<span class="ih">${view === "chord"
        ? "tap a name or ribbon · ribbon = a shared piece"
        : `${hasMe ? "you" : "the most-connected musician"} in the center · each ring = a degree of separation · tap a name`}</span>`;
      hide();
    }

    function renderChord(host, P) {
      const mobile = innerWidth < 560;
      const w = Math.min(host.clientWidth, mobile ? 360 : 560);
      const scene = buildScene(P, GRAPH.matrix, {
        diameter: w, labelPad: mobile ? 52 : 74, arcThickness: mobile ? 9 : 12, labelFont: mobile ? 10 : 11,
      });
      const r = scene.size / 2;
      const svg = d3.select(host).append("svg")
        .attr("width", scene.size).attr("height", scene.size)
        .attr("viewBox", `${-r} ${-r} ${scene.size} ${scene.size}`);

      const touches = (rib, name) => rib.a === name || rib.b === name;
      const focus = name => {
        ribSel.attr("fill-opacity", d => name ? (touches(d, name) ? 0.8 : 0.05) : 0.45);
        arcSel.attr("opacity", d => !name || d.name === name || scene.ribbons.some(x => touches(x, name) && (x.a === d.name || x.b === d.name)) ? 1 : 0.3);
        labSel.style("display", l => l.show || (name && (P[l.index].name === name)) ? null : "none")
          .attr("font-weight", l => P[l.index].name === name || l.bold ? 600 : 400);
      };

      const ribSel = svg.append("g").selectAll("path").data(scene.ribbons).join("path")
        .attr("class", "rib").attr("d", d => d.d).attr("fill", d => d.fill).attr("fill-opacity", 0.45)
        .on("mouseenter", (e, d) => { focusRibbon(d); show(`<b>${d.a}</b> · <b>${d.b}</b> — ${d.w} piece${d.w === 1 ? "" : "s"} together`); })
        .on("mouseleave", () => { focus(null); hide(); })
        .on("click", (e, d) => show(`<b>${d.a}</b> · <b>${d.b}</b> — ${d.w} piece${d.w === 1 ? "" : "s"} together`));

      function focusRibbon(d) {
        ribSel.attr("fill-opacity", x => x === d ? 0.85 : 0.05);
        labSel.style("display", l => l.show || l.index === d.i || l.index === d.j ? null : "none");
      }

      const arcSel = svg.append("g").selectAll("path").data(scene.arcs).join("path")
        .attr("class", "arc").attr("d", d => d.d).attr("fill", d => d.fill)
        .attr("stroke", d => d.mine ? d.fill : "none").attr("stroke-width", d => d.mine ? 2 : 0)
        .on("mouseenter", function (e, d) {
          focus(d.name);
          const n = GRAPH.nodes.find(x => x.name === d.name);
          const co = scene.ribbons.filter(x => touches(x, d.name)).reduce((a, x) => a + x.w, 0);
          show(`<b>${d.name}</b> — ${d.inst || "—"} · ${n.type || "—"} · ${co} co-player${co === 1 ? "" : "s"}`);
        })
        .on("mouseleave", () => { focus(null); hide(); })
        .on("click", function (e, d) { e.stopPropagation(); focus(d.name); });

      const labSel = svg.append("g").selectAll("text").data(scene.labels).join("text")
        .attr("class", "clab").attr("transform", d => d.transform).attr("dy", "0.32em")
        .attr("font-size", d => d.font).attr("text-anchor", d => d.anchor)
        .attr("font-weight", d => d.bold ? 600 : 400)
        .style("fill", d => d.color || null)
        .style("display", d => d.show ? null : "none")
        .text(d => d.text);

      svg.on("click", () => { focus(null); hide(); });
    }

    function renderEgo(host, P) {
      const mobile = innerWidth < 560;
      const w = Math.min(host.clientWidth, mobile ? 380 : 600);
      const scene = buildEgo(P, GRAPH.matrix, {
        diameter: w, labelPad: mobile ? 56 : 80, labelFont: mobile ? 9 : 10, nodeR: mobile ? 4 : 5,
      });
      const r = scene.size / 2;
      const svg = d3.select(host).append("svg")
        .attr("width", scene.size).attr("height", scene.size)
        .attr("viewBox", `${-r} ${-r} ${scene.size} ${scene.size}`);

      svg.append("g").selectAll("circle").data(scene.rings).join("circle").attr("class", "ring").attr("r", d => d);

      const touches = (e, name) => e.a === name || e.b === name;
      const nbrs = name => { const s = new Set([name]); scene.edges.forEach(e => { if (e.a === name) s.add(e.b); if (e.b === name) s.add(e.a); }); return s; };
      const base = d => d.kind === "orbit" ? 0.34 : 0.26;
      const focus = name => {
        const nb = name ? nbrs(name) : null;
        edgeSel.attr("stroke-opacity", e => name ? (touches(e, name) ? 0.85 : 0.04) : base(e));
        nodeSel.attr("opacity", n => !name || nb.has(n.name) ? 1 : 0.3);
        labSel.style("display", l => l.show || (name && nb.has(l.owner)) ? null : "none")
          .attr("font-weight", l => (name && l.owner === name) || l.bold ? 600 : 400);
      };

      const edgeSel = svg.append("g").selectAll("path").data(scene.edges).join("path")
        .attr("class", d => "edge " + d.kind).attr("d", d => d.d).attr("stroke", d => d.fill)
        .attr("stroke-width", 1).attr("stroke-opacity", base);
      svg.append("g").selectAll("path").data(scene.edges).join("path")     // wide invisible hit paths
        .attr("class", "ehit").attr("d", d => d.d)
        .on("mouseenter", (e, d) => show(`<b>${d.a}</b> · <b>${d.b}</b> — ${d.w} piece${d.w === 1 ? "" : "s"} together`))
        .on("mouseleave", hide);

      const nodeSel = svg.append("g").selectAll("circle").data(scene.nodes).join("circle")
        .attr("class", d => d.mine ? "node mine" : "node").attr("cx", d => d.x).attr("cy", d => d.y)
        .attr("r", d => d.r).attr("fill", d => d.fill)
        .on("mouseenter", (e, d) => {
          focus(d.name);
          const co = scene.edges.filter(x => touches(x, d.name)).reduce((a, x) => a + x.w, 0);
          const n = GRAPH.nodes.find(x => x.name === d.name);
          const ring = d.deg === 0 ? (d.mine ? "you" : "center")
            : ["", "1st degree", "2nd degree", "3rd degree"][d.deg] || `${d.deg}th degree`;
          show(`<b>${d.name}</b> — ${d.inst || "—"} · ${n.type || "—"} · ${ring} · ${co} link${co === 1 ? "" : "s"}`);
        })
        .on("mouseleave", () => { focus(null); hide(); })
        .on("click", (e, d) => { e.stopPropagation(); focus(d.name); });

      const labSel = svg.append("g").selectAll("text").data(scene.labels).join("text")
        .attr("class", "nlab").attr("transform", d => d.transform).attr("dy", "0.32em")
        .attr("font-size", d => d.font).attr("text-anchor", d => d.anchor)
        .attr("font-weight", d => d.bold ? 600 : 400).style("fill", d => d.color || null)
        .style("display", d => d.show ? null : "none").text(d => d.text);

      svg.on("click", () => { focus(null); hide(); });
    }

    function paint(graph) {
      GRAPH = graph;
      let pairs = 0;
      graph.matrix.forEach((row, i) => row.forEach((w, j) => { if (j > i && w) pairs++; }));
      $("#count").textContent = `${graph.nodes.length} musicians · ${pairs} connections`;
      $("#msg").hidden = true;
      render();
    }
    const msg = t => { const m = $("#msg"); m.textContent = t; m.hidden = false; $("#chart").innerHTML = ""; };

    function legend() {
      const seen = new Set(GRAPH ? GRAPH.nodes.map(n => instLabel(n.instrument)) : INST_ORDER);
      const pal = PALETTE[theme()];
      const you = GRAPH && GRAPH.nodes.some(n => n.name === MINE)   // brass swatch only once someone's picked
        ? `<b><i style="background:${MINE_FILL[theme()]}"></i>you</b>` : "";
      $("#legend").innerHTML = INST_ORDER.filter(k => seen.has(k))
        .map(k => `<b><i style="background:${pal[k]}"></i>${k}</b>`).join("") + you;
    }

    async function pull() {
      if (navigator.onLine === false) return;
      try {
        const [pj, rj] = await Promise.all([jsonp(PIECES_GID), jsonp(ROSTER_GID)]);
        const roster = parseRoster(rj.table), pieces = pieceRows(pj.table);
        const g = buildGraph(pieces, roster);
        if (!g.nodes.length) return;
        if (g.unresolved.length) console.warn("unmatched players:", g.unresolved);
        localStorage.setItem(CK, JSON.stringify(g));
        paint(g); legend();
      } catch (e) { if (!localStorage.getItem(CK)) msg("Chart unavailable — open once on wifi to cache it."); }
    }

    function boot() {
      info = $("#info");
      $("#seg").querySelectorAll("button").forEach(b => b.onclick = () => {
        view = b.dataset.v;
        $("#seg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        render();
      });
      let cached = null; try { cached = JSON.parse(localStorage.getItem(CK)); } catch {}
      if (cached && cached.nodes) { paint(cached); legend(); }
      else if (navigator.onLine) msg("Loading…");
      else msg("Offline — open once on wifi to load the chart.");
      pull();
      addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
      addEventListener("resize", () => { clearTimeout(boot._t); boot._t = setTimeout(render, 150); });
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { render(); legend(); });
    }
    boot();
  }

  if (isNode) module.exports = { unwrap, parseRoster, pieceRows, buildGraph, decorate, buildScene, buildEgo, sceneToSvg, egoToSvg, instLabel, INST_ORDER };
})();
