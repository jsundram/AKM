// Usage pings → Jason's private analytics sheet, via the Apps Script endpoint in
// scripts/analytics.gs. Every open appends {ts, page, uid} to a localStorage queue and flushes
// it when Google is reachable, so offline opens surface on the next online one. uid = first
// 8 hex of SHA-256 of the picked identity (akm-me) — stable when the roster renumbers, and
// reversible only against the roster itself (=UID() in the sheet builds the key). URL_ empty =
// endpoint not deployed yet: pings still queue (capped) but nothing is sent, nothing errors.
//
// Beyond opens, pages can log *feature-use events* via window.AKMPing.event(action, toName):
// concerts.html fires event("kudos", <recipient>) when a kudos chip is tapped, so Jason can see
// whether applause is a couple of friends or widespread. An event carries an empty page (so the
// usage crunch, which counts opens, skips it), the sender's uid in `who`, and the *recipient's*
// uid in `to` — recipientName hashed with the same recipe, so no names enter the stream and both
// ends reverse through =UID(). Events aren't throttled (each is a real tap).
(function(){
  const URL_ = "https://script.google.com/macros/s/AKfycbzCjWSTVOhqusGhbFp23q0MZukSXjHIEouTf3AWe9uaT_GPbYq5yH4yaT8_bTssnvEC/exec";
  const TOK  = "akm-2026";      // matches TOK in analytics.gs; public in the repo, just filters scanners
  const KEY  = "akm-pings", CAP = 300, GAP = 5*60e3;
  // directory URLs (/AKM/buildlog/, /AKM/usage/) end in "/" and would read as "index" —
  // those pages set window.AKM_PAGE before loading this
  const page = window.AKM_PAGE || (location.pathname.split("/").pop() || "index").replace(".html","") || "index";

  const q    = () => { try{ return JSON.parse(localStorage.getItem(KEY)) || []; }catch{ return []; } };
  const save = a  => { try{ localStorage.setItem(KEY, JSON.stringify(a.slice(-CAP))); }catch{} };

  async function hash(name){                // uid recipe: first 4 bytes of SHA-256, lowercase hex
    if(!name || !crypto.subtle) return "";
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name));
    return [...new Uint8Array(h)].slice(0,4).map(b => b.toString(16).padStart(2,"0")).join("");
  }
  const uid = () => { let n = null; try{ n = localStorage.getItem("akm-me"); }catch{} return hash(n); };

  let busy = false;
  async function flush(){
    if(!URL_ || busy || !navigator.onLine) return;
    busy = true;
    try{
      while(true){                          // re-read the queue each pass so a ping enqueued mid-flush isn't clobbered
        const a = q();
        if(!a.length) break;
        const {ts,p,u,act,to} = a[0];
        const url = `${URL_}?k=${TOK}&ts=${ts}&p=${p||""}&u=${u||""}`
                  + (act ? `&a=${act}` : "") + (to ? `&t=${to}` : "");
        try{ await fetch(url, {mode:"no-cors"}); }
        catch{ break; }                     // unreachable — keep the rest for next time
        save(q().slice(1));                 // drop the head we just sent (still the oldest, flush is single-flight)
      }
    } finally { busy = false; }
  }
  let last = 0;
  async function ping(){                    // load + resume, throttled: iOS resumes fire often
    if(Date.now() - last < GAP) return;
    last = Date.now();
    save([...q(), {ts: Date.now(), p: page, u: await uid()}]);
    flush();
  }
  async function event(action, toName){     // a feature-use tap — unthrottled, empty page, recipient in `to`
    save([...q(), {ts: Date.now(), p: "", u: await uid(), act: action, to: await hash(toName)}]);
    flush();
  }
  window.AKMPing = { event };

  ping();
  addEventListener("visibilitychange", () => { if(!document.hidden) ping(); });
  addEventListener("online", flush);
})();
