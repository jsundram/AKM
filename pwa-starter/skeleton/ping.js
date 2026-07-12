// Dirt-cheap usage analytics → a private Google Sheet. No third party, no cookies, no server.
// Pairs with analytics.gs (a ~10-line Apps Script bound to the sheet). See PWA-CLAUDE.md §Analytics.
//
// Design: QUEUE FIRST, SEND SECOND. Every open appends {ts, page, uid} to a localStorage queue and
// flushes it when the network is reachable — so an offline open is recorded at open time and
// delivered later. Fire-and-forget; never blocks rendering.
//
// URL_ empty  = endpoint not deployed yet: pings queue silently, nothing sent, nothing errors.
//               (So you can ship this before the backend exists; the backlog flushes once URL_ lands.)
// uid empty   = no identity picked. If your app has no notion of "who", drop the uid bits and just
//               log opens per page (still answers "how much is this used, and when").
(function(){
  const URL_ = "";            // <-- paste your Apps Script /exec URL here (empty = disabled)
  const TOK  = "app-token";   // <-- must match TOK in analytics.gs; public, just filters scanner noise
  const KEY  = "app-pings", CAP = 300, GAP = 5*60e3;

  // Page name from the path. A directory URL (/foo/) reads as "index" — pages served at a dir URL
  // set window.APP_PAGE before loading this to override.
  const page = window.APP_PAGE || (location.pathname.split("/").pop() || "index").replace(".html","") || "index";

  const q    = () => { try{ return JSON.parse(localStorage.getItem(KEY)) || []; }catch{ return []; } };
  const save = a  => { try{ localStorage.setItem(KEY, JSON.stringify(a.slice(-CAP))); }catch{} };

  // uid = first 4 bytes of SHA-256 of the identity, lowercase hex. Pseudonymous: the owner can
  // reverse it against their own roster (=UID() in the sheet); a stranger seeing the log can't.
  // EDIT: point this at however your app stores "who the user is" (or return "" to log anonymously).
  async function hash(name){
    if(!name || !crypto.subtle) return "";
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name));
    return [...new Uint8Array(h)].slice(0,4).map(b => b.toString(16).padStart(2,"0")).join("");
  }
  const uid = () => { let n=null; try{ n = localStorage.getItem("app-me"); }catch{} return hash(n); };

  let busy = false;
  async function flush(){
    if(!URL_ || busy || !navigator.onLine) return;
    busy = true;
    try{
      while(true){                       // re-read the queue each pass so a ping enqueued mid-flush survives
        const a = q();
        if(!a.length) break;
        const {ts,p,u} = a[0];
        const url = `${URL_}?k=${TOK}&ts=${ts}&p=${p||""}&u=${u||""}`;
        try{ await fetch(url, {mode:"no-cors"}); }   // no-cors: we can't read the reply, don't need to
        catch{ break; }                  // unreachable — keep the rest for next time
        save(q().slice(1));              // drop the head we just sent
      }
    } finally { busy = false; }
  }

  let last = 0;
  async function ping(){                 // open + resume, throttled (iOS home-screen apps resume a lot)
    if(Date.now() - last < GAP) return;
    last = Date.now();
    save([...q(), {ts: Date.now(), p: page, u: await uid()}]);
    flush();
  }

  ping();
  addEventListener("visibilitychange", () => { if(!document.hidden) ping(); });
  addEventListener("online", flush);
})();
