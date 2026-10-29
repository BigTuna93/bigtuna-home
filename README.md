# BigTuna Home

A clean, ad-free home screen for the Samsung QN55Q60TAF (2020, Tizen 5.5). Two layouts, simple mode with the apps only, and full mode which curates top rated movies based on your streaming services. Plenty of functionality to filter the list. You'll want an AI to help implement as this has been catered specific to my make and model. I tried to push this app as far as I can to make it feel like a true replacement of the Samsung home page. Hopefully others can build on this to develop further.

## How it works

- **Sits on top of Samsung's system.** The Home button still opens Samsung's bar; with Autorun Last App on, the TV starts in BigTuna Home.
- **Who's watching?** With two or more people, a picker appears at start and whenever the TV comes back on. Each person
  keeps their own layout, filters, watched list, watchlist and recent apps.
- **Two layouts.** *Full*: clock and weather, a featured title, filter chips, a Top 10 row and your apps. *Simple*: a big
  clock and your apps over a mountain scene, with no movie lookups.
- **The Top 10.** TMDB finds highly rated movies and shows (on your services, or all media); OMDb adds each one's IMDb
  rating, vote count and Metacritic score. Titles under 20,000 IMDb votes are left out (adjustable), the rest are ranked
  by IMDb or Metacritic. Lists are kept 2 days and ratings 30, so most visits cost no lookups; if OMDb's free limit
  (1,000 a day) runs out, TMDB's score stands in until midnight UTC.
- **Filters.** Ranked by, Genre, Year, Type (Movies, TV Series, Miniseries), Seen (include or exclude titles you've
  marked seen), Clear, and My services / All media /
  Watchlist. Which services count is set in Settings. Open a title to see its plot, cast and where it streams, mark it
  seen, add it to your watchlist, or open its app.
- **Back after an app closes.** Apps open from the dock (recently used first). A small background helper watches the app
  and brings BigTuna Home back when it closes or leaves the screen (YouTube included).
- **Quietly in the background.** A dim night clock after 5 minutes idle late at night; settings backed up to the TV's own
  storage (they survive an uninstall); New York weather every 30 minutes.
- **Private.** No ads, no tracking, no third-party scripts. It talks only to TMDB, OMDb, Open-Meteo (weather) and its own
  helper on the TV.

## Getting started

You'll need a 2020 Samsung TV on Tizen 5.5 (other years may need changes), an Apple Silicon Mac, and two free API keys.
An AI coding assistant helps a lot: `CLAUDE.md` describes the project for one.

1. **Get the code** on your Mac (GitHub's green **Code** button, then *Download ZIP*, or `git clone`).
2. **Get your keys.** TMDB: make a free account at themoviedb.org, then Settings > API > *API Read Access Token*.
   OMDb: request a free key at omdbapi.com (1,000 lookups a day). Copy `config/keys.example.txt` to `config/keys.txt`
   and paste them in. Without keys the app shows sample movies.
3. **Tell it about your TV.** Copy `config/tv.example.txt` to `config/tv.txt` and put in your TV's IP address
   (TV: Settings > General > Network > Network Status > IP Settings). Reserving that address in your router keeps it fixed.
4. **Turn on Developer Mode** on the TV: Apps, then type 1 2 3 4 5 on the remote, Developer mode On, Host PC IP = your
   Mac's IP address, then restart the TV.
5. **One-time setup:** `tools/setup-mac.sh` installs Samsung's signing tool and makes your signing certificate.
6. **Build and install:** `tools/deploy.sh`. Try it in your browser first with `tools/preview.sh`: without keys (or with
   `?sample=1` in the address) it shows sample movies and two test people, "Alex - Full Mode" and "Sam - Simple Mode".

Your keys, TV details and certificate stay on your Mac: `config/keys.txt` and `config/tv.txt` are never uploaded.

## Everyday commands (Terminal, from the project folder)

| What | Command |
|---|---|
| Preview in your browser (real data) | `tools/preview.sh` |
| Build and install on the TV | `tools/deploy.sh` |
| Remove it from the TV | `python3 tools/install.py --uninstall` |
| Check your API keys | `tools/check-keys.sh` |
| Turn the TV on / off from the Mac | `python3 tools/remote.py wake` / `python3 tools/remote.py KEY_POWER` |

## Folders

- `app/` the app itself (HTML, CSS, JavaScript, and the background helper in `app/service/`). No keys in here.
- `config/` your keys and TV details (`keys.txt`, `tv.txt`, made from the `.example` files). Built into the TV copy only.
- `tools/` setup, build, install, preview, remote and test scripts.
- `build/` made by the build script; safe to delete.

## Your certificate

Signing uses the `TVHome` certificate in `~/tizen-studio-data/keystore/author/TVHome.p12`, password in your Mac's Keychain.
Updates must be signed with the same certificate. To build from another computer, copy that file and remember its password.

## On the TV

- Remote: arrows, OK, Back. Red: Full/Simple layout. Green: my services/all media/watchlist. Yellow: IMDb/Metacritic. Blue: settings.
- Home always opens Samsung's own screen.
- To have the TV start in BigTuna Home: Settings, General, Smart Features, Autorun Last App: On.

## Credits and licence

Ratings from IMDb and Metacritic via OMDb. Streaming availability from TMDB and JustWatch. This product uses the TMDB API
but is not endorsed or certified by TMDB. Weather by Open-Meteo. The Samsung app filter and the Wi-Fi installer are
adapted from Free My TV (MIT License); the background helper's approach comes from Skylight by Saud Satopay (MIT License).
Their licences are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

BigTuna Home is released under the [MIT License](LICENSE). It isn't affiliated with Samsung, TMDB, OMDb or any streaming
service, and it's provided as is: Developer Mode and sideloaded apps are at your own risk.
