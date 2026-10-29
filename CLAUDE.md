# BigTuna Home: notes for Claude

A custom home-screen app for a 2020 Samsung TV (Tizen 5.5), built with Claude. Private, machine-specific notes live in
CLAUDE.local.md (not shared). Your TV's address and hardware address go in config/tv.txt (see config/tv.example.txt).

## Hardware

- **TV:** Samsung 2020 models on **Tizen 5.5** (developed on a QN55Q60TAF). Developer Mode on, with the Mac's IP as Host PC IP.
  If installs fail to connect, the Mac's IP probably changed: the TV needs the new one (Apps, 1 2 3 4 5) and a restart.
- **Mac:** Apple Silicon, system Python **3.9** (keep scripts 3.9-compatible: no `match`, no `X | Y` types; standard library only).
- It does not replace Tizen. The Home button always opens Samsung's Smart Hub; *Autorun Last App* makes the TV start in BigTuna Home.

## Commands

| What | Command |
|---|---|
| Preview in a browser, real data | `tools/preview.sh` (serves build/ on http://localhost:8765, no-cache) |
| Build + sign + install + open on TV | `tools/deploy.sh` (= `python3 tools/build.py && python3 tools/install.py`) |
| Uninstall from TV | `python3 tools/install.py --uninstall` |
| Check API keys | `tools/check-keys.sh` |
| Test build that reports to the Mac | `python3 tools/report-server.py <tv-ip>` (leave running), then `python3 tools/build.py --diag http://<mac-ip>:8766 && python3 tools/install.py`; reports land in build/tv-reports/latest.json (apps, logo load times, key-to-screen ms, slow frames, errors, notes). Reinstall a normal build afterwards. |
| Network remote / power | `python3 tools/remote.py KEY_RETURN`, `KEY_POWER` (off), `wake` (Wake-on-LAN, needs TV_MAC and Power On with Mobile), `status`, `mac` |
| One-time toolchain setup | `tools/setup-mac.sh` |

`tools/debug.py` (remote inspector) doesn't work on Tizen 5.5 retail TVs: `0 debug` answers nothing.

## Toolchain

- Samsung's `tizen` CLI, native: `~/tizen-studio/tools/ide/bin/tizen`, with its own Java 17 in `~/tizen-studio/jdk`.
  Samsung's `sdb` is NOT used (Intel-only); never install Tizen Studio's GUI installer.
- Installing goes through `tools/install.py`, which speaks SDB (port 26101) in pure Python (adapted from Free My TV, MIT).
- Signing: security profile **TVHome** (Tizen author cert `~/tizen-studio-data/keystore/author/TVHome.p12` + Tizen's public
  distributor cert). Tizen 5.5 accepts this; no Samsung-account certificate needed (only Tizen 7+/2023+ TVs need that).
  The password is in the macOS Keychain; never ask for it in chat. Updates must be signed with the same certificate, or the TV refuses them.

## Project layout

- `app/` the Tizen web app (packaged as-is). `config.xml` id `BigTunaHom.BigTunaHome` (package ids must be exactly 10 letters/digits;
  a 9-letter one failed with "Parsing error" 118/-19).
  - `js/tv.js` TV layer: installed apps (`getAppsInfo` + Free My TV's hidden-app filter), launch, settings, remote keys, the helper. Sample apps in a browser.
  - `js/store.js` settings (localStorage `bth.*`) and data cache (`bthc.*`, with TTLs and pruning). Keys in `PER_PERSON`
    (layout, filters, rank by, watched, watchlist, appUsed...) are stored per person as `bth.p.<personId>.<key>`; person p1 falls back to global keys.
  - `js/movies.js` TMDB + OMDb pipeline. Sample data when keys are empty or `?sample=1`.
  - `js/weather.js` New York weather from Open-Meteo (no key), cached 30 min.
  - `js/backup.js` settings backup to the TV's Documents.
  - `js/app.js` UI: hero, filters, row, dock, detail card, pickers, settings, remote handling, power-on handling.
  - `js/diag.js` test builds only (reports, `tools/ask.py` questions, `command.txt` instructions).
  - `service/watch.js` the background helper (a Node.js `tizen:service`).
  - `js/keys.js` is empty in app/; build.py writes the real one into build/ only.
- `config/keys.txt` TMDB read token + OMDb key; `config/tv.txt` the TV's IP and MAC; `config/remote-token.txt` the network remote's
  token. All ignored by git: never print, log or commit them.
- `build/` generated; safe to delete.

## How the app works

- **Layout:** fixed 1920x1080 px; the preview scales it to the window. Full: brand + clock + weather, hero (highlighted title) →
  filter chips (Ranked by, Genre, Year, Type, Seen, ✕ Clear, My services/All media/Watchlist) → Top N row → centered dock (installed apps +
  Settings + Samsung Home). Background = highlighted title's TMDB backdrop, two crossfading layers. Simple: big clock + app grid over
  drawn mountains (`app/img/mountains-*.svg`, made by `tools/make-backdrop.py`), no movie lookups.
- **Remote:** arrows, OK (13), Back (10009; Esc/Backspace in browser). Red 403 Full/Simple layout, Green 404 scope, Yellow 405 rank,
  Blue 406 settings (keys 1-4 in the browser). Theme is in Settings → Appearance.
- **Titles:** TMDB `/discover/movie` and `/discover/tv` sorted by `vote_average.desc` (US watch providers, monetization
  flatrate|free|ads when limited to services) give candidates, 2 pages per batch, at least 4 pages (6 for Metacritic), shared across
  types and year spans. Each candidate: TMDB details (+external_ids, watch/providers) and OMDb (`imdbRating`, `imdbVotes`, `Metascore`,
  Rated, Director, Actors). Filter by min IMDb votes (default 20,000), sort by IMDb or Metascore, take N.
  Cached: details 5 days, ratings 30 days, lists 2 days (stale list shown while refreshing).
- **OMDb free tier = 1,000 lookups/day; a fresh list costs up to ~80.** Keep that budget in mind with any change; test with `?sample=1`.
  When OMDb says the limit is reached, `bthc.omdbOut` = next UTC midnight: no OMDb calls until then, TMDB's score stands in
  (`src: 'tmdb'`, blue badge), lists made meanwhile aren't saved, and a small note shows by the name.
- **Services:** TMDB providers are grouped into brands (`brandName`: "with Ads" plans, Peacock Premium, Paramount+ plans, Max→HBO Max,
  Apple TV+→Apple TV). Channels and rent/buy stores (`STORES`) are excluded. Installed apps map to brands via `providerForApp`
  (`APP_ALIAS` for names that differ). TMDB display priority 0 is the top, not missing.
  "Services in the list" (Settings, store key `service`) only narrows My services: `query()` sends `service: []` unless scope is 'mine'.
- **Type filter:** store key `kind` (per person, default `['movie']`, `[]` = all): Movies, TV Series, Miniseries (`with_type` 4|0|3 /
  2; movie genre ids mapped via `TV_GENRE`). **Show ids are `tv:<TMDB id>` everywhere**; plain numbers are movies. OMDb has no Metascore
  for most shows. **Seen** chip (store key `showWatched`, per person, default true = Include; Exclude leaves out titles marked ✓ via
  `q.exclude`); it was a Settings row until 2026-10-28. ✕ Clear resets Genre, Year, Type (to movies) and Seen (to Include) only.
- **People:** "Who's watching?" at start with 2+ people; each person has their own layout, filters, seen list (✓),
  watchlist and recent apps. While the start picker is open, body class `welcome` hides everything but the brand and clock
  (mountains behind). Picking someone with the other layout from Settings uses the layout fade. `samplePeople()`: in a browser in
  sample mode with no people saved yet, it adds "Alex - Full Mode" (two titles seen) and "Sam - Simple Mode", so visitors start at the picker. Never on the TV.
- **Layout fade:** `swapLayout()` fades ONE sheet (`#cover`, background colour, z-index 5, under Settings) over the screen (0.18 s),
  changes the layout under it, waits two frames + 80 ms, then fades it away (0.2 s). Instant with Animations off. Fading every layer at
  once looked smooth on a Mac but stuttered on the TV's graphics chip.
- **Power on:** turning the TV off only suspends the app. `wokeUp()` shows the start picker when the page comes back without an app
  BigTuna opened (or after 4 h in one), or when `heartbeat()` (15 s) sees a gap over 3 min while on screen. The power button gives
  window `blur` ~1.9 s before `visibilitychange`, and the TV stops drawing in between and shows that last frame on power-on, so
  `lostFocus()` puts up the calm look at once (`S.preWelcome`) and `gotFocus()` takes it down if the page never got hidden (pop-ups,
  Samsung's bar). Side effect: back from Samsung's screen after 3+ min also asks.
- **Dock order:** recently used first by default, or the order set in Apps in the dock.
- **Night screen:** after 5 min idle during night hours (default 11 pm to 6 am), a dim drifting clock. `?idle=3` shortens the wait in the preview.
- **Backup:** every `bth.*` key to `documents/bigtuna-home-backup.json` on the TV (survives uninstall; `-prev.json` keeps the copy
  before), a minute after the last change (`Store.onChange`) and on start if the last one is over a day old. A fresh install with a
  backup offers "Restore your backup?" first. Needs filesystem.read/write + mediastorage privileges.
- **Settings:** layout, theme dark/light/auto, background, animations, 12/24 h clock, rank by, scope, min votes, list size, my
  services, services in the list, dock apps (show/hide, reorder), people, backup/restore, Samsung TV settings, refresh, reset.

## Back to BigTuna Home after an app closes

- **The background helper** (`app/service/watch.js`, `tizen:service` `BigTunaHom.Watch`, approach from Skylight, MIT) keeps running
  while the TV freezes the page. The page sends `watch` (app id + Samsung STORE id from `STORE_IDS` in tv.js); the helper polls the
  TV's status service every 0.5 s and resumes BigTuna with `eden_resume` (no reload) once the app leaves the screen (settles 0.8 s).
  Hardening: refuses requests with an http(s) Origin, accepts only well-formed app ids / numeric store ids, caps pause, ignores the
  duplicate of each message (sent via its port and a service request). Apps without a store id use the page watcher (`watchFor`/`checkReturn`).
- **The TV's status service:** `GET http://<tv>:8001/api/v2/applications/<STORE id>` → `{running, visible}`, no token. It needs the
  Samsung STORE id, not the Tizen app id (`0 was_execute <tizen id>` logs `app_id[<store id>]`). YouTube's engine never closes; it
  reports visible=false after Back, which is the exit signal.
- **Not possible on Tizen 5.5:** the Home button opens Samsung's bar OVER the current app (it stays visible), so Home can't trigger a
  return. Reassigning Home (the CleanFrame approach) needs a general shell; sdbd here runs only Samsung's guarded `0 <cmd>` wrappers
  and every other command returns empty. When Samsung's home screen appears, the TV freezes background apps for 30 s to over a minute.
  Ruled out as exit signals: AirPlay helpers, launchAppControl replies, addAppStatusChangeListener, `0 debug`, webapis.

## Constraints

- Tizen 5.5's web engine is an old Chromium: write plain **ES5** (var, functions, XMLHttpRequest; no arrow functions, classes,
  template literals, fetch, async). No `backdrop-filter` or heavy blur; animate only transform/opacity, and as few large layers as possible.
- No ads, no tracking, no third-party scripts or web fonts. Network: only TMDB, image.tmdb.org, OMDb, Open-Meteo and the helper (127.0.0.1:8130).
- Security: config.xml `<access>` lists only those hosts and index.html has a CSP meta (scripts 'self'/file: only, inline styles allowed,
  images 'self'/file:/data:/image.tmdb.org). A new host needs adding in BOTH places. Every image URL goes through `img()` in app.js.
  Backup restore takes only valid `bth.*` keys; `Store.get` falls back to defaults for damaged values. Remove localStorage entries via
  `Store.keys()` + `Store.removeAll()` (never while looping over localStorage). Test builds (`--diag`) add `'unsafe-eval'` and the Mac's
  report address; never ship them as the everyday build.
- Keep TMDB/JustWatch/OMDb attribution (detail card, Settings → About, README) and the third-party notices.
- Speed: logos drawn once into canvases (`drawnTiles`), YouTube/YouTube TV/Netflix/Prime drawn as brand tiles (`BRANDS`), fast mode
  (quick presses turn transitions off), highlight drawn once per frame. Slowest 10% of presses ~36 ms on the TV.
