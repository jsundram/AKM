// Shared roster data layer for both the schedule page (app.js) and the roster page (roster.html).
// Pulls two view-only tabs (gviz JSONP) and caches them (akm-roster, akm-rep) so whichever page you
// open primes the other and both work offline. Nothing is in the repo (PII); it lives client-side.
//
// The Repertoire tab (Group-W1 · Group-W2 · Piece · Player 1…8) is the single source of truth for who
// plays what. cached() reconciles each Player token to a canonical roster name (exact or unambiguous
// first name — the same match the network graph uses) and derives each person's `pieces` string live
// from it, so the roster sheet's own Pieces column is vestigial and nothing can go stale. Loaded
// before app.js / the roster script, exposes window.Roster.
(function(g){
  const SID = "1j__RMUvFWQlX9UuT-Uxkw7BkqWHCQkbR_hKsTyNwiyo";
  const GID = "800090339";          // roster tab
  const REP_GID = "244347893";      // repertoire tab
  const KEY = "akm-roster", REPKEY = "akm-rep";
  const MEK = "akm-me";             // picked identity (canonical roster Name); null = never asked, "" = declined

  // whoever the schedule page's picker chose — every page personalizes off this one value
  const me = () => { try{ return localStorage.getItem(MEK); }catch{ return null; } };
  const setMe = n => { try{ localStorage.setItem(MEK, n); }catch{} };

  // roster Hotel values → map POI names: "Obernosterer Apartment" is the building the map labels
  // "Haus Obernosterer" (Liesing 25); the AirBNB is its own POI at Liesing 50, so it self-resolves.
  // "Kultursaal apartment" is in the Badstub'n building at Klebas 30 — the POI named Kultursaal (per
  // Jason). Everything else matches a POI verbatim or isn't mapped yet (Haus Simona, Haus Salcher).
  const HOTEL_POI = {
    "obernosterer apartment":"Haus Obernosterer",
    "kultursaal apartment":"Kultursaal",
  };
  const hotelPoi = h => HOTEL_POI[(h||"").toLowerCase()] || h;

  function jsonp(gid){
    return new Promise((res,rej)=>{
      const cb = "__r"+Math.random().toString(36).slice(2);
      const s = document.createElement("script");
      const to = setTimeout(()=>{ cleanup(); rej(new Error("timeout")); }, 15000);
      function cleanup(){ clearTimeout(to); delete g[cb]; s.remove(); }
      g[cb] = d => { cleanup(); res(d); };
      s.onerror = () => { cleanup(); rej(new Error("script")); };
      s.src = `https://docs.google.com/spreadsheets/d/${SID}/gviz/tq?gid=${gid}&tqx=out:json;responseHandler:${cb}`;
      document.head.appendChild(s);
    });
  }
  // gviz header detection is flaky: sometimes it labels the cols, sometimes it dumps the header into
  // row 0 with blank labels. Try the labels, else fall back to row 0.
  function colMap(labels){
    const at = k => labels.findIndex(x => x.includes(k));
    const name=at("name"), hotel=at("hotel");
    if(name<0 || hotel<0) return null;
    const num = at("number")>=0 ? at("number") : at("#");
    const from = ["hometown","location","from","home","city"].reduce((a,k)=> a>=0?a:at(k), -1);
    const whatsapp = at("whatsapp")>=0 ? at("whatsapp") : at("phone");
    return {n: num<0?0:num, name, instrument: at("instr"), type: at("type"), hotel, pieces: at("piece"), notes: at("note"), from, whatsapp};
  }
  const pick = (r,i) => i<0 ? "" : (r[i]||"");
  function parse(gv){
    const t = gv && gv.table; if(!t) return [];
    let rows = (t.rows||[]).map(r => (r.c||[]).map(c => c ? String(c.v ?? c.f ?? "").trim() : ""));
    let m = colMap((t.cols||[]).map(c => (c.label||"").toLowerCase().trim()));
    if(!m && rows.length){ m = colMap(rows[0].map(x => x.toLowerCase())); rows = rows.slice(1); }
    if(!m) return [];
    return rows
      .map(r => ({n:pick(r,m.n), name:r[m.name], instrument:pick(r,m.instrument), type:pick(r,m.type), hotel:r[m.hotel],
                  pieces:pick(r,m.pieces), notes:pick(r,m.notes), from:pick(r,m.from), whatsapp:pick(r,m.whatsapp)}))
      .filter(p => p.name && p.name.toLowerCase()!=="name");
  }
  // repertoire → raw row arrays (header row kept — derive() locates it by the "Piece" cell)
  const repRows = gv => { const t = gv && gv.table; return t ? (t.rows||[]).map(r => (r.c||[]).map(c => c ? String(c.v ?? c.f ?? "").trim() : "")) : []; };

  const norm = s => (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\s+/g," ").trim();  // must match app.js norm() exactly
  const TAG = /\s*\((W1|W2)\)\s*$/i;
  // Join the repertoire to the roster: reconcile each Player token to a canonical roster name (exact
  // or unambiguous first name), and emit per person a sorted "piece (Wk) | …" string + norm(piece) →
  // {1,2} group letters. A piece's week comes from its (W1)/(W2) tag or, failing that, which Group
  // column it has; a per-player (W1)/(W2) tag overrides (subs). Returns unresolved tokens for the harness.
  function derive(people, rows){
    const out = { byPerson:{}, groups:{}, unresolved:[] };
    if(!(people||[]).length || !(rows||[]).length) return out;
    const names = new Set(people.map(p=>p.name)), byFirst = new Map();
    people.forEach(p=>{ const k=(p.name.split(/\s+/)[0]||"").toLowerCase(); (byFirst.get(k)||byFirst.set(k,[]).get(k)).push(p.name); });
    const reconcile = tok => { const t=(tok||"").replace(TAG,"").trim(); if(!t) return null;
      if(names.has(t)) return t; const f=byFirst.get(t.toLowerCase()); return (f&&f.length===1)?f[0]:null; };
    const hi = rows.findIndex(r => r.some(x => x.toLowerCase()==="piece")); if(hi<0) return out;
    const hdr = rows[hi].map(x=>x.toLowerCase());
    const pi = hdr.indexOf("piece"), g1i = hdr.findIndex(x=>x.includes("w1")), g2i = hdr.findIndex(x=>x.includes("w2"));
    let pcols = hdr.map((h,i)=>/^player/.test(h)?i:-1).filter(i=>i>=0);
    if(!pcols.length) pcols = hdr.map((_,i)=>i).filter(i=>i>pi);
    const set = {};
    for(const r of rows.slice(hi+1)){
      const raw=(r[pi]||"").trim(); if(!raw || raw.toLowerCase()==="piece") continue;
      const m=raw.match(TAG), base=raw.replace(TAG,"").trim();
      const g1=(g1i>=0?r[g1i]:"").trim(), g2=(g2i>=0?r[g2i]:"").trim();
      out.groups[norm(base)] = { 1:g1, 2:g2 };
      const pweek = m ? m[1].toUpperCase() : (g1&&!g2?"W1" : g2&&!g1?"W2" : "");
      for(const ci of pcols){ const tok=(r[ci]||"").trim(); if(!tok || tok==="None") continue;
        const c=reconcile(tok); if(!c){ out.unresolved.push(tok); continue; }
        const pm=tok.match(TAG), wk = pm ? pm[1].toUpperCase() : pweek;
        (set[c]||(set[c]=new Set())).add(base + (wk?` (${wk})`:""));
      }
    }
    for(const nm in set) out.byPerson[nm] = [...set[nm]].sort((a,b)=>{ const x=a.replace(TAG,"").toLowerCase(), y=b.replace(TAG,"").toLowerCase(); return x<y?-1:x>y?1:0; }).join(" | ");
    return out;
  }

  let _memo=null, _key="";                 // recompute only when a cache actually changed
  function derived(){
    let rr="", pr="";
    try{ rr=localStorage.getItem(KEY)||""; pr=localStorage.getItem(REPKEY)||""; }catch{}
    const key = rr.length+":"+pr.length;
    if(_memo && _key===key) return _memo;
    let people=null, rows=null;
    try{ people=JSON.parse(rr).people; }catch{}
    try{ rows=JSON.parse(pr).rows; }catch{}
    _memo = derive(people, rows); _key = key;
    return _memo;
  }
  const pieceGroups = () => derived().groups;   // norm(piece) → {1,2} group letters, for the schedule's byGroup

  function cached(){
    let people=null; try{ people=(JSON.parse(localStorage.getItem(KEY))||{}).people; }catch{ return null; }
    if(!people) return null;
    const by = derived().byPerson;                              // live pieces from the repertoire…
    return Object.keys(by).length ? people.map(p=>({...p, pieces: by[p.name]||""})) : people;   // …else fall back to the baked column
  }
  async function pull(){
    const people = parse(await jsonp(GID));                     // roster is required
    if(people.length){ try{ localStorage.setItem(KEY, JSON.stringify({people})); }catch{} }
    try{ const rows = repRows(await jsonp(REP_GID)); if(rows.length) localStorage.setItem(REPKEY, JSON.stringify({rows})); }catch{ /* keep the cached repertoire */ }
    _memo = null;                                               // invalidate the join
    return cached() || people;
  }
  g.Roster = { SID, GID, KEY, REP_GID, parse, cached, pull, me, setMe, hotelPoi, pieceGroups, derive };
  if(typeof module !== "undefined") module.exports = g.Roster;   // Node: schedule-test.js exercises derive()
})(typeof window !== "undefined" ? window : globalThis);
