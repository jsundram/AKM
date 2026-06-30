// Shared roster data layer for both the schedule page (app.js) and the roster page (roster.html).
// One gviz JSONP pull, one header-tolerant parse, one localStorage cache (akm-roster) — so whichever
// page you open primes the other, and an offline roster page falls back to whatever the more-often-
// opened schedule page last cached. The roster sheet is separate + view-only; nothing is in the repo
// (PII), it just lives client-side. Loaded before app.js / the roster script, exposes window.Roster.
(function(g){
  const SID = "1j__RMUvFWQlX9UuT-Uxkw7BkqWHCQkbR_hKsTyNwiyo";
  const GID = "800090339";
  const KEY = "akm-roster";

  function jsonp(){
    return new Promise((res,rej)=>{
      const cb = "__r"+Math.random().toString(36).slice(2);
      const s = document.createElement("script");
      const to = setTimeout(()=>{ cleanup(); rej(new Error("timeout")); }, 15000);
      function cleanup(){ clearTimeout(to); delete g[cb]; s.remove(); }
      g[cb] = d => { cleanup(); res(d); };
      s.onerror = () => { cleanup(); rej(new Error("script")); };
      s.src = `https://docs.google.com/spreadsheets/d/${SID}/gviz/tq?gid=${GID}&tqx=out:json;responseHandler:${cb}`;
      document.head.appendChild(s);
    });
  }
  // map columns by header name — gviz header detection is flaky: sometimes it labels the cols,
  // sometimes it dumps the header into row 0 with blank labels. Try the labels, else fall back to row 0.
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

  const cached = () => { try{ const c=JSON.parse(localStorage.getItem(KEY)); return (c&&c.people)||null; }catch{ return null; } };
  async function pull(){
    const people = parse(await jsonp());
    if(people.length){ try{ localStorage.setItem(KEY, JSON.stringify({people})); }catch{} }
    return people;
  }
  g.Roster = { SID, GID, KEY, parse, cached, pull };
})(window);
