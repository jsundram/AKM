// Usage-ping endpoint. Pairs with ping.js. Lives in the repo for reference only — the LIVE copy
// runs as an Apps Script *bound to the analytics sheet* (Extensions -> Apps Script from the sheet),
// so there's no sheet id to configure and =UID() works as a spreadsheet formula.
//
// One-time setup (in your Google account):
//   1. sheets.new -> name it "APP analytics". Keep it PRIVATE (never share / link-view).
//      Row 1 headers: received | opened | page | who
//   2. Extensions -> Apps Script -> replace the stub with this file -> Save.
//   3. Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone -> authorize.
//      ("Anyone" = anyone can APPEND a ping; only you can OPEN the sheet.)
//   4. Copy the /exec URL into URL_ in ping.js, commit, bump sw.js V.
//   5. Format the `who` column as Plain text (Format -> Number -> Plain text) so all-digit uids
//      aren't silently coerced to numbers (breaks the =UID() reverse lookup for ~2% of names).
//   6. Verify: open  .../exec?k=<token>&p=test&u=  -> "ok" + a row appears. Delete the test row.
//
// After editing this later: Deploy -> Manage deployments -> pencil -> Version: New -> Deploy.
// A PLAIN SAVE DOES NOT UPDATE THE LIVE /exec URL. (Custom functions like UID() do update on save.)
//
// Keep doGet tolerant of missing params forever: old clients flush queued pings shaped by old code.

const TOK = "app-token";   // must match TOK in ping.js

function doGet(e){
  const p = (e && e.parameter) || {};
  if (p.k === TOK)
    SpreadsheetApp.getActive().getSheets()[0]
      .appendRow([new Date(), p.ts ? new Date(+p.ts) : "", p.p || "", p.u || ""]);
  return ContentService.createTextOutput("ok");
}

// =UID(name) in the sheet -> the ping.js uid for that name. Array-aware: =UID(A2:A) fills a whole
// key column in one call. Must match ping.js EXACTLY: SHA-256 over UTF-8, first 4 bytes, lc hex.
// Build a reverse key: a `key` tab with names in A and =UID(A2:A) in B, then VLOOKUP the who column.
function UID(name){
  if (Array.isArray(name)) return name.map(UID);
  if (!name) return "";
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(name), Utilities.Charset.UTF_8)
    .slice(0, 4).map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}
