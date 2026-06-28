// AKM — pure-pull briefing PWA. Fetches the live sheet (gviz JSONP) + Open-Meteo
// client-side, renders the card, caches the whole festival week for offline use.

const SID = "1AvNjAUQMFPjJAlwY4Day2MgHt5-2Vd8EDocpdxJQ6_A";
const LAT = 46.70, LON = 12.85, TZ = "Europe/Vienna";
const FEST = ["2026-06-29", "2026-07-12"];               // [start, end] inclusive
const ROOMS = new Set(["A1","A2","AH","KS","BAND ROOM","THEATRE","CHAPEL","WERNER"]);
const MINE = {"dvorak quartet":"dvorak","bruch octet":"bruch",
              "brahms piano quartet":"brahms","faure piano quartet":"faure"};
const MEET = /Participant Tour|Info Meeting|Informational Meeting|Festival Meeting|Festival Informational/;
const CK = "akm-cache";

const $ = s => document.querySelector(s);
const esc = s => (s||"").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const norm = s => s.toLowerCase().replace(/ř/g,"r").replace(/á/g,"a").replace(/é/g,"e").replace(/\s+/g," ").trim();
const despace = s => s.replace(/(?<!\S)(\S(?: \S){2,})(?!\S)/g, m => m.replace(/ /g,""));
const mins = t => { const [h,m]=t.split(":"); return +h*60 + +m; };
const iso = d => d.toISOString().slice(0,10);

function viennaToday(){
  const p = new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  return p; // "YYYY-MM-DD"
}
function festDays(){
  const out=[], d=new Date(FEST[0]+"T12:00:00"), end=new Date(FEST[1]+"T12:00:00");
  for(; d<=end; d.setDate(d.getDate()+1)) out.push(iso(d));
  return out;
}
function tabName(isoStr){
  const d=new Date(isoStr+"T12:00:00");
  return d.toLocaleDateString("en-US",{weekday:"short"}) + " " + (d.getMonth()+1) + "/" + d.getDate();
}

// ---- gviz JSONP (bypasses CORS for view-only public sheets) ----
function jsonp(isoStr){
  const name = encodeURIComponent(tabName(isoStr));
  return new Promise((res,rej)=>{
    const cb = "__gv"+Math.random().toString(36).slice(2);
    const s = document.createElement("script");
    const to = setTimeout(()=>{cleanup(); rej(new Error("timeout"));}, 15000);
    function cleanup(){ clearTimeout(to); delete window[cb]; s.remove(); }
    window[cb] = d => { cleanup(); res(d); };
    s.onerror = () => { cleanup(); rej(new Error("script")); };
    s.src = `https://docs.google.com/spreadsheets/d/${SID}/gviz/tq?sheet=${name}&tqx=out:json;responseHandler:${cb}`;
    document.head.appendChild(s);
  });
}
function rowsFrom(gv){
  const t = gv && gv.table; if(!t) return [];
  return t.rows.map(r => (r.c||[]).map(c => c ? String(c.v ?? c.f ?? "") : ""));
}

// ---- parse one day's grid ----
function parse(rows){
  let cols = {}; const day = {eyebrow:"", mine:[], meals:[], allhands:[], evening:[]};
  for(const raw of rows){
    const cells = raw.map(c => (c||"").trim());
    const joined = despace(cells.join(" "));
    if(joined.toUpperCase().includes("WEEK") && cells.join(" ").includes("|")){
      const m = joined.toUpperCase().match(/WEEK\s+\w+/); if(m) day.eyebrow = title(m[0].replace(/\s+/g," "));
    }
    const hits = cells.map((c,i)=>ROOMS.has(c)?i:-1).filter(i=>i>=0);
    if(hits.length>=3){ cols={}; hits.forEach(i=>cols[i]=cells[i]); continue; }
    let li=-1, lab="";
    for(let i=0;i<cells.length;i++){ const dl=despace(cells[i]); if(/\d{1,2}:\d{2}/.test(dl)){ li=i; lab=dl; break; } }
    if(li<0) continue;
    const tm = lab.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/) || lab.match(/(\d{1,2}:\d{2})/);
    const start=tm[1], end=tm[2]||"";
    const U = lab.toUpperCase();
    if(U.includes("LUNCH")||U.includes("DINNER")||U.includes("BREAKFAST")){
      const kind = U.includes("LUNCH")?"Lunch":U.includes("DINNER")?"Dinner":"Breakfast";
      const venue = lab.includes("@") ? lab.split("@")[1].trim() : "";
      day.meals.push([start,end,kind,venue]); continue;
    }
    const evening = U.includes("PRACTICE BLOCK") || U.includes("FREE READING");
    // all-hands meetings can sit above the first room grid (cols still empty), so match per-row
    const meet = cells.slice(li+1).filter(c => MEET.test(c));
    if(meet.length){ for(const c of meet) day.allhands.push([start,end,c.split("\n").map(x=>x.trim()).filter(Boolean).join(" "),""]); continue; }
    for(const i in cols){
      const cell = cells[+i] || ""; if(!cell) continue;
      const lines = cell.split("\n").map(x=>x.trim()).filter(Boolean);
      const text = lines.join(" ");
      const fac = /^faculty/i.test(text);
      let piece = text.replace(/^faculty\s+(rehearsal|reading)\s*/i,"").trim();
      let coach="", tag="";
      const mt = lines.length ? lines[lines.length-1].match(/^(.*?)\s*[-–]\s*([PC])\b/) : null;
      if(mt && !fac){ coach=mt[1].trim(); tag=mt[2]; piece=lines.slice(0,-1).join(" ").trim()||piece; }
      const key = Object.keys(MINE).find(k => norm(piece).includes(k));
      if(fac || evening){ day.evening.push([start,end,piece,cols[i],fac]); continue; }
      if(key && !fac) day.mine.push([start,end,piece,cols[i],coach,tag,MINE[key]]);
    }
  }
  const byT = a => mins(a[0]);
  day.mine.sort((a,b)=>byT(a)-byT(b)); day.meals.sort((a,b)=>byT(a)-byT(b)); day.allhands.sort((a,b)=>byT(a)-byT(b));
  return day;
}
const title = s => s.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());

// ---- weather ----
async function weatherRange(){
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`+
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,weathercode`+
    `&hourly=temperature_2m,precipitation,weathercode&temperature_unit=fahrenheit`+
    `&timezone=${encodeURIComponent(TZ)}&start_date=${FEST[0]}&end_date=${FEST[1]}`;
  const j = await (await fetch(u)).json();
  const out={}, H=j.hourly, D=j.daily;
  D.time.forEach((dt,di)=>{
    const s=di*24, t=H.temperature_2m.slice(s,s+24).map(Math.round);
    const pr=H.precipitation.slice(s,s+24), wc=H.weathercode.slice(s,s+24);
    if(t.length<24) return;
    let win=0,best=-1; for(let k=0;k<22;k++){const v=pr[k]+pr[k+1]+pr[k+2]; if(v>best){best=v;win=k;}}
    const rainy = pr.map((p,i)=>p>=0.2?i:-1).filter(i=>i>=0);
    out[dt] = {t, hi:Math.round(D.temperature_2m_max[di]), lo:Math.round(D.temperature_2m_min[di]),
      rise:D.sunrise[di].slice(11,16), set:D.sunset[di].slice(11,16),
      wet: pr.reduce((a,b)=>a+b,0)>0 ? `${String(win).padStart(2,"0")}–${String(win+3).padStart(2,"0")}h` : "",
      thunder: wc.some(c=>[95,96,99].includes(c)),
      shower: rainy.length ? [rainy[0], rainy[rainy.length-1]+1] : null, ok:true};
  });
  return out;
}

// ---- render (mirrors the template markup) ----
function svg(w){
  const t=w.t, W=340,H=86,L=12,R=328,T=12,B=60, lo=Math.min(...t)-3, hi=Math.max(...t)+4;
  const xat=h=>L+h/23*(R-L), yat=v=>B-(v-lo)/(hi-lo)*(B-T);
  const P=t.map((v,i)=>[xat(i),yat(v)]);
  let d=`M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  for(let i=0;i<P.length-1;i++){const a=P[i-1]||P[0],b=P[i],c=P[i+1],e=P[i+2]||P[P.length-1];
    d+=` C${(b[0]+(c[0]-a[0])/6).toFixed(1)} ${(b[1]+(c[1]-a[1])/6).toFixed(1)} ${(c[0]-(e[0]-b[0])/6).toFixed(1)} ${(c[1]-(e[1]-b[1])/6).toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`;}
  const hi_i=t.indexOf(Math.max(...t)), lo_i=t.indexOf(Math.min(...t));
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" font-family="'IBM Plex Mono',monospace"><defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#7E96A6"/><stop offset="0.5" stop-color="#C5792B"/><stop offset="1" stop-color="#7E96A6"/></linearGradient><linearGradient id="fg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#C5792B" stop-opacity="0.16"/><stop offset="1" stop-color="#C5792B" stop-opacity="0"/></linearGradient></defs>`;
  if(w.shower){const a=xat(w.shower[0]),b=xat(w.shower[1]);
    s+=`<rect x="${a.toFixed(1)}" y="${T}" width="${(b-a).toFixed(1)}" height="${B-T}" fill="#6E7D84" opacity="0.13"/><text x="${((a+b)/2).toFixed(1)}" y="${T+9}" font-size="7.5" fill="#6E7D84" text-anchor="middle" letter-spacing="0.5">SHOWERS</text>`;}
  s+=`<path d="${d} L${R} ${B} L${L} ${B} Z" fill="url(#fg)"/><path d="${d}" fill="none" stroke="url(#tg)" stroke-width="2.2" stroke-linecap="round"/>`;
  s+=`<circle cx="${xat(hi_i).toFixed(1)}" cy="${yat(t[hi_i]).toFixed(1)}" r="2.6" fill="#C5792B"/><text x="${xat(hi_i).toFixed(1)}" y="${(yat(t[hi_i])-6).toFixed(1)}" font-size="9" fill="#C5792B" text-anchor="middle" font-weight="500">H ${w.hi}°</text>`;
  s+=`<circle cx="${xat(lo_i).toFixed(1)}" cy="${yat(t[lo_i]).toFixed(1)}" r="2.6" fill="#7E96A6"/><text x="${xat(lo_i).toFixed(1)}" y="${(yat(t[lo_i])+13).toFixed(1)}" font-size="9" fill="#7E96A6" text-anchor="middle" font-weight="500">L ${w.lo}°</text>`;
  for(const [h,lab] of [[6,"6a"],[12,"12p"],[18,"6p"]]) s+=`<text x="${xat(h).toFixed(1)}" y="${B+13}" font-size="8" fill="#8A9A9B" text-anchor="middle">${lab}</text>`;
  return s+"</svg>";
}
function wxcard(w){
  if(!w||!w.ok) return `<div class="wx"><div class="wx-top"><div class="wx-sum"><b>Forecast unavailable.</b><br>schedule below.</div></div></div>`;
  const sub = w.thunder?"Thunderstorms possible":w.shower?"Showers possible":"Dry";
  const foot = w.wet ? `<div class="wx-foot"><span>Wettest <b>≈ ${w.wet}</b></span><span>Sun <b>↑ ${w.rise}</b> · <b>↓ ${w.set}</b></span></div>`
                     : `<div class="wx-foot"><span>Sun <b>↑ ${w.rise}</b> · <b>↓ ${w.set}</b></span></div>`;
  return `<div class="wx"><div class="wx-top"><div class="wx-temp">${w.hi}°<small> / ${w.lo}°F</small></div><div class="wx-sum"><b>${sub} in the afternoon.</b><br>light wind</div></div><div class="wx-curve">${svg(w)}</div>${foot}</div>`;
}
function tline(s,e){ return `<div class="time"><span class="s">${s}</span>${e?`<span class="e">${e}</span>`:""}</div>`; }
function timeline(day,w){
  const ev=[];
  for(const [s,e,piece] of day.allhands)
    ev.push([s,`<div class="row">${tline(s,e)}<div class="body ev"><span class="dot"></span><div class="tag">All welcome</div><div class="what">${esc(piece)}</div></div></div>`]);
  for(const [s,e,piece,room,coach,tag] of day.mine){
    const pc = tag==="P"?"Perform":tag==="C"?"Coach":"";
    const chip = room?`<span class="roomchip">${esc(room)}</span>`:"";
    const cw = coach?`<span class="coach">with <b>${esc(coach)}</b></span>`:"";
    ev.push([s,`<div class="row mine">${tline(s,e)}<div class="body"><span class="dot"></span><div class="card"><div class="kicker"><span>Your rehearsal</span><span class="pc">${pc}</span></div><div class="piece">${esc(piece)}</div><div class="meta">${chip}${cw}</div></div></div></div>`]);
  }
  for(const [s,e,kind,venue] of day.meals)
    ev.push([s,`<div class="row meal">${tline(s,e)}<div class="body"><span class="dot"></span><div class="what">${kind} · ${esc(venue)}</div></div></div>`]);
  if(day.evening.length){
    const s0 = day.evening.map(x=>x[0]).sort((a,b)=>mins(a)-mins(b))[0];
    const items=[], occ=[];
    for(const [s,e,piece,room,fac] of [...day.evening].sort((a,b)=>mins(a[0])-mins(b[0]))){
      if(/closed/i.test(piece)){ occ.push([room,"closed"]); continue; }
      if(!piece) continue;
      let flag = /quartet|langsamer satz/i.test(piece) ? `<span class="flag">String Quartet</span>` : "";
      if(Object.keys(MINE).some(k=>norm(piece).includes(k))) flag = `<span class="flag">Your piece</span>`;
      items.push(`<div class="mh-item"><span class="rm">${esc(room)}</span><span class="pl"><b>${esc(piece)}</b> <span class="who">· faculty</span></span>${flag}</div>`);
      occ.push([room,"faculty"]);
    }
    const taken = occ.filter(o=>o[1]==="faculty").map(o=>`<b>${o[0]}</b>`).join(" and ");
    const closed = occ.filter(o=>o[1]==="closed").map(o=>`<b>${o[0]}</b>`).join(", ");
    let note="Practice rooms open"; if(taken) note+=` except ${taken} (faculty)`; if(closed) note+=` and the ${closed} (closed)`; note+=" — sign up in the Akademie.";
    const mh = items.length?`<div class="meanwhile"><div class="mh-lab">Worth sitting in on</div>${items.join("")}</div>`:"";
    ev.push([s0,`<div class="row"><div class="time"><span class="s">${s0}</span></div><div class="body ev"><span class="dot"></span><div class="tag">Evening · your time</div><div class="what">Practice Block / Free Reading</div>${mh}<div class="roomnote">${note}</div></div></div>`]);
  }
  ev.sort((a,b)=>mins(a[0])-mins(b[0]));
  let out = ev.map(x=>x[1]);
  if(w&&w.ok&&(w.thunder||w.shower)){
    const aft = day.mine.filter(e=>mins(e[0])>=840);
    if(aft.length){
      const note=`<div class="wxnote">Showers${w.thunder?", maybe thunder,":","} building through the afternoon — umbrella, and a cloth for the violin.</div>`;
      const piece=aft[aft.length-1][2];
      for(let i=0;i<out.length;i++){ if(out[i].includes('class="row mine"') && out[i].includes(esc(piece))){ out.splice(i,0,note); break; } }
    }
  }
  return out.join("");
}
function coda(day,bank,dnum){
  const keys=[...new Set(day.mine.map(e=>e[6]))]; if(!keys.length) return "";
  const order=(arr)=>[...arr].sort((a,b)=>(a.tier==="sourced"?0:1)-(b.tier==="sourced"?0:1));
  const qc=keys[0], qs=order(bank[qc]?.quotes||[]);
  const q = qs.length ? qs[dnum % qs.length] : null;
  let out=`<div class="coda"><div class="coda-lab">Grace note</div>`;
  if(q) out+=`<div class="quote">${esc(q.text)}<span class="by">${esc(bank[qc].name)}</span><span class="prov">${esc(q.src)}</span></div>`;
  out+=`<div class="facts">`;
  for(const c of (keys.slice(1).length?keys.slice(1):keys)){
    const fs=order(bank[c]?.facts||[]); if(!fs.length) continue;
    const f=fs[dnum % fs.length];
    out+=`<div class="fact"><span class="ftag">${c.toUpperCase()}</span><span>${esc(f.text)} <span class="fsrc">${esc(f.src.split(";")[0])}</span></span></div>`;
  }
  return out+"</div></div>";
}
function masthead(isoStr,eyebrow){
  const d=new Date(isoStr+"T12:00:00");
  const dow=d.toLocaleDateString("en-US",{weekday:"long"});
  const dd=d.getDate(), mon=d.toLocaleDateString("en-US",{month:"long"});
  const n=Math.round((d-new Date(FEST[0]+"T12:00:00"))/864e5)+1;
  const eb = eyebrow ? (n>=1?`${eyebrow} · Day ${n}`:eyebrow) : "";
  return `<div class="masthead"><div class="eyebrow"><span>Daily Briefing</span><span>${esc(eb)}</span></div><h1 class="date"><span class="dow">${dow}</span>${dd} ${mon}</h1><div class="fest">AKM Chamber Music Festival</div></div>`;
}

// ---- cache + state ----
let BANK={}, sel=viennaToday();
const load = () => { try{return JSON.parse(localStorage.getItem(CK))||{}}catch{return {}} };
const save = c => { try{localStorage.setItem(CK,JSON.stringify(c))}catch{} };

function render(){
  const c=load(), day=c.sched&&c.sched[sel], w=c.wx&&c.wx[sel];
  const app=$("#app");
  if(!day){ app.innerHTML = masthead(sel,"") + `<div class="wx"><div class="wx-top"><div class="wx-sum"><b>Schedule not posted yet for this day.</b><br>${w?"forecast below.":"check back on wifi."}</div></div></div>` + (w?wxcard(w):""); return; }
  const dnum=Math.max(0,Math.round((new Date(sel+"T12:00:00")-new Date(FEST[0]+"T12:00:00"))/864e5));
  app.innerHTML = masthead(sel,day.eyebrow) + wxcard(w) + `<div class="tl">${timeline(day,w||{})}</div>` + coda(day,BANK,dnum);
  chips();
  const ts=c.ts?new Date(c.ts):null;
  const stale = ts && (Date.now()-ts.getTime() > 6*3600e3);
  $("#asof").innerHTML = ts ? `as of ${ts.toLocaleString("en-GB",{timeZone:TZ,weekday:"short",hour:"2-digit",minute:"2-digit"})}${stale?' · <span class="stale">stale</span>':''}` : "no data yet";
}
function chips(){
  const c=load(), box=$("#days"); box.innerHTML="";
  for(const day of festDays()){
    const d=new Date(day+"T12:00:00"), has=c.sched&&c.sched[day];
    const el=document.createElement("button");
    el.className="chip"+(day===sel?" on":"")+(has?"":" empty");
    el.textContent=d.toLocaleDateString("en-US",{weekday:"short",day:"numeric"});
    el.onclick=()=>{ sel=day; render(); };
    box.appendChild(el);
  }
}
function net(on){ const d=$("#netdot"); d.classList.toggle("off",!on); }

async function refresh(){
  net(navigator.onLine);
  if(!navigator.onLine) return;
  const c=load(); c.sched=c.sched||{}; c.wx=c.wx||{};
  try{ const wx=await weatherRange(); Object.assign(c.wx,wx); }catch(e){ /* keep old wx */ }
  for(const day of festDays()){
    try{ const rows=rowsFrom(await jsonp(day)); const p=parse(rows);
         if(p.mine.length||p.meals.length||p.allhands.length||p.evening.length) c.sched[day]=p; }
    catch(e){ /* keep old day */ }
  }
  c.ts=new Date().toISOString(); save(c); render();
}

// ---- boot ----
async function boot(){
  try{ BANK = await (await fetch("./composer-bank.json")).json(); }catch{ BANK={}; }
  render();                 // instant from cache (offline-safe)
  addEventListener("online", ()=>{net(true);refresh();});
  addEventListener("offline", ()=>net(false));
  refresh();                // stale-while-revalidate
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
if (typeof document !== "undefined") boot();
if (typeof module !== "undefined") module.exports = { parse, rowsFrom, mins, norm, despace };
