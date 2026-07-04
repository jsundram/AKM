// Usage pings → Jason's private analytics sheet, via the Apps Script endpoint in
// scripts/analytics.gs. Every open appends {ts, page, uid} to a localStorage queue and flushes
// it when Google is reachable, so offline opens surface on the next online one. uid = first
// 8 hex of SHA-256 of the picked identity (akm-me) — stable when the roster renumbers, and
// reversible only against the roster itself (=UID() in the sheet builds the key). URL_ empty =
// endpoint not deployed yet: pings still queue (capped) but nothing is sent, nothing errors.
(function(){
  const URL_ = "";              // Apps Script /exec URL — paste after deploying scripts/analytics.gs
  const TOK  = "akm-2026";      // matches TOK in analytics.gs; public in the repo, just filters scanners
  const KEY  = "akm-pings", CAP = 300, GAP = 5*60e3;
  const page = (location.pathname.split("/").pop() || "index").replace(".html","") || "index";

  const q    = () => { try{ return JSON.parse(localStorage.getItem(KEY)) || []; }catch{ return []; } };
  const save = a  => { try{ localStorage.setItem(KEY, JSON.stringify(a.slice(-CAP))); }catch{} };

  async function uid(){
    let name = null; try{ name = localStorage.getItem("akm-me"); }catch{}
    if(!name || !crypto.subtle) return "";
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name));
    return [...new Uint8Array(h)].slice(0,4).map(b => b.toString(16).padStart(2,"0")).join("");
  }
  let busy = false;
  async function flush(){
    if(!URL_ || busy || !navigator.onLine) return;
    busy = true;
    let a = q();
    while(a.length){
      const {ts,p,u} = a[0];
      try{ await fetch(`${URL_}?k=${TOK}&ts=${ts}&p=${p}&u=${u}`, {mode:"no-cors"}); }
      catch{ break; }                       // unreachable — keep the rest for next time
      a = a.slice(1); save(a);
    }
    busy = false;
  }
  let last = 0;
  async function ping(){                    // load + resume, throttled: iOS resumes fire often
    if(Date.now() - last < GAP) return;
    last = Date.now();
    save([...q(), {ts: Date.now(), p: page, u: await uid()}]);
    flush();
  }
  ping();
  addEventListener("visibilitychange", () => { if(!document.hidden) ping(); });
  addEventListener("online", flush);
})();
