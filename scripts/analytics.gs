// AKM usage pings → a private spreadsheet. Pairs with ping.js (which queues offline and
// flushes here). Lives in the repo for reference only — it runs as an Apps Script *bound to
// the analytics sheet*, so there's no sheet id to configure and =UID() works as a formula.
//
// One-time setup (in Jason's Google account):
//   1. sheets.new → name it "AKM analytics". Keep it private — never share or link-view it.
//      Put headers in row 1: received · opened · page · who · action · to
//   2. Extensions → Apps Script → replace the stub with this file → save.
//   3. Deploy → New deployment → type: Web app → Execute as: Me → Who has access: Anyone.
//      Authorize when prompted. ("Anyone" means anyone can *append a ping*; only you can
//      open the sheet.)
//   4. Copy the /exec URL into URL_ at the top of ping.js, commit, bump sw.js V.
//   5. Format the who AND to columns as Plain text (Format → Number → Plain text) so all-digit
//      uids aren't coerced to numbers — see the ping.js gotcha in CLAUDE.md.
//
// After editing this script later: Deploy → Manage deployments → ✎ → Version: New → Deploy
// (a plain save does NOT update the live /exec URL).
//
// To add the action/to columns to an already-live sheet: add the two headers, Plain-text the
// `to` column, re-paste this file, and redeploy (New version) so doGet writes the extra cells.
//
// Columns: received = server time; opened = the device's clock at the actual open (differs
// from received for queued offline pings); page = index/roster/map/network/about/notes ("" on a
// feature-use event); who = uid hash of the actor ("" = no identity picked — the stranger
// tripwire); action = "" for a plain open, else the event name ("kudos"); to = uid hash of the
// event's target (the kudos recipient), reversible with =UID() just like who.

const TOK = "akm-2026";   // matches TOK in ping.js

function doGet(e){
  const p = (e && e.parameter) || {};
  if (p.k === TOK)
    SpreadsheetApp.getActive().getSheets()[0]
      .appendRow([new Date(), p.ts ? new Date(+p.ts) : "", p.p || "", p.u || "", p.a || "", p.t || ""]);
  return ContentService.createTextOutput("ok");
}

// =UID(name) in the sheet → the ping.js uid for that name. Array-aware: =UID(A2:A) fills the
// whole who→name key column in one call (blanks stay blank). Must match ping.js exactly:
// SHA-256 over UTF-8, first 4 bytes, lowercase hex. UID("Jason Sundram") = "70f71792".
function UID(name){
  if (Array.isArray(name)) return name.map(UID);
  if (!name) return "";
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(name), Utilities.Charset.UTF_8)
    .slice(0, 4).map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}
