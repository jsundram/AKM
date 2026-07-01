// AKM — pure-pull briefing PWA. Fetches the live sheet (gviz JSONP) + Open-Meteo
// client-side, renders the card, caches the whole festival week for offline use.

const SID = "1AvNjAUQMFPjJAlwY4Day2MgHt5-2Vd8EDocpdxJQ6_A";
// tab → gid, so the footer can deep-link to the day's actual sheet tab. gids are stable per
// tab; probed from the sheet's htmlview (can't be fetched cross-origin at runtime). Sundays off.
const GID = {"Mon 6/29":"1079055190","Tue 6/30":"385081621","Wed 7/1":"1231106928",
  "Thu 7/2":"140636796","Fri 7/3":"1941915385","Sat 7/4":"1201647531",
  "Mon 7/6":"1017105753","Tue 7/7":"839058497","Wed 7/8":"600713019",
  "Thu 7/9":"636626947","Fri 7/10":"1243481570","Sat 7/11":"1506438549"};
let LAT = 46.6928, LON = 12.8166;        // forecast point: the Kultursaal venue; refined from its map-data POI in loadPlaces
const TZ = "Europe/Vienna";
const FEST = ["2026-06-29", "2026-07-12"];               // [start, end] inclusive
const ROOMS = new Set(["A1","A2","AH","KS","BAND ROOM","THEATRE","CHAPEL","WERNER"]);
const MINE = {"dvorak quartet":"dvorak","bruch octet":"bruch",
              "brahms piano quartet":"brahms","faure piano quartet":"faure"};
const ME = /\bjason\b/i;     // his name in a private-lessons slot → surface it, emphasized
const MEET = /Participant Tour|Info Meeting|Informational Meeting|Festival Meeting|Festival Informational/;
const CK = "akm-cache";

const $ = s => document.querySelector(s);
const esc = s => (s||"").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const norm = s => s.toLowerCase().replace(/ř/g,"r").replace(/á/g,"a").replace(/é/g,"e").replace(/\s+/g," ").trim();
const despace = s => s.replace(/(?<!\S)(\S(?: \S){2,})(?!\S)/g, m => m.replace(/ /g,""));
const mins = t => { const [h,m]=t.split(":"); return +h*60 + +m; };
const hhmm = m => `${Math.floor(m/60)}:${String(m%60).padStart(2,"0")}`;
const iso = d => d.toISOString().slice(0,10);

function viennaToday(){
  const p = new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  return p; // "YYYY-MM-DD"
}
// current festival-time clock as a fractional hour (0–24), so the "now" marker is right even
// when viewed from another timezone (family checking in from home). Not the browser's hour.
function viennaNowH(){
  const p = new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
  const g = t => +p.find(x=>x.type===t).value;
  return (g("hour")%24) + g("minute")/60;
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
function sheetUrl(isoStr){
  const b=`https://docs.google.com/spreadsheets/d/${SID}`, g=GID[tabName(isoStr)];
  return g ? `${b}/edit?gid=${g}#gid=${g}` : `${b}/edit`;   // fall back to the workbook if no tab
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

// derive coach first-name → bio URL from the shared roster (Roster.cached()); faculty are the only
// URL-holders and don't share a first name, so the first-name match is unambiguous.
function coachMap(people){
  const out = {};
  for(const p of (people||[])){
    const u = (String(p.notes||"").match(/https?:\/\/[^\s]+/)||[])[0]; if(!p.name || !u) continue;
    out[p.name.split(/[\s,]/)[0].toLowerCase()] = u.replace(/[),.]+$/,"");
  }
  return out;
}

// ---- parse one day's grid ----
function parse(rows){
  let cols = {}; const day = {eyebrow:"", mine:[], meals:[], allhands:[], evening:[], lessons:[], rooms:[], evLabels:{}};
  for(const raw of rows){
    const cells = raw.map(c => (c||"").trim());
    const joined = despace(cells.join(" "));
    if(joined.toUpperCase().includes("WEEK") && cells.join(" ").includes("|")){
      const m = joined.toUpperCase().match(/WEEK\s+\w+/); if(m) day.eyebrow = title(m[0].replace(/\s+/g," "));
    }
    const hits = cells.map((c,i)=>ROOMS.has(c)?i:-1).filter(i=>i>=0);
    // keep the most complete header's room list as the practice-room universe (free-room calc)
    if(hits.length>=3){ cols={}; hits.forEach(i=>cols[i]=cells[i]); if(hits.length>day.rooms.length) day.rooms=hits.map(i=>cells[i]); continue; }
    // private-lessons blocks: a coach + half-hour slots ("HH:MM - Student"). The block sits in the
    // dedicated LESSONS column some rows, but gets shoved into an unused room column (e.g. WERNER)
    // others — so match by content, not position. Usually not his; but when his name is in a slot
    // it's a focused commitment, so pull just those out, emphasized.
    cells.forEach((cell,ci)=>{
      if(!/private\s+lesson/i.test(cell)) return;
      const ll = cell.split("\n").map(x=>x.trim()).filter(Boolean);
      const coach = ll.find(x=>!/private\s+lesson/i.test(x) && !/^\d{1,2}:\d{2}/.test(x)) || "";
      const room = cols[ci] || "";   // the room it's parked in (WERNER, etc.) — where to actually show up
      for(const line of ll){ const m=line.match(/^(\d{1,2}:\d{2})\s*-\s*(.+)$/);
        if(m && ME.test(m[2])) day.lessons.push([m[1], hhmm(mins(m[1])+30), coach, room]); }
    });
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
    if(evening) day.evLabels[start] = lab.split("\n").slice(1).join(" ").trim();
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
      if(fac || evening){
        const kind = fac ? "faculty" : /private\s+lesson/i.test(text) ? "lessons" : /closed/i.test(piece) ? "closed" : "other";
        day.evening.push([start,end,piece,cols[i],kind]); continue;
      }
      if(key && !fac) day.mine.push([start,end,piece,cols[i],coach,tag,MINE[key]]);
    }
  }
  const byT = a => mins(a[0]);
  day.mine.sort((a,b)=>byT(a)-byT(b)); day.meals.sort((a,b)=>byT(a)-byT(b));
  day.allhands.sort((a,b)=>byT(a)-byT(b)); day.lessons.sort((a,b)=>byT(a)-byT(b));
  return day;
}
const title = s => s.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());

// ---- weather ----
const skyName = c => c===0?"Clear":c===1?"Mostly clear":c===2?"Partly cloudy":c===3?"Overcast":(c===45||c===48)?"Fog":"Cloudy";
// Forecast source: GeoSphere Austria's seamless model (AROME 2.5km for the first ~60h, ECMWF IFS
// beyond) resolves this Alpine valley far better than a coarse global model, and covers the whole
// festival. Fall back to Open-Meteo's best-match blend if it's ever unavailable. The active source
// is tagged per day (w.src) and cited in the weather card.
const WX_SRC = { geosphere: "GeoSphere Austria · AROME + ECMWF", default: "Open-Meteo · best match" };
async function fetchWx(models){
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`+
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,weathercode`+
    `&hourly=temperature_2m,precipitation,weathercode&current=temperature_2m&temperature_unit=fahrenheit`+
    `&timezone=${encodeURIComponent(TZ)}&start_date=${FEST[0]}&end_date=${FEST[1]}`+
    (models?`&models=${models}`:``);
  const j = await (await fetch(u)).json();
  if(j.error) throw new Error(j.reason||"open-meteo error");
  const out={}, H=j.hourly, D=j.daily;
  D.time.forEach((dt,di)=>{
    const s=di*24, raw=H.temperature_2m.slice(s,s+24);
    if(raw.length<24 || raw.some(v=>v==null)) return;       // skip incomplete days (e.g. past a model's horizon)
    const t=raw.map(Math.round), pr=H.precipitation.slice(s,s+24), wc=H.weathercode.slice(s,s+24);
    const rainy = pr.map((p,i)=>p>=0.2?i:-1).filter(i=>i>=0);
    const sum = pr.reduce((a,b)=>a+b,0);
    out[dt] = {t, hi:Math.round(D.temperature_2m_max[di]), lo:Math.round(D.temperature_2m_min[di]),
      rise:D.sunrise[di].slice(11,16), set:D.sunset[di].slice(11,16),
      thunder: wc.some(c=>[95,96,99].includes(c)),
      shower: rainy.length ? [rainy[0], rainy[rainy.length-1]+1] : null,
      drizzle: !rainy.length && sum>0,           // measurable precip below the showers threshold
      sky: skyName(D.weathercode[di]), ok:true};
  });
  // live "current" reading (one value for now); pin it to today so the now-marker can prefer it
  const C=j.current;
  if(C && C.temperature_2m!=null && out[C.time.slice(0,10)]){
    Object.assign(out[C.time.slice(0,10)], {cur:Math.round(C.temperature_2m), curAt:C.time});
  }
  return out;
}
async function weatherRange(){
  for(const [m,key] of [["geosphere_seamless","geosphere"],["","default"]]){
    try{ const days=await fetchWx(m);
      if(Object.keys(days).length){ for(const k in days) days[k].src=WX_SRC[key]; return days; }
    }catch(e){ /* fall through to the next source */ }
  }
  return {};
}

// ---- render (mirrors the template markup) ----
function svg(w,now,cur){
  const t=w.t, W=340,H=86,L=12,R=328,T=12,B=60;
  const dom = cur!=null ? t.concat(cur) : t;   // keep an off-curve live dot in frame
  const lo=Math.min(...dom)-3, hi=Math.max(...dom)+4;
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
  s+=`<circle cx="${xat(lo_i).toFixed(1)}" cy="${yat(t[lo_i]).toFixed(1)}" r="2.6" fill="#7E96A6"/><text x="${xat(lo_i).toFixed(1)}" y="${(yat(t[lo_i])-6).toFixed(1)}" font-size="9" fill="#7E96A6" text-anchor="middle" font-weight="500">L ${w.lo}°</text>`;
  // daylight bounds: dotted vertical + sun glyph (top) + time (axis) at sunrise/sunset
  const hm=t=>{const[a,b]=t.split(":").map(Number);return a+b/60;};
  const tl=t=>t.replace(/^0/,"");
  if(w.rise&&w.set) for(const tt of [w.rise,w.set]){ const x=xat(hm(tt));
    s+=`<line x1="${x.toFixed(1)}" y1="${T+1}" x2="${x.toFixed(1)}" y2="${B+2}" stroke="#C9943A" stroke-width="0.7" stroke-dasharray="1.6 2" opacity="0.5"/>`;
    s+=`<text x="${x.toFixed(1)}" y="${T+7}" font-size="9" fill="#C9943A" text-anchor="middle">☀︎</text>`;
    s+=`<text x="${x.toFixed(1)}" y="${B+13}" font-size="8" fill="#C9943A" text-anchor="middle">${tl(tt)}</text>`;
  }
  s+=`<text x="${xat(12).toFixed(1)}" y="${B+13}" font-size="8" fill="#8A9A9B" text-anchor="middle">12p</text>`;
  // "now" marker: vertical guide + a dot on the curve at the current festival hour (today only)
  if(now!=null && now>=0 && now<=23){ const x=xat(now);
    const i=Math.floor(now), f=now-i, tv=t[i]+((t[Math.min(i+1,23)]-t[i])*f);
    const temp = cur!=null ? cur : tv, y=yat(temp);   // live reading if fresh, else the curve
    if(cur!=null && Math.abs(cur-tv)>=1)              // faint tick where the hourly forecast sits, for contrast
      s+=`<circle cx="${x.toFixed(1)}" cy="${yat(tv).toFixed(1)}" r="2" fill="none" stroke="#566069" stroke-width="1" opacity="0.4"/>`;
    s+=`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${B}" stroke="#566069" stroke-width="1" opacity="0.55"/>`;
    s+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#566069" stroke="#fff" stroke-width="1.4"/>`;
    s+=`<text x="${x.toFixed(1)}" y="${Math.max(y-7,9).toFixed(1)}" font-size="9" fill="#566069" text-anchor="middle" font-weight="600">${Math.round(temp)}°</text>`;
  }
  return s+"</svg>";
}
function wxcard(w,now,cur){
  if(!w||!w.ok) return `<div class="wx"><div class="wx-top"><div class="wx-sum"><b>Forecast unavailable.</b><br>schedule below.</div></div></div>`;
  const precip = w.thunder?"Thunderstorms possible":w.shower?"Showers possible":w.drizzle?"Drizzle possible":"";
  const sub = precip ? `${precip} in the afternoon.` : `${w.sky||"Dry"}.`;
  const src = w.src ? `<div class="wx-src">forecast via ${w.src}</div>` : "";
  return `<div class="wx"><div class="wx-top"><div class="wx-temp">${w.hi}°<small> / ${w.lo}°F</small></div><div class="wx-sum"><b>${sub}</b><br>light wind</div></div><div class="wx-curve">${svg(w,now,cur)}</div>${src}</div>`;
}
// places that exist on the offline map (POI names + room-code aliases, from map-data.json) become
// "→ map" links; everything else stays plain text. Same source of truth the map itself uses.
let PLACES = new Set();
async function loadPlaces(){
  try{ const d=await (await fetch("./map-data.json")).json();
    for(const p of d.pois){ PLACES.add(p.name.toLowerCase()); (p.aliases||[]).forEach(a=>PLACES.add(a.toLowerCase())); }
    const m=d.meta||{}, b=m.bbox, k=d.pois.find(p=>p.name==="Kultursaal");   // forecast at the Kultursaal venue: invert its POI xy → lat/lon
    if(b&&k){ LAT=b[2]-(k.xy[1]/m.h)*(b[2]-b[0]); LON=b[1]+(k.xy[0]/m.w)*(b[3]-b[1]); }
  }catch{ /* offline + uncached: links just won't render until the map data is around */ }
}
const PIN = '<svg class="pin" viewBox="0 0 24 24" width="9" height="9" aria-hidden="true"><path fill="currentColor" d="M12 2C8.1 2 5 5.1 5 9c0 5 7 13 7 13s7-8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
const mapped = label => PLACES.has((label||"").toLowerCase());
const mapHref = label => `./map.html#${encodeURIComponent(label)}`;
const placeChip = (room,cls="roomchip") => mapped(room)
  ? `<a class="${cls} maplink" href="${mapHref(room)}">${esc(room)}${PIN}</a>`
  : `<span class="${cls}">${esc(room)}</span>`;
const placeText = label => mapped(label)
  ? `<a class="maplink" href="${mapHref(label)}">${esc(label)}${PIN}</a>` : esc(label);

function tline(s,e){ return `<div class="time"><span class="s">${s}</span>${e?`<span class="e">${e}</span>`:""}</div>`; }
// a coach with a bio URL in the roster → link the name, so you can get a refresher on who's coaching
// you. A slot can name two coaches ("Gijs/Nathan", "Smith & Jones") — link each one independently.
function coachLink(coach){
  const html = (coach||"").split(/(\s*[\/&,]\s*|\s+and\s+)/).map(tok => {
    if(!tok.trim() || /^(\s*[\/&,]\s*|\s+and\s+)$/.test(tok)) return esc(tok);   // separator, kept verbatim
    const u = COACHES[tok.trim().split(/\s+/)[0].toLowerCase()];
    return u ? `<a class="coachlink" href="${u}" target="_blank" rel="noopener">${esc(tok)}</a>` : esc(tok);
  }).join("");
  return `<b>${html}</b>`;
}
// group evening practice/reading rows into per-block sections (pre- and post-dinner differ in what's
// booked) — each with its faculty "worth sitting in on" items and the rooms left unbooked
function evblocks(day){
  const map=new Map();
  for(const e of day.evening){ const s=e[0]; if(!map.has(s)) map.set(s,[]); map.get(s).push(e); }
  return [...map].sort((a,b)=>mins(a[0])-mins(b[0])).map(([s,entries])=>{
    const items=[], booked=new Set(), closed=new Set();
    for(const [,, piece, room, kind] of entries){
      const fac = kind===true || kind==="faculty";          // tolerate pre-kind cached days (5th was a bool)
      if(kind==="closed" || /closed/i.test(piece)){ closed.add(room); continue; }
      if(kind==="lessons"){ booked.add(room); continue; }   // a coach's private lessons — room's taken, not a draw
      if(!piece) continue;
      booked.add(room); if(fac) items.push({room,piece});
    }
    const free=(day.rooms||[]).filter(r=>!booked.has(r) && !closed.has(r));
    return {s, e:entries[0][1], label:(day.evLabels||{})[s]||"Practice Block / Free Reading", items, free, closed:[...closed]};
  });
}
function timeline(day,w){
  const ev=[];
  for(const [s,e,piece] of day.allhands)
    ev.push([s,`<div class="row">${tline(s,e)}<div class="body ev"><span class="dot"></span><div class="tag">All welcome</div><div class="what">${esc(piece)}</div></div></div>`]);
  for(const [s,e,piece,room,coach,tag] of day.mine){
    const pc = tag==="P"?"Coach plays":tag==="C"?"Coach observes":"";   // sheet tag: P = coach plays in the rehearsal, C = coach observes only
    const chip = room?placeChip(room):"";
    const cw = coach?`<span class="coach">with ${coachLink(coach)}</span>`:"";
    ev.push([s,`<div class="row mine">${tline(s,e)}<div class="body"><span class="dot"></span><div class="card"><div class="kicker"><span>Your rehearsal</span><span class="pc">${pc}</span></div><div class="piece">${esc(piece)}</div><div class="meta">${chip}${cw}</div></div></div></div>`]);
  }
  for(const [s,e,coach,room] of day.lessons||[]){
    const cw = coach?`<span class="coach">with ${coachLink(coach)}</span>`:"";
    const chip = placeChip(room||"LESSONS");
    ev.push([s,`<div class="row mine">${tline(s,e)}<div class="body"><span class="dot"></span><div class="card"><div class="kicker"><span>Your private lesson</span><span class="pc">be ready</span></div><div class="piece">Private lesson</div><div class="meta">${chip}${cw}</div></div></div></div>`]);
  }
  for(const [s,e,kind,venue] of day.meals)
    ev.push([s,`<div class="row meal">${tline(s,e)}<div class="body"><span class="dot"></span><div class="what">${kind} · ${placeText(venue)}</div></div></div>`]);
  for(const b of evblocks(day)){
    const items = b.items.map(({room,piece})=>{
      // descriptive only — never tag a faculty reading "Your piece": faculty play repertoire that
      // overlaps the participants' by name without being his exact piece (e.g. the faculty Fauré).
      const flag = /quartet|langsamer satz/i.test(piece) ? `<span class="flag">String Quartet</span>` : "";
      return `<div class="mh-item">${placeChip(room,"rm")}<span class="pl"><b>${esc(piece)}</b> <span class="who">· faculty</span></span>${flag}</div>`;
    });
    const mh = items.length?`<div class="meanwhile"><div class="mh-lab">Worth sitting in on</div>${items.join("")}</div>`:"";
    // (day.rooms is absent only on a pre-upgrade cached day — skip the room tally until the refresh lands)
    let note = !(day.rooms||[]).length ? "Practice rooms"
      : b.free.length ? `<b>Free rooms:</b> ${b.free.map(r=>esc(r)).join(", ")}` : "All rooms booked";
    if(b.closed.length) note += ` · ${b.closed.map(r=>esc(r)).join(", ")} closed`;
    note += " — sign up in the Akademie.";
    ev.push([b.s,`<div class="row"><div class="time"><span class="s">${b.s}</span></div><div class="body ev"><span class="dot"></span><div class="tag">Evening · your time</div><div class="what">${esc(b.label)}</div>${mh}<div class="roomnote">${note}</div></div></div>`]);
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
  return `<div class="masthead"><div class="eyebrow"><span>Daily Briefing</span><span>${esc(eb)}</span></div><h1 class="date"><span class="dow">${dow}</span>${dd} ${mon}</h1></div>`;
}

// freshness line for the schedule section: cache timestamp (festival time), online dot, stale flag
function asofText(c){
  if(!c.ts) return navigator.onLine ? "loading…" : "no data yet";
  const ts=new Date(c.ts), stale=Date.now()-ts.getTime()>6*3600e3;
  return `as of ${ts.toLocaleString("en-GB",{timeZone:TZ,weekday:"short",hour:"2-digit",minute:"2-digit"})}${stale?' · <span class="stale">stale</span>':''}`;
}
// schedule section header: rule + label, with the freshness/online dot/source link in context
function schedHead(c){
  return `<div class="tl-head"><span class="tl-title">Schedule</span><span class="tl-meta">`
    + `<span class="netdot${navigator.onLine?'':' off'}" id="netdot"></span>`
    + `<span id="asof">${asofText(c)}</span> · `
    + `<a href="${sheetUrl(sel)}" target="_blank" rel="noopener">source sheet ↗</a></span></div>`;
}

// ---- cache + state ----
let BANK={}, COACHES={}, today=viennaToday(), sel=today;
const load = () => { try{return JSON.parse(localStorage.getItem(CK))||{}}catch{return {}} };
const save = c => { try{localStorage.setItem(CK,JSON.stringify(c))}catch{} };

function render(){
  const c=load(), day=c.sched&&c.sched[sel], w=c.wx&&c.wx[sel];
  const now = sel===viennaToday() ? viennaNowH() : null;   // "now" marker on today's curve only
  // prefer the live "current" reading for the now-dot, but only while it's actually current
  const cur = (now!=null && w && w.cur!=null && w.curAt && w.curAt.slice(0,10)===sel
    && Math.abs(now - (+w.curAt.slice(11,13) + +w.curAt.slice(14,16)/60)) < 1.5) ? w.cur : null;
  COACHES = coachMap(Roster.cached());
  const app=$("#app");
  if(!day){
    const fetching = navigator.onLine && !c.ts;       // first load, refresh still in flight
    const head = fetching ? "<b>Loading today's schedule…</b><br>fetching the live sheet."
      : navigator.onLine ? `<b>Schedule not posted yet for this day.</b><br>${w?"forecast above.":"check back later."}`
      : `<b>You're offline.</b><br>${w?"showing cached forecast.":"reconnect to load this day."}`;
    app.innerHTML = masthead(sel,"") + (w?wxcard(w,now,cur):"") + schedHead(c) + `<div class="tl-empty">${head}</div>`;
    chips();
    return;
  }
  const dnum=Math.max(0,Math.round((new Date(sel+"T12:00:00")-new Date(FEST[0]+"T12:00:00"))/864e5));
  app.innerHTML = masthead(sel,day.eyebrow) + wxcard(w,now,cur) + schedHead(c) + `<div class="tl">${timeline(day,w||{})}</div>` + coda(day,BANK,dnum);
  chips();
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
function net(on){ const d=$("#netdot"); if(d) d.classList.toggle("off",!on); }   // #netdot lives in the rendered schedule header

// pull-to-refresh — standalone iOS (home-screen card) has no browser reload
function setupPTR(){
  const ptr=$("#ptr"), TH=64; let y0=null, pull=0, busy=false;
  const reset=()=>{ ptr.classList.add("snap"); ptr.style.height="0"; y0=null; pull=0; };
  addEventListener("touchstart", e=>{ if(scrollY<=0 && !busy){ y0=e.touches[0].clientY; pull=0; ptr.classList.remove("snap"); } }, {passive:true});
  addEventListener("touchmove", e=>{
    if(y0==null) return;
    pull = e.touches[0].clientY - y0;
    if(pull<=0 || scrollY>0){ ptr.style.height="0"; return; }
    ptr.style.height = Math.min(pull*0.45, 58) + "px";
    ptr.textContent = pull>TH ? "Release to refresh" : "Pull to refresh";
  }, {passive:true});
  addEventListener("touchend", ()=>{
    if(y0==null) return;
    if(pull>TH){ busy=true; ptr.classList.add("snap"); ptr.style.height="40px"; ptr.textContent="Refreshing…";
      Promise.resolve(refresh()).finally(()=>{ busy=false; reset(); }); }
    else reset();
  }, {passive:true});
}

async function refresh(){
  net(navigator.onLine);
  if(!navigator.onLine) return;
  const c=load(); c.sched=c.sched||{}; c.wx=c.wx||{};
  try{ const wx=await weatherRange(); Object.assign(c.wx,wx); }catch(e){ /* keep old wx */ }
  try{ await Roster.pull(); }catch(e){ /* keep the cached roster */ }   // shared cache; primes the roster page
  for(const day of festDays()){
    try{ const rows=rowsFrom(await jsonp(day)); const p=parse(rows);
         if(p.mine.length||p.meals.length||p.allhands.length||p.evening.length||p.lessons.length) c.sched[day]=p; }
    catch(e){ /* keep old day */ }
  }
  c.ts=new Date().toISOString(); save(c); render();
}

// ---- boot ----
async function boot(){
  try{ BANK = await (await fetch("./composer-bank.json")).json(); }catch{ BANK={}; }
  await loadPlaces();       // map-data is SW-precached, so this is local + fast
  render();                 // instant from cache (offline-safe)
  addEventListener("online", ()=>{net(true);refresh();});
  addEventListener("offline", ()=>net(false));
  // reopening the home-screen card may resume from suspension (no reload) — refresh on foreground
  addEventListener("visibilitychange", ()=>{ if(document.hidden) return;
    const nt=viennaToday();                                    // may have rolled past midnight while suspended
    if(nt!==today){ if(sel===today){ sel=nt; render(); } today=nt; }   // advance the view if we were on "today"
    const c=load(), age=c.ts?Date.now()-new Date(c.ts).getTime():Infinity;
    if(age>60e3) refresh(); });
  setupPTR();
  refresh();                // stale-while-revalidate
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
if (typeof document !== "undefined") boot();
if (typeof module !== "undefined") module.exports = { parse, rowsFrom, mins, norm, despace, evblocks };
