# Testing

Two layers: an automated battery that proves parsing/matching correctness, and a manual
suite for what only real devices can prove (iOS standalone, offline in the field, app
handoffs, feel). Run the automated battery after any code change; run the manual suite
before sharing with new people or after anything that touches identity, matching, or the SW.

## Automated

```
node archive/parser-test.js     # 36/36 — grid parsing + multi-user matching on a synthetic fixture (offline; runs anywhere)
node scripts/network-test.js    # 14/14 — pieces↔roster co-performance join + both graph layouts, against the live sheets
node scripts/schedule-test.js   # 15/15 — the schedule personalizes (mineOf non-empty, no over-claims), every festival day, live
```

The two live tests pull the real sheets (public gviz) to catch what the offline fixture can't — the
sheets drifting from what the code expects (a roster `Pieces` reformat once blanked every schedule).
Both are **network-gated: they skip (exit 0) rather than fail when the sheets are unreachable** (offline
or a locked-down sandbox); the roster is PII, so there are no committed fixtures to fall back to.

The parser fixture encodes the sheet's real quirks — wrapped room headers ("BAND\nROOM"),
letter-spaced banners, double-coach cells, private-lesson blocks parked in room columns,
concert rows — plus the matching guards: stale-letter false positives (quartet≠sextet,
clarinet≠string), composer-zone requirement, week gating (W1-annotated players/groups),
lesson diminutives ("Matt"→Matthew) and coach-instrument tie-breaks ("Steph" under a cello
vs violin coach). If you change `parse`/`userCtx`/`mineOf`/`lessonsOf`, extend the fixture —
don't hand-test what a check can pin.

Ad-hoc but worth rerunning after sheet-format changes: a whole-festival sweep (parse every
posted tab × every roster person; assert every W1 cell is claimed, every lesson slot resolves
to exactly one person, and W2 claims are only two-week groups). Rebuild it from the exports —
`parse`, `rowsFrom`, `userCtx`, `mineOf`, `lessonsOf` are all `require`-able.

## Manual, before sharing (~30 min, two devices)

Machine-verified already — don't re-test content correctness: all 60 people × all 11 days
match their real groups, notes gating, picker state machine, offline cache tolerance.

**1. Your phone — the upgrade path (first, right after deploy).** The installed app is the
one device with real pre-upgrade state.
- Open the installed app online: old content renders instantly, refresh lands, the **picker
  appears** (no `akm-me` yet). Pick yourself.
- Brass cards match today; grace note present; self-added dashed events survived.
- Today's **concert row** renders; its venue maplink focuses the map.
- Chip to a Saturday (double-coach "with X/Y") and a week-2 day (only two-week groups brass).
- Airplane mode, relaunch: whole week browsable, fonts still Fraunces/Plex, all four pages open.
- Pull-to-refresh; background a minute and reopen (resume-refresh path).

**2. Fresh device — the NUX being shared.** Safari private tab or a borrowed phone.
- Cold open → picker auto-opens. Pick **Cara Wunder** (exercises three fixes at once):
  Friday shows Schubert Piano Trio **@ BAND ROOM**; **no grace note**; her roster row has
  **no notes text and no expand caret**.
- Map: brass base = **Haus Obernosterer** (the Obermosterer alias); ◎ locate → real
  permission prompt → blue dot + accuracy ring.
- Roster: "you" tag follows; a WhatsApp glyph opens the actual app pre-filled "…it's Cara from AKM".
- Network: rings centre on Cara.
- **Add to Home Screen**: icon/name right, standalone (no Safari chrome), content clear of
  the Dynamic Island/home indicator. The picker **asks again on first standalone open** —
  the installed app has its own storage container; expected, not a bug.
- Hand the phone back with its owner's identity picked (or website data cleared).

**3. Identity spot-checks (any device).**
- Guest (Todd): generic day — meals + concerts, zero brass, no base pin, rings centre on the
  most-connected player, no "you" legend swatch.
- Faculty (Emi): playing cards yes, lesson cards no, grace note no.
- Switch identity on the schedule page, then open roster/map — "you" row and base pin follow.

**4. One real-human confirmation.** Ask whoever has the next private lesson whether their
card (time+30, coach, room) matches what they were told — validates the lesson chain against
ground truth no test can know.

**5. During-festival data drills (as they come up).**
- Sheet fix "Obermosterer" → "Obernosterer": roster links + map base still resolve (aliases
  cover both spellings).
- W2 assignments land in the pieces sheet + roster Pieces letters: W2 days light up —
  spot-check yourself and one other.
- New "Goes by X" note: that nickname matches lesson slots on next refresh.

**Known-expected oddities:** standalone re-asks identity once (separate storage); week-2 days
show only two-week groups until the sheets fill; the 7/10–7/11 dress-rehearsal blocks don't
surface (placeholder time lists in the sheet — see CLAUDE.md open items).
