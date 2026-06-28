# Lesachtal morning briefing — laptop setup

Runs every morning at **08:20 local time**. Your laptop is in the Alps, so local = CEST = festival time. No timezone math.

## 1. Files — put these together in `~/lesachtal/`

```
~/lesachtal/
  briefing.py              # the runner
  briefing-template.html   # the design (edit here to change looks)
  composer-bank.json       # vetted quotes + facts
  preflight.py             # one-time check
  run.log                  # created on first run
  briefings/               # output, created automatically
  briefing-state.json      # quote-rotation memory, created automatically
```

## 2. One-time: install uv (if you don't have it)

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## 3. Preflight — confirm the two live calls work from your network

```sh
cd ~/lesachtal
uv run preflight.py 2026-06-29
```

Expect three green **PASS** lines (the tab, Open-Meteo with Monday's real high/low + sun, the bank) and `READY ✓`. This is the step the sandbox couldn't do — once it's green, the morning run has everything.

## 4. Test a real run by hand

```sh
uv run briefing.py --date 2026-06-29
```

Writes `briefings/briefing-2026-06-29.html`, opens it in your browser, and fires a notification. Drop `--date` to run for today. Add `--offline` to render without the weather call.

## 5. Schedule it

```sh
cp com.lesachtal.briefing.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.lesachtal.briefing.plist
```

To stop it: `launchctl unload ~/Library/LaunchAgents/com.lesachtal.briefing.plist`.
The job assumes the files are in `~/lesachtal/`; if you put them elsewhere, edit the `cd` path in the plist.

If the laptop is asleep at 08:20, launchd runs the job as soon as it wakes.

## Delivery

Default is no-credentials: it **writes the dated HTML, opens it, and posts a notification**. If you'd rather have it emailed, say so and I'll add ~10 lines of SMTP (your own account) gated behind an env var.

## When the schedule isn't posted yet

If a day's tab is empty, the runner prints `schedule not posted yet` and still renders weather + a grace note, so you get something rather than an error.

## Notes

- **Change the look** in `briefing-template.html` — the runner only fills the `{{...}}` regions, so design and logic stay separate.
- **Your pieces** live in the `MINE` map at the top of `briefing.py` (Dvořák Quartet, Bruch Octet, Brahms Piano Quartet, Fauré Piano Quartet). Edit if your assignments change.
- **Quote rotation** is remembered in `briefing-state.json`, so you won't see the same quote twice until the pool's used up.
