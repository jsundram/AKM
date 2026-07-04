# ANALYTICS.md — how usage tracking works, and why it's built this way

A plain-language + technical explainer of the AKM app's analytics: what's collected, where it
goes, who can see it, and the design reasoning — written to be reusable as a pattern in other
projects, and clear enough to explain to a board.

## The one-paragraph version (board-friendly)

When someone opens the app, their device sends a tiny "someone opened page X at time T" record
to a **private** Google Sheet that only Jason can open. The record identifies the person only
as an 8-character code derived from their name by a one-way hash — no names, phone numbers, or
other personal data ever travel over the network or sit in the log. Decoding the codes back to
names requires the festival roster, which the sheet's owner already has; anyone else who
somehow saw the log would see only timestamps, page names, and opaque codes. There are no
third-party analytics services, no cookies, no advertising identifiers, and no tracking beyond
"this person opened the app." Opens that happen offline are stored on the device and reported
the next time it's online.

## The moving parts

```
 browser (any page)                Google Apps Script              private Google Sheet
┌─────────────────────┐   GET     ┌──────────────────┐   append   ┌──────────────────────┐
│ ping.js             │ ────────▶ │ analytics.gs     │ ─────────▶ │ received·opened·     │
│  queue in           │  /exec?   │  doGet: check    │            │ page·who   (+ name   │
│  localStorage,      │  k,ts,p,u │  token, append   │            │ via key tab formula) │
│  flush when online  │           │  one row         │            │                      │
└─────────────────────┘           └──────────────────┘            └──────────────────────┘
```

Three pieces, each doing one job:

1. **`ping.js`** (client) — records opens locally, delivers them when it can.
2. **`scripts/analytics.gs`** (endpoint) — a ~10-line web app that appends one row per ping.
   The repo copy is *reference*; the live copy runs as an Apps Script **bound to the sheet**.
3. **The sheet** (storage + dashboard) — a private spreadsheet in Jason's account. The log
   *is* the analytics product: filters, pivots, and formulas do the rest. No dashboard
   software to run or pay for.

## Client side: `ping.js`

Loaded as the last script on every page (index, roster, map, network, about, notes), so its
cost lands after everything the user is waiting for. Core design: **queue first, send second.**

- On open (and on resume, throttled to once per 5 min — iOS home-screen apps *resume* far more
  often than they reload), append `{ts, page, uid}` to a `localStorage` queue (`akm-pings`,
  capped at 300 entries).
- Then try to flush the queue, oldest first: one `fetch(…, {mode:"no-cors"})` GET per entry.
  A resolved fetch means "reached Google" → dequeue; a rejected one means offline/unreachable
  → stop, keep the rest for next time. Also flushes on the browser's `online` event.
- Everything network-related is async and fire-and-forget; nothing ever blocks rendering,
  and the page never waits on the sheet write.

Why this shape:

- **Offline is normal here**, not an edge case (alpine valley, spotty wifi, PWA). Queue-first
  means an offline open is *recorded* at open time and *delivered* later — the log stays
  truthful about when things happened (`opened` column) even when delivery lags (`received`).
- **The unconfigured state is first-class.** With `URL_` empty, pings queue silently, nothing
  is sent, nothing errors — so the client could ship before the endpoint existed, and the
  backlog flushed once the URL landed. The same property makes an endpoint outage harmless.
- **`no-cors` GET** avoids the whole CORS dance: the client can't read the response, but it
  doesn't need to — "the request reached the network" is the only signal the queue logic uses.
  An image beacon would work too; `fetch` gives a usable success/failure promise.
- `uid` is computed fresh each open from `localStorage["akm-me"]` (the identity picked in the
  app) via `crypto.subtle` — no dependency on the roster data layer, so it works even on pages
  that don't load it.

## Identity: the UID scheme

`uid` = **first 8 hex characters (4 bytes) of SHA-256 of the person's canonical roster name**,
UTF-8 encoded. Jason ("Jason Sundram") is `70f71792`.

Why a name hash and not the obvious alternatives:

- **Not the name itself** — no personal data in transit or at rest in the log. The log stays
  clean if it's ever screen-shared or exported.
- **Not the roster `#` column** — row numbers shift when the roster is edited, which would
  silently re-attribute historical rows. A name-derived hash is stable across renumbering.
- **Not a random device id** — the same person on two devices should count as one person, and
  a hash of the name gives that for free.
- **Deliberately pseudonymous, not anonymous.** Anyone holding the roster can recompute every
  hash — that's the point: the sheet owner can decode; a stranger seeing the log can't. Match
  the strength of the disguise to the actual threat model.

The mapping back to names is rebuilt *inside the sheet*, on demand, from live data — never
stored in the repo:

- A `key` tab pulls the roster's Name column via
  `IMPORTRANGE("<roster sheet url>", "roster!B2:B")` (note: A1 ranges use **column letters**,
  not header names — the header "Name" living in column B means `B2:B`), then `=UID(A2:A)`
  beside it hashes the whole column in one call (`UID` is array-aware).
- The pings tab shows names automatically:
  `=ARRAYFORMULA(IF(D2:D="",, IFERROR(VLOOKUP(D2:D, {key!B2:B, key!A2:A}, 2, FALSE), "?")))`

Two properties worth remembering:

- **Empty `uid` = no identity picked.** Festival users pick an identity on first open, so a
  stream of identity-less opens that never "convert" is the tripwire for strangers finding the
  public URL. This is the detection half of "the app is public but shouldn't be *popular*."
- **Editing a Name cell changes that person's hash**, orphaning their older rows (`?` in the
  name column). Fix: keep the old spelling as an extra row in the `key` tab.

## The endpoint: `scripts/analytics.gs`

An Apps Script **bound to the analytics sheet** (created via Extensions → Apps Script from the
sheet itself), deployed once as a web app with *Execute as: Me* and *Who has access: Anyone*.
That combination makes it an **append-only mailbox**: anyone can drop a row in; only the owner
can open the sheet. Binding it to the sheet means no sheet-id configuration and makes `UID()`
available as a spreadsheet formula.

`doGet` checks a shared token (`k`) and appends `[now, opened, page, uid]`. It's deliberately
tolerant of missing parameters: old clients flush *queued* pings shaped by old code, so the
endpoint must accept yesterday's format forever (or at least degrade to blank cells, not
errors).

Honest limits, worth stating plainly:

- The token is in a public repo and in every visitor's browser, so it stops only drive-by
  scanner noise, **not** a determined prankster. Anyone could spam rows. At this scale the
  mitigation is: rows are cheap, the sheet is filterable, and fake rows can't impersonate a
  *specific* person more convincingly than the roster-public hash allows. This is analytics,
  not audit logging — don't use this pattern where forged rows would matter.
- Sends can duplicate in rare cases (a fetch that reached Google but whose response never
  arrived stays queued and re-sends). Dedup by `(opened, uid)` if it ever matters.
- Concurrent `appendRow`s from simultaneous opens could in principle interleave; with ~60
  users it's not worth the `LockService` complexity.

## Design reasoning: why not just use an analytics service?

The app is a static PWA on GitHub Pages — no server, no build, no backend — serving ~60 known
people, with a hard rule that PII stays out of the repo and away from third parties.

- **Google Analytics / hosted trackers**: massively over-scoped, consent-banner territory,
  and sends behavioral data to a third party for no benefit at this scale.
- **Privacy-respecting counters (GoatCounter, Plausible, …)**: good tools, but they are
  deliberately *not* per-user — and "who is using it" was the actual question. Smuggling user
  ids into event paths fights their design.
- **This pattern**: the data lands in the same Google account that already holds the roster —
  no new party learns anything. The "backend" is ~10 lines running on Google's
  infrastructure for free, and the "dashboard" is a spreadsheet the owner already knows how
  to query. Total client cost: one ~2 KB cached script, zero effect on page latency (the
  write happens on Google's side; the client never waits for it).

The general lesson: **when the audience is small and known, a log you fully own beats a
dashboard you rent.** Aggregation is a formula away; the raw rows answer questions dashboards
can't ("did person X see the schedule before Tuesday?").

## Reusing the pattern elsewhere (checklist)

1. Create a private spreadsheet; row 1: `received · opened · page · who` (plus whatever else).
2. Extensions → Apps Script; paste `analytics.gs`; pick a token.
3. Deploy → New deployment → Web app → *Execute as: Me* / *Access: Anyone*; authorize; copy
   the `/exec` URL.
4. Drop `ping.js` into the app; set `URL_` and the same token; decide what an "identity" is in
   that app and hash it the same way.
5. Verify: hit `…/exec?k=<token>&p=test&u=` in a browser → "ok" + a row appears. Delete it.
6. If the app has a service worker that precaches, add `ping.js` and bump the cache version.

Adaptation knobs: the queue cap (bound the localStorage footprint), the resume throttle, what
goes in a ping (keep it to what you'd be comfortable reading aloud to the people being
counted), and whether the uid is a name hash or something else stable and non-identifying.

## Ops runbook

- **Editing `doGet` in the live script**: a plain save does **not** update the live `/exec`
  URL. Deploy → Manage deployments → ✎ → Version: New → Deploy. (Editing `UID()` only, for
  the sheet formula, *does* take effect on save — deployments gate the web app, not custom
  functions.)
- **If a redeploy mints a new URL**: update `URL_` in `ping.js`, bump `sw.js` `V`.
- **Invariants across `ping.js` ↔ `analytics.gs`**: same `TOK` literal; same uid recipe
  (SHA-256 over UTF-8, first 4 bytes, lowercase hex). Sanity check both sides with
  `UID("Jason Sundram") = "70f71792"`.
- **Reading the log**: `opened ≠ received` → an offline open that flushed late. Empty `who` →
  no identity picked (stranger, or a user pre-pick). `?` in the name column → hash matches no
  current roster name (name was edited; extend the `key` tab).
