// Usage crunch, in the browser — a 1:1 port of usage/crunch.py so the /usage/ page
// refreshes itself live (open = refresh) instead of waiting on the nightly laptop job.
// Same shape out as the old baked DATA blob; scripts/usage-test.js pins it to the
// Python oracle's golden so the two can't drift.
//
// Input is the analytics sheet's pings tab (published-to-web CSV, CORS-clean) + the
// set of roster uids (SHA-256(name)[:8]) the page already derives to join names. Names
// never touch this file — everyone is keyed by uid, exactly as in the CSV and the blob.
(function () {
  const JASON = "70f71792";                                  // uid("Jason Sundram") — shown, not ranked
  const LAUNCH = Date.UTC(2026, 6, 6, 19, 30);               // shared over dinner; earlier rows = testing
  const END = Date.UTC(2026, 6, 13, 0, 0);                   // festival's over: frozen dashboard = [LAUNCH, END); later opens → the post-fest block
  const SERIES0 = Date.UTC(2026, 6, 6, 19, 0);               // LAUNCH.replace(minute=0)
  const QUEUED = 90e3;                                        // received this far after opened = was offline
  const HOUR = 36e5;

  // wall-clock, tz-agnostic: parse "M/D/YYYY H:M:S" into a UTC instant so bucketing by
  // day/hour and hourly stepping never touch local time or DST — matching Python's naive
  // datetimes (the viewer could be in any timezone; the sheet's clock is Vienna's).
  const T = s => {
    const m = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)/.exec(s || "");
    return m ? Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]) : null;
  };
  const day = ms => { const d = new Date(ms); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const hour = ms => new Date(ms).getUTCHours();

  // minimal RFC-4180 CSV: quoted fields, "" escapes, commas/newlines inside quotes.
  function parseCSV(text) {
    const rows = [[]]; let f = "", q = false;
    text = text.replace(/\r\n?/g, "\n");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { rows[rows.length - 1].push(f); f = ""; }
      else if (c === "\n") { rows[rows.length - 1].push(f); f = ""; rows.push([]); }
      else f += c;
    }
    rows[rows.length - 1].push(f);
    if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i]); return o; });
  }

  // the 👏 applause events (empty page, action=kudos): who was cheered, for which piece.
  // same interrupted-flush dedup + launch filter as opens; recipients/senders stay uid-keyed.
  function kudosCrunch(krows) {
    const seen = new Set(), dd = [];                          // dedup on (opened, sender, recipient, composer)
    for (const x of krows) { const k = `${x.opened}|${x.who}|${x.to}|${x.label}`;
      if (!seen.has(k)) { seen.add(k); dd.push(x); } }
    const kept = dd.filter(x => x.opened !== null && x.opened >= LAUNCH && x.opened < END);
    const toCt = new Map(), compCt = new Map(), senders = new Set();
    for (const { who, to, label } of kept) {
      if (who) senders.add(who);
      if (to) toCt.set(to, (toCt.get(to) || 0) + 1);
      if (label) compCt.set(label, (compCt.get(label) || 0) + 1);
    }
    const scmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    return {
      total: kept.length, senders: senders.size, recipients: toCt.size,
      byComposer: [...compCt.entries()].map(([label, n]) => ({ label, n }))
        .sort((a, b) => b.n - a.n || scmp(a.label, b.label)),
      toList: [...toCt.entries()].map(([uid, n]) => ({ uid, n }))
        .sort((a, b) => b.n - a.n || scmp(a.uid, b.uid)),
    };
  }

  // post-festival trickle — deliberately OUT of the frozen dashboard, surfaced on its own:
  // opens, unique identified users, anon opens, and a by-day count. Answers "still used?".
  function postCrunch(postRows) {
    const users = new Set(), byDay = {}; let anon = 0;
    for (const { opened, who } of postRows) {
      const d = day(opened);
      byDay[d] = (byDay[d] || 0) + 1;
      if (who) users.add(who); else anon++;
    }
    return { opens: postRows.length, users: users.size, anon, byDay };
  }

  function crunch(csvText, rosterUids, now = new Date()) {
    const roster = rosterUids instanceof Set ? rosterUids : new Set(rosterUids || []);
    let rows = [], krows = [];
    for (const r of parseCSV(csvText)) {
      const rec = T(r.received), opened = T(r.opened) || T(r.received);
      const page = (r.page || "").trim(), who = (r.who || "").trim();
      if (rec !== null && page && page !== "page") rows.push({ opened, rec, page, who });
      else if (rec !== null && (r.action || "").trim() === "kudos")    // a feature-use event, empty page
        krows.push({ opened, who, to: (r.to || "").trim(), label: (r.label || "").trim() });
    }
    // sort by (opened, rec, page, who) — same tuple order Python sorts, so dedup keeps
    // the same first occurrence and every insertion-ordered dict below matches
    const cmp = (a, b) => a - b || 0;
    const scmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    rows.sort((a, b) => cmp(a.opened, b.opened) || cmp(a.rec, b.rec) || scmp(a.page, b.page) || scmp(a.who, b.who));
    const raw = rows.length;

    const seen = new Set(), dedup = [];                        // a flush interrupted mid-save re-sends
    for (const x of rows) {
      const k = `${x.opened} ${x.page} ${x.who}`;
      if (!seen.has(k)) { seen.add(k); dedup.push(x); }
    }
    const dupes = raw - dedup.length;                         // duplicate deliveries removed (before any date split)
    const pre = dedup.filter(x => x.opened < LAUNCH).length;
    const postRows = dedup.filter(x => x.opened >= END);
    const dd = dedup.filter(x => x.opened >= LAUNCH && x.opened < END);

    const launchDay = day(LAUNCH);                             // launch night skews the hour-of-day rhythm
    const users = new Map(), pages = new Map(), byDay = {}, anonDay = {};
    const byHour = new Array(24).fill(0);
    const buckets = new Map(), first = new Map();
    let anon = 0, queued = 0;
    for (const { opened, rec, page, who } of dd) {
      const d = day(opened), h = hour(opened);
      byDay[d] = (byDay[d] || 0) + 1;
      if (d !== launchDay) byHour[h]++;                        // rhythm of day leaves out launch night's spike
      const bk = `${d} ${h}`; buckets.set(bk, (buckets.get(bk) || 0) + 1);
      let pg = pages.get(page); if (!pg) pages.set(page, pg = { opens: 0, users: new Set() });
      pg.opens++;
      if (rec - opened > QUEUED) queued++;
      if (!who) { anon++; anonDay[d] = (anonDay[d] || 0) + 1; continue; }
      pg.users.add(who);
      let u = users.get(who); if (!u) users.set(who, u = { uid: who, opens: 0, pages: {}, days: new Set() });
      u.opens++;
      u.pages[page] = (u.pages[page] || 0) + 1;
      u.days.add(d);
      if (who !== JASON && !first.has(who)) first.set(who, opened);
    }

    const series = [], adopt = [];
    const end = Math.max(...dd.map(x => x.opened));
    const firsts = [...first.values()].sort((a, b) => a - b);
    for (let t = SERIES0; t <= end; t += HOUR) {
      const label = `${day(t)} ${String(hour(t)).padStart(2, "0")}`;
      series.push({ t: label, n: buckets.get(`${day(t)} ${hour(t)}`) || 0 });
      adopt.push({ t: label, n: firsts.filter(f => f < t + HOUR).length });
    }

    const ulist = [...users.values()].sort((a, b) => b.opens - a.opens);
    const pad2 = n => String(n).padStart(2, "0");
    return {
      generated: `${now.getMonth() + 1}/${now.getDate()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
      raw, deduped: dupes, pre, total: dd.length,
      anon, queued,
      rosterSize: roster.size,
      identified: ulist.length,
      unknown: ulist.filter(u => !roster.has(u.uid)).length,
      users: ulist.map(u => ({ uid: u.uid, opens: u.opens, pages: u.pages, days: u.days.size, known: roster.has(u.uid) })),
      pages: [...pages.entries()].map(([p, v]) => ({ page: p, opens: v.opens, users: v.users.size }))
        .sort((a, b) => b.opens - a.opens),
      byDay, anonByDay: anonDay, byHour,
      series, adopt,
      kudos: kudosCrunch(krows),
      post: postCrunch(postRows),
    };
  }

  const api = { crunch, parseCSV };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.UsageCrunch = api;
})();
