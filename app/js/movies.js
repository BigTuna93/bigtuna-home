/*
 * BigTuna Home: top-rated movies.
 * TMDB finds candidates and says where each streams in the US (its watch data comes from JustWatch);
 * OMDb gives each one's IMDb rating, IMDb vote count and Metacritic score. Everything is cached on the TV.
 */
var Movies = (function () {
  'use strict';
  var KEYS = window.KEYS || {};
  var TMDB = 'https://api.themoviedb.org/3';
  var IMG = 'https://image.tmdb.org/t/p/';
  var DAY = 864e5;
  var sample = !KEYS.tmdb || !KEYS.omdb || /[?&]sample=1/.test(location.search);
  // OMDb's daily limit: once reached, no lookups until the next day (UTC midnight, when OMDb's count starts over).
  // Remembered across restarts, so the app doesn't keep asking.
  function omdbOut() { var until = Store.cacheGet('omdbOut', 0); return !!until && Date.now() < until; }
  function limitReached() {
    var d = new Date();
    Store.cacheSet('omdbOut', Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  }

  // MARK: - Requests

  function get(url, headers, done) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = 15000;
    for (var h in headers) x.setRequestHeader(h, headers[h]);
    x.onload = function () {
      var body = null;
      try { body = JSON.parse(x.responseText); } catch (e) {}
      done(x.status >= 200 && x.status < 300 ? body : null, x.status, body);
    };
    x.onerror = x.ontimeout = function () { done(null, 0, null); };
    x.send();
  }

  function tmdb(path, params, done) {
    var q = [];
    params = params || {};
    params.language = 'en-US';
    for (var k in params) if (params[k] !== undefined && params[k] !== '') q.push(k + '=' + encodeURIComponent(params[k]));
    get(TMDB + path + '?' + q.join('&'), {Authorization: 'Bearer ' + KEYS.tmdb, Accept: 'application/json'}, done);
  }

  function omdb(imdbId, done) {
    if (omdbOut() || !/^tt\d{5,10}$/.test(String(imdbId))) { done(null); return; }   // only real IMDb ids go into the address
    get('https://www.omdbapi.com/?i=' + imdbId + '&apikey=' + KEYS.omdb, {}, function (r, status, body) {
      if (body && body.Response === 'False' && /limit/i.test(body.Error || '')) limitReached();
      done(r && r.Response === 'True' ? r : null);
    });
  }

  /** Runs tasks (each takes a done callback) at most n at a time; then all(). */
  function pool(tasks, n, all) {
    var next = 0, running = 0, left = tasks.length;
    if (!left) { all(); return; }
    function run() {
      while (running < n && next < tasks.length) {
        running++;
        tasks[next++](function () { running--; if (--left === 0) all(); else run(); });
      }
    }
    run();
  }

  // MARK: - Services and genres

  // Brands TMDB lists under several names (plans with ads, renamed services): one service each here.
  function brandName(name) {
    var n = name.replace(/\s+(Standard|Basic)?\s*with Ads$/i, '')
      .replace(/^Peacock Premium( Plus)?$/i, 'Peacock')
      .replace(/^Paramount(\+| Plus)( with Showtime| Premium| Essential)?$/i, 'Paramount+')
      .replace(/^(HBO )?Max$/i, 'HBO Max')
      .replace(/^Apple TV( Plus|\+)$/i, 'Apple TV')
      .replace(/^Disney Plus$/i, 'Disney+');
    return n;
  }
  function norm(s) { return String(s).toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, ''); }

  // TV app names that differ from the service's name.
  var APP_ALIAS = {primevideo: 'amazonprimevideo', amazon: 'amazonprimevideo', max: 'hbomax', appletvplus: 'appletv',
                   paramount: 'paramountplus', tubi: 'tubitv', pluto: 'plutotv', rokuchannel: 'therokuchannel'};

  // Places that only rent or sell movies: not subscriptions, so not in the list.
  var STORES = /^(JustWatch TV|Amazon Video$|Apple TV Store$|Google Play Movies|Fandango At Home|Vudu|Microsoft Store|Spectrum On Demand|Redbox|AMC on Demand|DIRECTV|Verizon|Xfinity)/i;

  var providers = [];   // [{id (main id), ids: [all TMDB ids of the brand], name, logo}]
  var genres = [];      // [{id, name}]

  function loadLists(done) {
    if (sample) { providers = SAMPLE_PROVIDERS; genres = SAMPLE_GENRES; done(true); return; }
    var p = Store.cacheGet('providers2', 7 * DAY), g = Store.cacheGet('genres', 30 * DAY);
    if (p && g) { providers = p; genres = g; done(true); return; }
    var left = 2, ok = true;
    function one() { if (--left === 0) done(ok); }
    tmdb('/watch/providers/movie', {watch_region: 'US'}, function (r) {
      if (!r) { ok = false; one(); return; }
      // A priority of 0 is the top of the list (Netflix), not a missing one.
      var prio = function (x) {
        var us = (x.display_priorities || {}).US;
        return typeof us === 'number' ? us : typeof x.display_priority === 'number' ? x.display_priority : 999;
      };
      var list = r.results.slice().sort(function (a, b) { return prio(a) - prio(b); });
      var byBrand = {}, out = [];
      list.forEach(function (x) {
        if (/ (Amazon|Apple TV|Roku Premium) Channel$/i.test(x.provider_name) || STORES.test(x.provider_name)) return;
        var name = brandName(x.provider_name), key = norm(name);
        if (!byBrand[key]) {
          byBrand[key] = {id: x.provider_id, ids: [], name: name, logo: x.logo_path ? IMG + 'w92' + x.logo_path : ''};
          out.push(byBrand[key]);
        }
        byBrand[key].ids.push(x.provider_id);
      });
      providers = out.slice(0, 45);
      Store.cacheSet('providers2', providers);
      one();
    });
    tmdb('/genre/movie/list', {}, function (r) {
      if (!r) { ok = false; one(); return; }
      genres = r.genres;
      Store.cacheSet('genres', genres);
      one();
    });
  }

  function provider(id) {
    for (var i = 0; i < providers.length; i++) if (providers[i].id === id || providers[i].ids.indexOf(id) >= 0) return providers[i];
    return null;
  }

  /** The service an installed TV app is, or null. */
  function providerForApp(app) {
    var a = norm(app.title);
    a = APP_ALIAS[a] || a;
    for (var i = 0; i < providers.length; i++) if (norm(providers[i].name) === a) return providers[i];
    if (a.length >= 5) for (var j = 0; j < providers.length; j++) if (norm(providers[j].name).indexOf(a) === 0) return providers[j];
    return null;
  }

  // MARK: - One movie

  function movie(id, done) {
    if (/^tv:/.test(String(id))) { show(id, done); return; }
    if (!/^\d{1,10}$/.test(String(id))) { done(null); return; }   // only real TMDB ids (a saved list could hold anything)
    var key = 'm.' + id, cached = Store.cacheGet(key, 5 * DAY);
    if (cached && cached.tmdbVotes !== undefined) { done(cached); return; }
    tmdb('/movie/' + id, {append_to_response: 'external_ids,watch/providers'}, function (d) {
      if (!d) { done(null); return; }
      var us = ((d['watch/providers'] || {}).results || {}).US || {};
      var where = [];
      ['flatrate', 'free', 'ads'].forEach(function (kind) {
        (us[kind] || []).forEach(function (p) {
          var b = provider(p.provider_id);
          if (b && where.indexOf(b.id) < 0) where.push(b.id);
        });
      });
      var m = {
        id: d.id, title: d.title, year: (d.release_date || '').slice(0, 4), runtime: d.runtime || 0,
        genres: (d.genres || []).map(function (g) { return g.name; }), overview: d.overview || '',
        poster: d.poster_path ? IMG + 'w185' + d.poster_path : '', posterLarge: d.poster_path ? IMG + 'w500' + d.poster_path : '',
        backdrop: d.backdrop_path ? IMG + 'w1280' + d.backdrop_path : '',
        imdbId: d.imdb_id || (d.external_ids || {}).imdb_id || '', where: where,
        tmdbRating: Math.round((d.vote_average || 0) * 10) / 10, tmdbVotes: d.vote_count || 0   // the stand-in when OMDb's limit is reached
      };
      Store.cacheSet(key, m);
      done(m);
    });
  }

  /**
   * A TV series or miniseries. Its id is 'tv:<TMDB id>' everywhere in the app (watchlist, watched, lists), so it can
   * never be mistaken for a movie with the same number. OMDb rates shows by their IMDb id, like movies.
   */
  function show(id, done) {
    if (!/^tv:\d{1,10}$/.test(String(id))) { done(null); return; }
    var key = 'm.' + id, cached = Store.cacheGet(key, 5 * DAY);
    if (cached) { done(cached); return; }
    tmdb('/tv/' + String(id).slice(3), {append_to_response: 'external_ids,watch/providers'}, function (d) {
      if (!d) { done(null); return; }
      var us = ((d['watch/providers'] || {}).results || {}).US || {};
      var where = [];
      ['flatrate', 'free', 'ads'].forEach(function (kind) {
        (us[kind] || []).forEach(function (p) {
          var b = provider(p.provider_id);
          if (b && where.indexOf(b.id) < 0) where.push(b.id);
        });
      });
      var m = {
        id: id, kind: 'tv', tvType: d.type === 'Miniseries' ? 'mini' : 'series',
        title: d.name, year: (d.first_air_date || '').slice(0, 4), lastYear: (d.last_air_date || '').slice(0, 4),
        ongoing: !!d.in_production, seasons: d.number_of_seasons || 0, runtime: (d.episode_run_time || [])[0] || 0,
        genres: (d.genres || []).map(function (g) { return g.name; }), overview: d.overview || '',
        creators: (d.created_by || []).map(function (c) { return c.name; }).slice(0, 3).join(', '),
        poster: d.poster_path ? IMG + 'w185' + d.poster_path : '', posterLarge: d.poster_path ? IMG + 'w500' + d.poster_path : '',
        backdrop: d.backdrop_path ? IMG + 'w1280' + d.backdrop_path : '',
        imdbId: (d.external_ids || {}).imdb_id || '', where: where,
        tmdbRating: Math.round((d.vote_average || 0) * 10) / 10, tmdbVotes: d.vote_count || 0
      };
      Store.cacheSet(key, m);
      done(m);
    });
  }

  // Movie genres have TV counterparts under other ids (TMDB's TV catalogue groups some together).
  var TV_GENRE = {28: 10759, 12: 10759, 878: 10765, 14: 10765, 10752: 10768, 16: 16, 35: 35, 80: 80, 99: 99, 18: 18,
                  10751: 10751, 9648: 9648, 37: 37, 53: 9648, 10749: 18, 36: 10768};
  // TMDB's TV types: 2 = Miniseries; series = Scripted (4), Documentary (0) and Reality (3) (no news or talk shows).
  var TV_TYPES = {series: '4|0|3', mini: '2'};

  function ratings(m, done) {
    if (!m.imdbId) { done(null); return; }
    var key = 'o.' + m.imdbId, cached = Store.cacheGet(key, 30 * DAY);
    if (cached) { done(cached); return; }
    omdb(m.imdbId, function (o) {
      if (!o) { done(null); return; }
      var r = {
        imdb: parseFloat(o.imdbRating) || 0,
        votes: parseInt(String(o.imdbVotes || '0').replace(/,/g, ''), 10) || 0,
        meta: parseInt(o.Metascore, 10) || 0,
        rated: o.Rated && o.Rated !== 'N/A' ? o.Rated : '',
        director: o.Director && o.Director !== 'N/A' ? o.Director : '',
        cast: o.Actors && o.Actors !== 'N/A' ? o.Actors : ''
      };
      Store.cacheSet(key, r);
      done(r);
    });
  }

  /** TMDB's own score in place of IMDb's (marked src 'tmdb'; no Metacritic). Never saved as a rating. */
  function tmdbStandIn(m) {
    return {imdb: m.tmdbRating || 0, votes: m.tmdbVotes || 0, meta: 0, rated: '', director: '', cast: '', src: 'tmdb'};
  }

  function full(id, done) {
    movie(id, function (m) {
      if (!m) { done(null); return; }
      ratings(m, function (r) {
        if (!r && omdbOut() && m.tmdbVotes) r = tmdbStandIn(m);
        if (!r) { done(null); return; }
        var out = {};
        for (var k in m) out[k] = m[k];
        for (var j in r) out[j] = r[j];
        done(out);
      });
    });
  }

  // MARK: - The list

  /**
   * q: {scope, service, services, genre, year, kind, rankBy, minVotes, listSize, exclude}. exclude: ids left out (watched).
   * kind: any of 'movie', 'series', 'mini' ([] = all three).
   * update(list, state): state is 'cached', 'loading' (partial), 'done', or 'error'.
   */
  /** A short code standing for a list of ids (the watched movies), so saved-list names stay small. */
  function short(ids) {
    if (!ids.length) return '';
    var str = ids.slice().sort().join(','), h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return ids.length + 'w' + h.toString(36);
  }

  function top(q, update) {
    if (sample) { sampleTop(q, update); return; }
    var kinds = q.kind && q.kind.length ? q.kind : ['movie', 'series', 'mini'];
    var key = 't.' + [q.scope, q.service.join('-'), q.scope === 'mine' ? q.services.join('-') : '', q.genre.join('-'), q.year.join('-'), q.rankBy, q.minVotes, q.listSize, short(q.exclude)].join('.') +
      (kinds.join('-') === 'movie' ? '' : '.k' + kinds.slice().sort().join('-'));
    var cached = Store.cacheGet(key, 2 * DAY);
    if (cached) { update(cached, 'done'); return; }
    var stale = Store.cacheGet(key, 0);
    if (stale) update(stale, 'cached');

    var ids = [];
    if (q.service.length) q.service.forEach(function (s) { ids = ids.concat((provider(s) || {ids: [s]}).ids); });
    else if (q.scope === 'mine') q.services.forEach(function (s) { ids = ids.concat((provider(s) || {ids: [s]}).ids); });
    if (q.scope === 'mine' && !ids.length) { update([], 'done'); return; }

    var params = {
      sort_by: 'vote_average.desc',
      'vote_count.gte': Math.max(150, Math.round(q.minVotes / 70)),
      include_adult: 'false', include_video: 'false'
    };
    if (ids.length) {
      params.watch_region = 'US';
      params.with_watch_providers = ids.join('|');
      params.with_watch_monetization_types = 'flatrate|free|ads';
    }
    // One search per type (movies, TV) and per picked year or decade, merged. They all share one page budget,
    // so ticking more types or years doesn't use more OMDb lookups.
    var spans = q.year.length ? yearSpans(q.year) : [null], sets = [];
    var tvTypes = kinds.filter(function (k) { return TV_TYPES[k]; }).map(function (k) { return TV_TYPES[k]; }).join('|');
    var tvGenres = q.genre.map(function (g) { return TV_GENRE[g]; }).filter(function (g, i, a) { return g && a.indexOf(g) === i; });
    spans.forEach(function (span) {
      var p, k;
      if (kinds.indexOf('movie') >= 0) {
        p = {};
        for (k in params) p[k] = params[k];
        if (q.genre.length) p.with_genres = q.genre.join('|');   // | = any of them
        if (span) { p['primary_release_date.gte'] = span[0] + '-01-01'; p['primary_release_date.lte'] = span[1] + '-12-31'; }
        sets.push({path: '/discover/movie', tv: false, params: p, total: 500});
      }
      // TV: skipped when every picked genre is one TV doesn't have (Horror, say).
      if (tvTypes && (!q.genre.length || tvGenres.length)) {
        p = {};
        for (k in params) if (k !== 'include_video') p[k] = params[k];
        p.with_type = tvTypes;
        if (tvGenres.length) p.with_genres = tvGenres.join('|');
        if (span) { p['first_air_date.gte'] = span[0] + '-01-01'; p['first_air_date.lte'] = span[1] + '-12-31'; }
        sets.push({path: '/discover/tv', tv: true, params: p, total: 500});
      }
    });
    if (!sets.length) { update([], 'done'); return; }

    // Critic scores line up less with TMDB's order, so they look further down it.
    var maxPages = Math.max(2, Math.ceil((q.rankBy === 'meta' ? 12 : 8) / sets.length));
    var minPages = Math.max(2, Math.ceil((q.rankBy === 'meta' ? 6 : 4) / sets.length));
    var page = 0, seen = {}, found = [];
    function exhausted() { return page >= maxPages || sets.every(function (s) { return page >= s.total; }); }

    function rank(list) {
      var key2 = q.rankBy === 'meta' ? 'meta' : 'imdb';
      return list.filter(function (m) {
        var need = m.src === 'tmdb' ? Math.max(150, Math.round(q.minVotes / 70)) : q.minVotes;
        // Ranked by Metacritic with the limit reached: TMDB-scored movies still show (after those with a Metacritic score).
        return m.votes >= need && (key2 !== 'meta' || m.meta > 0 || m.src === 'tmdb') && q.exclude.indexOf(m.id) < 0;
      })
        .sort(function (a, b) { return (b[key2] - a[key2]) || (b.imdb - a.imdb) || (b.votes - a.votes); })
        .slice(0, q.listSize);
    }

    function morePages() {
      if (exhausted()) { finish(); return; }
      var batch = [];
      [page + 1, page + 2].forEach(function (p) {
        if (p > maxPages) return;
        sets.forEach(function (s) { if (p <= s.total) batch.push({set: s, page: p}); });
      });
      page = Math.min(page + 2, maxPages);
      var newIds = [];
      pool(batch.map(function (b) {
        return function (done) {
          var params2 = {};
          for (var k in b.set.params) params2[k] = b.set.params[k];
          params2.page = b.page;
          tmdb(b.set.path, params2, function (r) {
            if (r) {
              b.set.total = Math.min(r.total_pages || 1, 500);
              r.results.forEach(function (x) {
                var id = b.set.tv ? 'tv:' + x.id : x.id;
                if (!seen[id]) { seen[id] = 1; newIds.push(id); }
              });
            }
            done();
          });
        };
      }), 4, function () {
        if (!newIds.length && !found.length && exhausted()) { finish(); return; }
        pool(newIds.map(function (id) {
          return function (done) {
            full(id, function (m) { if (m) found.push(m); done(); });
          };
        }), 6, function () {
          var list = rank(found);
          // Enough once the list is full and its last entry beats anything the next pages are likely to hold.
          if (list.length >= q.listSize && page >= minPages) { finish(); return; }
          if (list.length) update(list, 'loading');
          morePages();
        });
      });
    }

    function finish() {
      var list = rank(found);
      // A list made while the ratings limit is reached may be missing movies: not saved, so tomorrow's is complete.
      if (!omdbOut() && (list.length || !stale)) Store.cacheSet(key, list);
      update(list, found.length || !omdbOut() ? 'done' : 'error');
    }

    morePages();
  }

  /**
   * Movies by id, in that order (the watchlist). Mostly from the cache, so quick and light on OMDb.
   * A movie whose ratings can't be had right now (OMDb's daily limit) still shows, without scores.
   */
  var NO_RATINGS = {imdb: 0, votes: 0, meta: 0, rated: '', director: '', cast: ''};
  function byIds(ids, done) {
    if (sample) {
      var all = sampleMovies();
      done(ids.map(function (id) { for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }).filter(Boolean));
      return;
    }
    var out = [];
    pool(ids.map(function (id, i) {
      return function (next) {
        movie(id, function (m) {
          if (!m) { next(); return; }
          ratings(m, function (r) {
            var x = {}, k;
            for (k in m) x[k] = m[k];
            r = r || (m.tmdbVotes ? tmdbStandIn(m) : NO_RATINGS);
            for (k in r) x[k] = r[k];
            out[i] = x;
            next();
          });
        });
      };
    }), 6, function () { done(out.filter(Boolean)); });
  }

  /** ['2010s', '2015', '1994'] -> [[2010, 2019], [1994, 1994]]: years already inside a picked decade are dropped. */
  function yearSpans(years) {
    var decades = years.filter(function (y) { return /^\d{4}s$/.test(y); }).map(function (y) { return parseInt(y, 10); });
    var spans = decades.map(function (d) { return [d, d + 9]; });
    years.forEach(function (y) {
      if (!/^\d{4}$/.test(y)) return;
      var n = parseInt(y, 10);
      if (decades.indexOf(Math.floor(n / 10) * 10) < 0) spans.push([n, n]);
    });
    return spans;
  }

  /** Clears the cached lists (not the per-movie ratings, which don't change much). */
  function refresh() {
    Store.removeAll(Store.keys(/^bthc\.(t\.|providers|m\.)/));
  }

  // MARK: - Sample data (the preview without keys or network)

  var SAMPLE_PROVIDERS = [
    {id: 8, ids: [8], name: 'Netflix', logo: ''}, {id: 9, ids: [9], name: 'Amazon Prime Video', logo: ''},
    {id: 337, ids: [337], name: 'Disney+', logo: ''}, {id: 1899, ids: [1899], name: 'HBO Max', logo: ''},
    {id: 15, ids: [15], name: 'Hulu', logo: ''}, {id: 350, ids: [350], name: 'Apple TV', logo: ''},
    {id: 531, ids: [531], name: 'Paramount+', logo: ''}, {id: 386, ids: [386], name: 'Peacock', logo: ''}
  ];
  var SAMPLE_GENRES = [{id: 28, name: 'Action'}, {id: 35, name: 'Comedy'}, {id: 18, name: 'Drama'}, {id: 878, name: 'Science Fiction'}, {id: 53, name: 'Thriller'}];
  var SAMPLE_MOVIES = [
    ['The Long Harbor', 1994, 142, 9.3, 3000000, 82, 8, ['Drama'], 'R'], ['Northern Lights', 2008, 152, 9.0, 2900000, 84, 1899, ['Action', 'Drama'], 'PG-13'],
    ['A Quiet Orbit', 2014, 169, 8.7, 2300000, 74, 9, ['Science Fiction', 'Drama'], 'PG-13'], ['Paper Cities', 2019, 132, 8.5, 1000000, 96, 15, ['Comedy', 'Thriller'], 'R'],
    ['The Last Signal', 2010, 148, 8.8, 2600000, 74, 8, ['Science Fiction', 'Action'], 'PG-13'], ['Saltwater', 2023, 180, 8.3, 900000, 89, 386, ['Drama'], 'R'],
    ['Glass Horizon', 2021, 155, 8.0, 950000, 74, 1899, ['Science Fiction'], 'PG-13'], ['Midnight Ferry', 2003, 111, 7.9, 30000, 71, 337, ['Comedy'], 'PG'],
    ['Copper Valley', 2007, 158, 8.2, 1100000, 91, 531, ['Drama', 'Thriller'], 'R'], ['Small Hours', 2016, 107, 8.1, 600000, 88, 350, ['Drama'], 'PG-13'],
    ['Echo Park Run', 2011, 100, 7.8, 750000, 78, 8, ['Action', 'Thriller'], 'R'], ['The Lantern Keeper', 2001, 125, 8.6, 850000, 96, 337, ['Comedy', 'Drama'], 'PG']
  ];
  // Sample shows: [title, first aired, seasons, IMDb, votes, Metacritic (0: none, as for most shows), service, genres, miniseries?, still on?]
  var SAMPLE_SHOWS = [
    ['Harbor Lights', 2008, 5, 9.5, 2100000, 0, 8, ['Drama'], false, false], ['The Long Winter', 2019, 1, 9.3, 850000, 91, 1899, ['Drama'], true, false],
    ['Night Shift', 2015, 4, 8.6, 640000, 0, 15, ['Comedy'], false, true], ['Orbit Station', 2021, 3, 8.4, 420000, 0, 9, ['Science Fiction'], false, true],
    ['Glass House', 2022, 1, 8.2, 260000, 84, 337, ['Thriller', 'Drama'], true, false]
  ];
  function sampleMovies() {
    return SAMPLE_MOVIES.map(function (s, i) {
      return {id: i + 1, title: s[0], year: String(s[1]), runtime: s[2], imdb: s[3], votes: s[4], meta: s[5], where: [s[6]], genres: s[7], rated: s[8],
              overview: 'A sample movie for the preview. With your TMDB and OMDb keys built in, this shows the real plot, cast and artwork.',
              director: 'Sample Director', cast: 'First Actor, Second Actor, Third Actor', poster: '', posterLarge: '', backdrop: '', imdbId: '', hue: (i * 47) % 360};
    }).concat(SAMPLE_SHOWS.map(function (s, i) {
      return {id: 'tv:' + (101 + i), kind: 'tv', tvType: s[8] ? 'mini' : 'series', title: s[0], year: String(s[1]), lastYear: s[9] ? '' : String(s[1] + s[2] - 1),
              ongoing: s[9], seasons: s[2], runtime: 55, imdb: s[3], votes: s[4], meta: s[5], where: [s[6]], genres: s[7], rated: 'TV-MA',
              overview: 'A sample show for the preview. With your keys built in, this shows the real plot, cast and artwork.',
              creators: 'Sample Creator', cast: 'First Actor, Second Actor', poster: '', posterLarge: '', backdrop: '', imdbId: '', hue: (i * 61 + 20) % 360};
    }));
  }
  function kindOf(m) { return m.kind === 'tv' ? m.tvType : 'movie'; }
  function sampleTop(q, update) {
    var gnames = SAMPLE_GENRES.filter(function (g) { return q.genre.indexOf(g.id) >= 0; }).map(function (g) { return g.name; });
    var spans = yearSpans(q.year);
    var kinds = q.kind && q.kind.length ? q.kind : ['movie', 'series', 'mini'];
    var list = sampleMovies().filter(function (m) {
      if (q.exclude.indexOf(m.id) >= 0) return false;
      if (kinds.indexOf(kindOf(m)) < 0) return false;
      if (q.scope === 'mine' && q.services.indexOf(m.where[0]) < 0) m.where = [];
      if (q.scope === 'mine' && !m.where.length) return false;
      if (q.service.length && !m.where.some(function (w) { return q.service.indexOf(w) >= 0; })) return false;
      if (gnames.length && !m.genres.some(function (g) { return gnames.indexOf(g) >= 0; })) return false;
      if (spans.length && !spans.some(function (s) { return m.year >= s[0] && m.year <= s[1]; })) return false;
      return m.votes >= q.minVotes;
    });
    var k = q.rankBy === 'meta' ? 'meta' : 'imdb';
    if (k === 'meta') list = list.filter(function (m) { return m.meta > 0; });   // as in real lists
    list.sort(function (a, b) { return b[k] - a[k]; });
    setTimeout(function () { update(list.slice(0, q.listSize), 'done'); }, 150);
  }

  return {
    sample: sample,
    loadLists: loadLists,
    providers: function () { return providers; },
    genres: function () { return genres; },
    provider: provider,
    providerForApp: providerForApp,
    top: top,
    byIds: byIds,
    refresh: refresh,
    omdbLimited: omdbOut
  };
})();
