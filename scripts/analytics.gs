// AKM usage pings → a private spreadsheet. Pairs with ping.js (which queues offline and
// flushes here). Lives in the repo for reference only — it runs as an Apps Script *bound to
// the analytics sheet*, so there's no sheet id to configure and =UID() works as a formula.
//
// One-time setup (in Jason's Google account):
//   1. sheets.new → name it "AKM analytics". Keep it private — never share or link-view it.
//      Put headers in row 1: received · opened · page · who
//   2. Extensions → Apps Script → replace the stub with this file → save.
//   3. Deploy → New deployment → type: Web app → Execute as: Me → Who has access: Anyone.
//      Authorize when prompted. ("Anyone" means anyone can *append a ping*; only you can
//      open the sheet.)
//   4. Copy the /exec URL into URL_ at the top of ping.js, commit, bump sw.js V.
//
// After editing this script later: Deploy → Manage deployments → ✎ → Version: New → Deploy
// (a plain save does NOT update the live /exec URL).
//
// Columns: received = server time; opened = the device's clock at the actual open (differs
// from received for queued offline pings); page = index/roster/map/network/about/notes;
// who = uid hash ("" = no identity picked — the stranger tripwire).

const TOK = "akm-2026";   // matches TOK in ping.js

function doGet(e){
  const p = (e && e.parameter) || {};
  if (p.k === TOK)
    SpreadsheetApp.getActive().getSheets()[0]
      .appendRow([new Date(), p.ts ? new Date(+p.ts) : "", p.p || "", p.u || ""]);
  return ContentService.createTextOutput("ok");
}

// =UID(name) in the sheet → the ping.js uid for that name. Paste the roster Name column into
// a scratch tab and drag this down to build the who→name key; rebuild anytime the roster
// changes. Must match ping.js exactly: SHA-256 over UTF-8, first 4 bytes, lowercase hex.
function UID(name){
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, name, Utilities.Charset.UTF_8)
    .slice(0, 4).map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}
