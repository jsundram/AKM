// Regenerates the baked DATA blob in prototype/festival-time.html — the "Festival Time" dashboard.
// Run from repo root:  node scripts/festival-time-crunch.js
//
// PROTOTYPE provenance. It reuses the app's OWN personalization (mineOf / dressOf / lessonsOf /
// coachingOf / teachingOf / myConcertPieces) so the dashboard can't drift from what the schedule shows,
// then tallies each category's minutes for one participant (default: Jason) across the whole festival,
// plus the festival-wide rehearsal averages for context. It prints the DATA object to paste into the
// page — only aggregate MINUTES leave here (no names, lodging, or phones), so the blob is PII-safe.
//
// Network-gated like the other live smokes (schedule-test / dress-test): public gviz, no auth, so any
// box with outbound HTTPS runs it — unreachable sheets (offline / locked-down sandbox) → SKIP (exit 0).
// The roster is PII, so there are deliberately no committed fixtures to fall back to.
require("../roster-data.js");                    // globalThis.Roster — repertoire join + the shared matcher
require("../concert-data.js");                   // globalThis.Concerts — the program dressOf/myConcertPieces resolve against
const C = require("../app.js");
const RD = require("../roster-data.js");
const https = require("https");
const RSID = "1j__RMUvFWQlX9UuT-Uxkw7BkqWHCQkbR_hKsTyNwiyo";
const SSID = "1AvNjAUQMFPjJAlwY4Day2MgHt5-2Vd8EDocpdxJQ6_A";
const FEST = ["2026-06-29", "2026-07-12"];
const WHO = process.argv[2] || "Jason Sundram";
const CONCERT_MIN = 90;                           // nominal chamber-concert length — a stated assumption
const WK2_START = "2026-07-06";                   // wk1 6/29–7/5, wk2 7/6–7/12

const get = u => new Promise((res, rej) =>
  https.get(u, r => { let d=""; r.on("data",c=>d+=c); r.on("end",()=>res(d)); }).on("error",rej));
const url = (sid,q) => `https://docs.google.com/spreadsheets/d/${sid}/gviz/tq?tqx=out:json&${q}`;
const unwrap = t => JSON.parse(t.slice(t.indexOf("(")+1, t.lastIndexOf(")"))).table;
const cells = t => (t.rows||[]).map(r => (r.c||[]).map(c => c ? String(c.v ?? c.f ?? "").trim() : ""));
const mins = t => { const [h,m]=t.split(":"); return +h*60 + +m; };
const dur = r => r[1] ? Math.max(0, mins(r[1])-mins(r[0])) : 0;
function header(t, rows){
  let h=(t.cols||[]).map(c=>(c.label||"").toLowerCase()), s=0;
  if(!h.includes("name")&&!h.includes("piece")){ const i=rows.findIndex(r=>r.some(x=>/^(name|piece)$/i.test(x))); h=(rows[i]||[]).map(x=>x.toLowerCase()); s=i+1; }
  return {h,s};
}
function festTabs(){
  const out=[], d=new Date(FEST[0]+"T12:00:00"), end=new Date(FEST[1]+"T12:00:00");
  for(; d<=end; d.setDate(d.getDate()+1))
    out.push({ tab:d.toLocaleDateString("en-US",{weekday:"short"})+" "+(d.getMonth()+1)+"/"+d.getDate(),
               date:d.toISOString().slice(0,10) });
  return out;
}
const CATS = ["rehearsal","dress","lesson","coach","teach","perform","attend"];

(async () => {
  let rosterRaw, repRaw;
  try { rosterRaw = await get(url(RSID,"gid=800090339")); repRaw = await get(url(RSID,"gid=244347893")); }
  catch(e){ console.log("skipped — sheets unreachable ("+e.message+")"); process.exit(0); }

  const rt=unwrap(rosterRaw), rr=cells(rt), {h:rh,s:rs}=header(rt,rr), gi=k=>rh.indexOf(k);
  let people = rr.slice(rs).filter(r=>r[gi("name")]).map(r=>({
    name:r[gi("name")], type:r[gi("type")], instrument:r[gi("instrument")],
    pieces:"", notes:r[gi("notes")], hotel:r[gi("hotel")] }));
  const D = RD.derive(people, cells(unwrap(repRaw)));
  people = people.map(p=>({ ...p, pieces:D.byPerson[p.name]||"" }));
  globalThis.Roster.cached = () => people;         // prime the shared matcher (localStorage is empty in Node)
  const ctx = new Map(people.map(p=>[p.name, C.userCtx(people, p.name, D.groups)]));

  const days={};
  for(const {tab,date} of festTabs()){ try{ days[date]=C.parse(C.rowsFrom({table:unwrap(await get(url(SSID,"sheet="+encodeURIComponent(tab))))})); }catch{} }
  const dateList = Object.keys(days).sort();
  const concerts = globalThis.Concerts.all.filter(c=>c.id.slice(0,10)>=FEST[0]&&c.id.slice(0,10)<=FEST[1]);
  const cwk = date => date < WK2_START ? 1 : 2;

  function tally(name){
    const u = ctx.get(name); if(!u) return null;
    const t = { name, week:u.week, blocks:0, pieces:new Set(), rooms:new Set(), coaches:new Set(),
                byCat:{}, byWeek:{1:{},2:{}}, byDay:{} };
    CATS.forEach(c=>{ t.byCat[c]=0; t.byWeek[1][c]=0; t.byWeek[2][c]=0; });
    dateList.forEach(d=>{ t.byDay[d]={}; CATS.forEach(c=>t.byDay[d][c]=0); });
    for(const [date,day] of Object.entries(days)){
      const wk = cwk(date);
      const add=(cat,m)=>{ t.byCat[cat]+=m; t.byWeek[wk][cat]+=m; t.byDay[date][cat]+=m; };
      for(const r of C.mineOf(day,u)){ add("rehearsal",dur(r)); t.blocks++; t.pieces.add(r[2]);
        if(r[3])t.rooms.add(r[3]);
        if(r[4]) r[4].split(/[\/&,]| and /).forEach(x=>{ x=x.replace(/\b(1st|2nd|first|second|half|P|C)\b/gi,"").replace(/[-()]/g,"").trim(); if(x)t.coaches.add(x); }); }
      for(const r of C.dressOf(day,u,date)) add("dress",dur(r));
      for(const r of C.lessonsOf(day,u)) add("lesson",dur(r)||30);
      for(const r of C.coachingOf(day,u)) add("coach",dur(r));
      for(const r of C.teachingOf(day,u)) add("teach",dur(r)||30);
    }
    for(const c of concerts){
      const cw=cwk(c.id.slice(0,10)), date=c.id.slice(0,10);
      if(u.week && u.week!==cw) continue;                            // not at the festival that week
      const cat = C.myConcertPieces(c,u).length ? "perform" : "attend";
      t.byCat[cat]+=CONCERT_MIN; t.byWeek[cw][cat]+=CONCERT_MIN;
      if(t.byDay[date]) t.byDay[date][cat]+=CONCERT_MIN;
    }
    t.pieces=[...t.pieces]; t.rooms=[...t.rooms]; t.coaches=[...t.coaches];
    return t;
  }

  const all = people.map(p=>tally(p.name)).filter(Boolean);
  const me = all.find(x=>x.name===WHO);
  if(!me){ console.log(`"${WHO}" not on the roster — pass an exact name as argv[2]`); process.exit(1); }

  const avg = a => a.length ? Math.round(a.reduce((x,y)=>x+y,0)/a.length) : 0;
  const players = all.filter(a=>a.byCat.rehearsal>0);

  // fold coach+teach into one "coach" (faculty duties) slice, matching the page's 6-category display
  const fold = o => ({ rehearsal:o.rehearsal, dress:o.dress, lesson:o.lesson, coach:o.coach+o.teach, perform:o.perform, attend:o.attend });
  const dayRow = d => { const b=me.byDay[d]; return [d.slice(5), "", b.rehearsal, b.dress, b.lesson, b.perform, b.attend]; };

  const blob = {
    who: WHO.split(" ")[0], generated: FEST /* stamp by hand */ , concertMin: CONCERT_MIN,
    total: fold(me.byCat),
    week: { 1: fold(me.byWeek[1]), 2: fold(me.byWeek[2]) },
    days: dateList.map(dayRow),
    concerts: { total: concerts.length,
                performed: concerts.filter(c=>C.myConcertPieces(c,ctx.get(WHO)).length).length,
                attended: concerts.length - concerts.filter(c=>C.myConcertPieces(c,ctx.get(WHO)).length).length },
    ctx: { nPlayers: players.length,
           avgRehW1: avg(players.map(p=>p.byWeek[1].rehearsal)), avgRehW2: avg(players.map(p=>p.byWeek[2].rehearsal)),
           moreWk1: players.filter(p=>p.byWeek[1].rehearsal>p.byWeek[2].rehearsal).length,
           youRehW1: me.byWeek[1].rehearsal, youRehW2: me.byWeek[2].rehearsal },
    footprint: { pieces: me.pieces.length, rooms: me.rooms.length, coaches: me.coaches.length, blocks: me.blocks },
  };
  console.log("// paste into prototype/festival-time.html (weekday labels + `days[][1]` filled by hand):");
  console.log(JSON.stringify(blob, null, 2));
})();
