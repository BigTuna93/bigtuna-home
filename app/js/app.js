/* BigTuna Home: the screen, the remote, the settings. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var K = TV.keys;
  var ZONE = 'America/New_York';
  var STEP = 176;   // a movie card and its gap
  var COLS = 6;     // apps per row in the Simple layout

  /** The Simple layout: clock and bigger apps only, no movies. */
  function simple() { return Store.get('layout') === 'simple'; }

  var S = {
    apps: [], dock: [], movies: [], loading: false, state: '',
    zone: 'movies', fIdx: 0, mIdx: 0, dIdx: 0,
    overlay: null,     // 'detail' | 'list'
    lists: [],         // the open picker/settings lists, last on top
    detail: null, loadId: 0,
    lastKey: Date.now(),   // for the night screen
    welcome: false,        // "Who's watching?" at the start: only the name, clock and a calm scene behind it
    appOpenedAt: 0,        // when BigTuna Home last opened an app
    hiddenAt: 0, hiddenByApp: false,   // when it last left the screen, and whether an app it opened took the screen
    reloadAfter: false     // the list changes when the detail card closes
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function votes(n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n); }
  function runtime(m) { return m ? (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60 ? (m % 60) + 'm' : '') : ''; }
  function mcClass(v) { return !v ? 'mc-none' : v >= 61 ? 'mc-good' : v >= 40 ? 'mc-mixed' : 'mc-bad'; }
  /** An image address from TMDB's image server, or '' (nothing else is put into the page as an image). */
  function img(u) { return typeof u === 'string' && /^https:\/\/image\.tmdb\.org\/t\/p\/\w+\/[\w.-]+$/.test(u) ? u : ''; }
  function grad(h) { return 'linear-gradient(135deg, hsl(' + h + ',42%,34%), hsl(' + ((h + 50) % 360) + ',48%,13%))'; }

  // MARK: - Clock and theme

  function nyParts() {
    var d = new Date(), out = {date: d};
    try {
      out.time = d.toLocaleTimeString('en-US', {timeZone: ZONE, hour: 'numeric', minute: '2-digit', hour12: !Store.get('clock24')});
      out.day = d.toLocaleDateString('en-US', {timeZone: ZONE, weekday: 'long', month: 'long', day: 'numeric'});
      out.hour = parseInt(d.toLocaleTimeString('en-US', {timeZone: ZONE, hour: 'numeric', hour12: false}), 10) % 24;
    } catch (e) {
      out.time = d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
      out.day = d.toDateString();
      out.hour = d.getHours();
    }
    return out;
  }

  function tick() {
    var p = nyParts();
    $('time').textContent = p.time;
    $('date').textContent = p.day;
    applyTheme(p.hour);
    nightCheck(p);
    // A quiet note while OMDb's daily limit is reached (not in Simple, which shows no movies).
    $('limit').hidden = simple() || !Movies.omdbLimited();
  }

  function showWeather() {
    if (!Store.get('weather')) { $('weather').textContent = ''; return; }
    Weather.now(function (w) {
      $('weather').textContent = !w || !Store.get('weather') ? '' : w.temp + '°  ' + w.text + '   H ' + w.hi + '°  L ' + w.lo + '°';
    });
  }

  // MARK: - Night screen: a dim clock late at night, after a few minutes without a key press

  var IDLE = (parseInt((/[?&]idle=(\d+)/.exec(location.search) || [])[1], 10) * 1000) || 5 * 60 * 1000;
  function isNight(hour) {
    var from = Store.get('night');
    if (from === 'off') return false;
    return from === 0 ? hour < 6 : hour >= from || hour < 6;
  }
  function nightCheck(p) {
    var el = $('night');
    if (!el.hidden) {
      // Drift a little each minute, so nothing sits in one place all night.
      var m = p.date.getMinutes();
      $('nightClock').innerHTML = esc(p.time) + '<div class="night-date">' + esc(p.day) + '</div>';
      $('nightClock').style.transform = 'translate(' + ((m * 37) % 240 - 120) + 'px,' + ((m * 53) % 160 - 80) + 'px)';
      if (!isNight(p.hour)) el.hidden = true;
      return;
    }
    if (isNight(p.hour) && Date.now() - S.lastKey > IDLE && !document.hidden) { el.hidden = false; nightCheck(p); }
  }

  function applyTheme(hour) {
    var t = Store.get('theme');
    if (t === 'auto') t = (hour >= 19 || hour < 7) ? 'dark' : 'light';
    var cls = 'theme-' + t + (Store.get('animations') ? '' : ' no-anim') + (simple() ? ' simple' : '') +
      (S.welcome || S.preWelcome ? ' welcome' : '') + ((simple() || S.welcome || S.preWelcome) && Store.get('backdrop') !== 'off' ? ' scenic' : '');
    if (document.body.className.indexOf(' fast') >= 0) cls += ' fast';
    if (document.body.className !== cls) document.body.className = cls;
  }

  // MARK: - Toast

  var toastTimer;
  function toast(text, ms) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, ms || 2600);
  }

  // MARK: - Filters

  var YEARS = ['2020s', '2010s', '2000s', '1990s', '1980s', '1970s', '1960s', '1950s'];
  (function () { for (var y = new Date().getFullYear(); y >= 1980; y--) YEARS.push(String(y)); })();

  function myServices() { return Store.get('services') || []; }

  /** Watched movies and the watchlist: lists of TMDB ids kept for each person. */
  function has(key, id) { return Store.get(key).indexOf(id) >= 0; }
  function toggleIn(key, id) {
    var a = Store.get(key).slice(), i = a.indexOf(id);
    if (i >= 0) a.splice(i, 1); else a.unshift(id);
    Store.set(key, a);
    return i < 0;
  }

  /** What's ticked in a multi-select filter ([] = all). Older versions kept a single value (0 or 'all' meaning all). */
  function ticked(key) {
    var s = Store.get(key);
    return s instanceof Array ? s : s && s !== 'all' ? [s] : [];
  }
  function picked() { return ticked('service'); }
  function pickedGenres() { return ticked('genre'); }
  function pickedYears() { return YEARS.filter(function (y) { return ticked('year').indexOf(y) >= 0; }); }

  /** "Drama", or "Drama + 2" when several are ticked. */
  function several(names, none) { return !names.length ? none : names.length === 1 ? names[0] : names[0] + ' + ' + (names.length - 1); }

  function serviceLabel() {
    return several(picked().map(function (id) { var p = Movies.provider(id); return p ? p.name : 'Service'; }),
                   'All of mine');
  }

  function genreLabel() {
    var sel = pickedGenres();
    return several(Movies.genres().filter(function (g) { return sel.indexOf(g.id) >= 0; }).map(function (g) { return g.name; }), 'All');
  }

  // The Type filter: movies, TV series, miniseries (multi-select; each person starts on movies only).
  var KINDS = [{id: 'movie', label: 'Movies'}, {id: 'series', label: 'TV Series'}, {id: 'mini', label: 'Miniseries'}];
  function pickedKinds() { return KINDS.map(function (k) { return k.id; }).filter(function (id) { return ticked('kind').indexOf(id) >= 0; }); }
  function moviesOnly() { var k = pickedKinds(); return k.length === 1 && k[0] === 'movie'; }
  function kindLabel() {
    var sel = pickedKinds();
    return several(KINDS.filter(function (k) { return sel.indexOf(k.id) >= 0; }).map(function (k) { return k.label; }), 'All');
  }
  /** "movies", or "titles" once TV is in the mix. */
  function titlesWord() { return moviesOnly() ? 'movies' : 'titles'; }

  /** How many filters are narrowing the list (Type counts when it isn't the usual movies-only). The services shown
   *  are chosen in Settings and rarely change, so they're not counted (or cleared) here. */
  function activeFilters() {
    return (pickedGenres().length ? 1 : 0) + (pickedYears().length ? 1 : 0) + (moviesOnly() ? 0 : 1);
  }

  /** The chips in the filter row, in order: Clear only while a filter is on. */
  function filterIds() {
    return ['rank', 'genre', 'year', 'type'].concat(activeFilters() ? ['clear'] : []).concat(['scope']);
  }

  /** Back to all genres and years, and movies only. Services shown, Ranked by and My services / All / Watchlist stay. */
  function clearFilters() {
    Store.set('genre', []);
    Store.set('year', []);
    Store.set('kind', ['movie']);
    S.fIdx = 0;
    toast('Filters cleared');
    filtersChanged();
  }

  function renderFilters() {
    var f = Store.get('rankBy') === 'meta' ? 'Metacritic' : 'IMDb rating';
    var scope = Store.get('scope');
    var html =
      chip('rank', 'Ranked by', f, false) +
      chip('genre', 'Genre', genreLabel(), pickedGenres().length > 0) +
      chip('year', 'Year', several(pickedYears(), 'Any year'), pickedYears().length > 0) +
      chip('type', 'Type', kindLabel(), !moviesOnly()) +
      (activeFilters() ? '<div class="chip clear" data-f="clear">✕ Clear ' + activeFilters() + '</div>' : '') +
      '<div class="seg" data-f="scope"><span class="' + (scope === 'mine' ? 'sel' : '') + '">My services</span><span class="' + (scope === 'all' ? 'sel' : '') + '">All media</span>' +
      '<span class="' + (scope === 'watchlist' ? 'sel' : '') + '">Watchlist</span></div>';
    $('filters').innerHTML = html;
    S.fIdx = Math.min(S.fIdx, filterIds().length - 1);   // the Clear chip comes and goes
    focusDraw();
  }
  function chip(id, k, v, active) { return '<div class="chip' + (active ? ' active' : '') + '" data-f="' + id + '"><span class="k">' + k + '</span>' + esc(v) + '</div>'; }

  function openFilter(id) {
    if (id === 'scope') { toggleScope(); return; }
    if (id === 'service') { openServiceFilter(); return; }
    if (id === 'clear') { clearFilters(); return; }
    if (id === 'type') {
      openMulti('Type', 'kind', function () { return 'All types'; }, function () { return KINDS; });
      return;
    }
    if (id === 'genre') {
      openMulti('Genre', 'genre', function () { return 'All genres'; },
                function () { return Movies.genres().map(function (g) { return {id: g.id, label: g.name}; }); });
      return;
    }
    if (id === 'year') {
      openMulti('Year', 'year', function () { return 'Any year'; },
                function () { return YEARS.map(function (y) { return {id: y, label: y}; }); });
      return;
    }
    var title = 'Rank movies by', cur = Store.get('rankBy');
    var items = [['imdb', 'IMDb user rating'], ['meta', 'Metacritic critic score']];
    var set = function (v) { Store.set('rankBy', v); };
    openList({
      kind: 'picker', title: title,
      items: items.map(function (x) {
        return {label: x[1], img: x[2], sel: x[0] === cur, val: x[0] === cur ? '✓' : '',
                ok: function () { set(x[0]); closeList(); filtersChanged(); }};
      }),
      start: Math.max(0, items.map(function (x) { return x[0]; }).indexOf(cur))
    });
  }

  /**
   * A filter you can tick one or several values in (Genre, Service, Year); the list updates when it closes.
   * allLabel() names the "all" row; options() gives [{id, label, img}].
   */
  function openMulti(title, key, allLabel, options) {
    var before = ticked(key).join('-');
    var items = function () {
      var sel = ticked(key);
      return [{label: allLabel(), check: !sel.length, ok: function () { Store.set(key, []); refreshList(items()); }}]
        .concat(options().map(function (o) {
          return {label: o.label, img: o.img, check: sel.indexOf(o.id) >= 0,
                  ok: function () {
                    var s = ticked(key).slice(), i = s.indexOf(o.id);
                    if (i >= 0) s.splice(i, 1); else s.push(o.id);
                    Store.set(key, s);
                    refreshList(items());
                  }};
        }));
    };
    openList({kind: 'picker', title: title, hint: 'OK to tick one or more. Back when done.', items: items(),
              onClose: function () { if (ticked(key).join('-') !== before) filtersChanged(); }});
  }

  function openServiceFilter() {
    openMulti('Services in the list', 'service', function () { return 'All of my services'; }, function () {
      var list = myServices().map(function (id) { return Movies.provider(id); }).filter(Boolean);
      return list.map(function (p) { return {id: p.id, label: p.name, img: p.logo}; });
    });
  }

  var SCOPES = ['mine', 'all', 'watchlist'];
  function toggleScope() {
    cycle('scope', SCOPES, 1);
    scopeChanged();
    toast({mine: 'Showing movies on your services', all: 'Showing all media', watchlist: person().name + '\'s watchlist'}[Store.get('scope')]);
    filtersChanged();
  }
  // Only your services can be ticked in "Services in the list" (it narrows My services; All media ignores it).
  function scopeChanged() {
    var mine = picked().filter(function (id) { return myServices().indexOf(id) >= 0; });
    if (mine.length !== picked().length) Store.set('service', mine);
  }

  function filtersChanged() { renderFilters(); S.mIdx = 0; load(); }

  // MARK: - Movies

  function query() {
    return {scope: Store.get('scope'), service: Store.get('scope') === 'mine' ? picked() : [], services: myServices(), genre: pickedGenres(),
            year: pickedYears(), kind: pickedKinds(), rankBy: Store.get('rankBy'), minVotes: Store.get('minVotes'), listSize: Store.get('listSize'),
            exclude: Store.get('showWatched') ? [] : Store.get('watched')};
  }

  function load() {
    if (simple()) return;   // no movies on screen, so no lookups either
    var id = ++S.loadId;
    S.loading = true;
    S.movies = [];
    renderRow(true);
    updateHero();
    var done = function (list, state) {
      if (id !== S.loadId) return;
      S.movies = list;
      S.state = state;
      S.loading = state === 'loading' || state === 'cached';
      if (S.mIdx >= list.length) S.mIdx = Math.max(0, list.length - 1);
      $('limit').hidden = simple() || !Movies.omdbLimited();
      renderRow(false);
      updateHero();
    };
    if (Store.get('scope') === 'watchlist') Movies.byIds(Store.get('watchlist'), function (list) { done(list, 'done'); });
    else Movies.top(query(), done);
  }

  function renderRow(skeleton) {
    var row = $('row'), note = $('rowNote'), html = '';
    if (skeleton) {
      for (var i = 0; i < Store.get('listSize') && i < 10; i++) html += '<div class="card skeleton"></div>';
      note.textContent = '';
    } else {
      var rk = Store.get('rankBy');
      S.movies.forEach(function (m, i) {
        var poster = img(m.poster), bg = poster ? 'background-image:url(' + poster + ')' : 'background-image:' + grad(m.hue || i * 47);
        var badge = rk === 'meta' ? (m.meta || '—') : m.imdb ? m.imdb.toFixed(1) : '—';
        html += '<div class="card" style="' + bg + '"><div class="rank">' + (i + 1) + '</div>' +
          (poster ? '' : '<div class="ph">' + esc(m.title) + '</div>') + '<div class="rate">' + badge + '</div>' +
          (has('watched', m.id) ? '<div class="seen">✓</div>' : '') +
          (m.kind === 'tv' && !moviesOnly() ? '<div class="kindtag">' + (m.tvType === 'mini' ? 'MINI' : 'TV') + '</div>' : '') + '</div>';
      });
      note.textContent = S.movies.length ? '' : emptyNote();
    }
    row.innerHTML = html;
    focusDraw();
  }

  function emptyNote() {
    if (Store.get('scope') === 'watchlist') return person().name + '\'s watchlist is empty. Open a movie and choose + Watchlist to add it.';
    if (S.state === 'error') return 'Movie ratings are unavailable right now (OMDb\'s daily limit may be reached). Try again later.';
    if (Store.get('scope') === 'mine' && !myServices().length) return 'Choose your streaming services in Settings → My streaming services.';
    return 'No ' + titlesWord() + ' match these filters. Try another filter (or ✕ Clear), or lower Minimum IMDb ratings in Settings.';
  }

  function current() { return S.movies[S.mIdx] || null; }

  function whereHtml(m, max) {
    var mine = myServices(), list = (m.where || []).slice();
    list.sort(function (a, b) { return (mine.indexOf(b) >= 0) - (mine.indexOf(a) >= 0); });
    var out = '';
    list.slice(0, max).forEach(function (id) {
      var p = Movies.provider(id);
      if (!p) return;
      out += '<span class="svc">' + (img(p.logo) ? '<img src="' + img(p.logo) + '">' : '<span class="dot"></span>') + esc(p.name) + '</span>';
    });
    return out ? 'Streaming on' + out : (Store.get('scope') === 'all' ? 'Not streaming on a subscription service in the US right now' : '');
  }

  function scoresHtml(m) {
    if (m.src === 'tmdb') {
      // The daily ratings limit is reached: TMDB's own score stands in until tomorrow.
      return '<div class="score"><span class="badge tmdb">TMDB</span><span class="num">' + (m.imdb ? m.imdb.toFixed(1) + '</span><span class="of">/10</span>' : '—</span>') +
        '<span class="sub">' + votes(m.votes) + ' TMDB ratings · IMDb and Metacritic back tomorrow</span></div>';
    }
    return '<div class="score"><span class="badge imdb">IMDb</span><span class="num">' + (m.imdb ? m.imdb.toFixed(1) + '</span><span class="of">/10</span>' : '—</span>') +
      '<span class="sub">' + (m.votes ? votes(m.votes) + ' ratings' : 'ratings unavailable right now') + '</span></div>' +
      '<div class="score"><span class="badge mc ' + mcClass(m.meta) + '">' + (m.meta || '—') + '</span><span class="sub" style="margin-left:0">Metacritic</span></div>';
  }

  function metaHtml(m) {
    var bits = [m.year, runtime(m.runtime), (m.genres || []).slice(0, 3).join(', ')].filter(Boolean);
    if (m.kind === 'tv') {
      var years = m.ongoing ? m.year + '–' : m.lastYear && m.lastYear !== m.year ? m.year + '–' + m.lastYear : m.year;
      var length = m.tvType === 'mini' ? 'Miniseries' : m.seasons ? m.seasons + (m.seasons === 1 ? ' season' : ' seasons') : 'TV series';
      bits = [years, length, (m.genres || []).slice(0, 3).join(', ')].filter(Boolean);
    }
    return esc(bits.join('  ·  ')) + (m.rated ? ' <span class="rated">' + esc(m.rated) + '</span>' : '') +
      (has('watched', m.id) ? '  <span class="seen-tag">✓ Seen</span>' : '');
  }

  function updateHero() {
    var m = current();
    var scope = Store.get('scope') === 'mine' ? 'on your services' : 'overall', wl = Store.get('scope') === 'watchlist';
    var by = Store.get('rankBy') === 'meta' ? 'by Metacritic' : 'by IMDb rating';
    if (!m) {
      $('heroEyebrow').textContent = wl ? person().name + '\'s watchlist' : S.loading ? 'Finding top ' + titlesWord() + ' ' + scope + '…' : 'Top ' + titlesWord() + ' ' + scope;
      $('heroTitle').textContent = S.loading ? '' : 'Nothing to show yet';
      $('heroMeta').innerHTML = ''; $('heroScores').innerHTML = ''; $('heroOverview').textContent = ''; $('heroWhere').innerHTML = '';
      setBackdrop(null);
      return;
    }
    $('heroEyebrow').textContent = '#' + (S.mIdx + 1) + ' of ' + S.movies.length + '  ·  ' + (wl ? person().name + '\'s watchlist' : 'Top ' + Store.get('listSize') + ' ' + scope + ' ' + by) +
      (S.loading ? '  ·  Updating…' : '') + (Movies.sample ? '  ·  Sample data' : '');
    $('heroTitle').textContent = m.title;
    $('heroMeta').innerHTML = metaHtml(m);
    $('heroScores').innerHTML = scoresHtml(m);
    $('heroOverview').textContent = m.overview;
    $('heroWhere').innerHTML = whereHtml(m, 4);
    fitHero();
    if (Store.get('backdrop') === 'follow' || (Store.get('backdrop') === 'still' && S.mIdx === 0)) setBackdrop(m);
    if (Store.get('backdrop') === 'off') setBackdrop(null);
  }

  /** Long titles: smaller type, then one line of plot, so the hero never runs into the filters. */
  var HERO_BOTTOM = 540;
  function fitHero() {
    var hero = $('hero'), h1 = $('heroTitle'), ov = $('heroOverview');
    ov.style.webkitLineClamp = '2';
    var sizes = [68, 58, 50];
    for (var i = 0; i < sizes.length; i++) {
      h1.style.fontSize = sizes[i] + 'px';
      if (hero.offsetTop + hero.offsetHeight <= HERO_BOTTOM) return;
    }
    ov.style.webkitLineClamp = '1';
    if (hero.offsetTop + hero.offsetHeight > HERO_BOTTOM) ov.style.display = 'none';
    else ov.style.display = '';
  }

  // Two layers crossfade; quick scrolling only loads where it stops.
  var bgTimer, bgFront = 'bgA', bgShown = '';
  function setBackdrop(m) {
    clearTimeout(bgTimer);
    var bd = m ? img(m.backdrop) : '', key = m ? (bd || 'h' + (m.hue || 0)) : '';
    if (key === bgShown) return;
    bgTimer = setTimeout(function () {
      bgShown = key;
      var back = bgFront === 'bgA' ? 'bgB' : 'bgA';
      function show() {
        var el = $(back);
        el.style.backgroundImage = !m ? 'none' : bd ? 'url("' + bd + '")' : grad(m.hue || 0);
        el.className = 'backdrop on';
        $(bgFront).className = 'backdrop';
        bgFront = back;
      }
      if (bd) { var pic = new Image(); pic.onload = pic.onerror = show; pic.src = bd; } else show();
    }, Store.get('animations') ? 220 : 120);
  }

  // MARK: - Dock

  // Apps left out of the dock until you add them back (Settings, Apps in the dock).
  var HIDE_FIRST = /^(org\.tizen\.browser|sample\.internet)$/;

  function buildDock() {
    if (!Store.get('dockSeeded') && S.apps.length) {
      Store.set('dockHidden', Store.get('dockHidden').concat(S.apps.filter(function (a) { return HIDE_FIRST.test(a.id) || a.title === 'Internet'; }).map(function (a) { return a.id; })));
      Store.set('dockSeeded', true);
    }
    var order = Store.get('dockOrder'), hidden = Store.get('dockHidden');
    var apps = S.apps.slice().sort(function (a, b) {
      var ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if (ia < 0 && ib < 0) return 0;
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
    if (Store.get('dockSort') === 'recent') {
      // Last opened first; never-opened apps keep their order after them.
      var used = Store.get('appUsed'), pos = {};
      apps.forEach(function (a, i) { pos[a.id] = i; });
      apps.sort(function (a, b) { return (used[b.id] || 0) - (used[a.id] || 0) || pos[a.id] - pos[b.id]; });
    }
    S.dock = apps.filter(function (a) { return hidden.indexOf(a.id) < 0; })
      .concat([{id: ':settings', title: 'Settings', system: '⚙'}, {id: ':samsung', title: 'Samsung Home', system: '⌂'}]);
    if (S.dIdx >= S.dock.length) S.dIdx = S.dock.length - 1;
    var html = '';
    S.dock.forEach(function (a) {
      if (a.system) html += '<div class="app system"><div><span class="ico">' + a.system + '</span>' + esc(a.title) + '</div></div>';
      else if (drawnTiles[a.id] && drawnTiles[a.id].size === tileSize()) html += '<div class="app has-icon reuse" data-id="' + esc(a.id) + '"></div>';
      else if (brandTile(a)) html += '<div class="app has-icon drawn" data-id="' + esc(a.id) + '"></div>';
      else if (a.icon) html += '<div class="app has-icon" data-id="' + esc(a.id) + '"><img src="' + esc(a.icon) + '" alt=""></div>';
      else html += '<div class="app" style="background:' + a.color + '"><span class="label">' + esc(a.title) + '</span></div>';
    });
    var dock = $('dock');
    if (simple()) {
      // A centered grid, COLS wide.
      dock.innerHTML = '<div class="dock-inner" id="dockInner" style="width:' + Math.min(S.dock.length, COLS) * 216 + 'px">' + html + '</div>';
      dock.style.width = '';
    } else {
      dock.innerHTML = '<div class="dock-inner" id="dockInner">' + html + '</div>';
      dock.style.width = Math.min(S.dock.length * 164 + 28, 1760) + 'px';
    }
    // An icon that doesn't load shows the app's name instead; one that does fills its tile.
    // (A fixed copy of the list: drawing a logo removes its <img>.) A logo that already loaded is drawn now.
    var imgs = Array.prototype.slice.call(dock.getElementsByTagName('img'));
    imgs.forEach(function (im) {
      im.onerror = labelInstead;
      im.onload = fillTile;
      if (im.complete && im.naturalWidth) fillTile.call(im);
    });
    // Tiles drawn before go straight back in: nothing to load or draw again.
    var reuse = dock.querySelectorAll('.reuse');
    for (var k = 0; k < reuse.length; k++) {
      var kept = drawnTiles[reuse[k].getAttribute('data-id')];
      if (kept.bg) reuse[k].style.background = kept.bg;
      reuse[k].appendChild(kept.canvas);
    }
    var drawn = dock.querySelectorAll('.drawn');
    for (var j = 0; j < drawn.length; j++) drawBrand(drawn[j], appById(drawn[j].getAttribute('data-id')));
    focusDraw();
  }

  /** A tile-sized canvas in the tile (drawn once, so moving the highlight never resizes a picture). */
  var drawnTiles = {};   // app id: {canvas, bg}, kept so rebuilding the dock doesn't redraw (or re-read) logos
  function tileCanvas(tile) {
    var c = document.createElement('canvas');
    var id = tile.getAttribute('data-id');
    if (id) drawnTiles[id] = {canvas: c, bg: ''};
    c.width = tile.offsetWidth || 150;
    c.height = tile.offsetHeight || 86;
    if (id) drawnTiles[id].size = c.width + 'x' + c.height;
    tile.innerHTML = '';
    tile.appendChild(c);
    return c;
  }

  // Apps whose own logo the TV doesn't hand over (YouTube's is a placeholder; Netflix's and Prime Video's
  // can't be read): drawn here in their colours instead.
  var BRANDS = [
    {test: /^youtube tv$/i, bg: '#FFFFFF', fg: '#0F0F0F', mark: true, text: 'YouTube TV'},
    {test: /^youtube/i, bg: '#FFFFFF', fg: '#0F0F0F', mark: true, text: 'YouTube'},
    {test: /^netflix$/i, bg: '#000000', fg: '#E50914', text: 'NETFLIX', heavy: true, spacing: 0.06},
    {test: /^prime video$/i, bg: '#0F171E', fg: '#FFFFFF', text: 'prime video', accent: '#1A98FF'}
  ];
  function brandTile(a) {
    for (var i = 0; i < BRANDS.length; i++) if (BRANDS[i].test.test(a.title)) return BRANDS[i];
    return null;
  }

  function drawBrand(tile, a) {
    var b = a && brandTile(a);
    if (!b) return;
    iconStatus[a.id] = 'drawn here';
    var c = tileCanvas(tile), g = c.getContext('2d'), w = c.width, h = c.height;
    tile.style.background = b.bg;
    drawnTiles[a.id].bg = b.bg;
    g.fillStyle = b.bg;
    g.fillRect(0, 0, w, h);
    var size = Math.round(h * (b.heavy ? 0.3 : 0.22));
    g.font = (b.heavy ? '900 ' : '700 ') + size + 'px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textBaseline = 'middle';
    var textW = g.measureText(b.text).width + (b.spacing ? b.spacing * size * b.text.length : 0);
    var markW = b.mark ? Math.round(size * 1.45) : 0, gap = b.mark ? Math.round(size * 0.35) : 0;
    var x = Math.round((w - markW - gap - textW) / 2), y = Math.round(h / 2);
    if (b.mark) {
      // A red rounded rectangle with a white play triangle.
      var mh = Math.round(size * 1.02), r = Math.round(mh * 0.28), mx = x, my = y - mh / 2;
      g.fillStyle = '#FF0033';
      g.beginPath();
      g.moveTo(mx + r, my); g.lineTo(mx + markW - r, my); g.quadraticCurveTo(mx + markW, my, mx + markW, my + r);
      g.lineTo(mx + markW, my + mh - r); g.quadraticCurveTo(mx + markW, my + mh, mx + markW - r, my + mh);
      g.lineTo(mx + r, my + mh); g.quadraticCurveTo(mx, my + mh, mx, my + mh - r);
      g.lineTo(mx, my + r); g.quadraticCurveTo(mx, my, mx + r, my);
      g.fill();
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.moveTo(mx + markW * 0.4, my + mh * 0.28); g.lineTo(mx + markW * 0.68, my + mh * 0.5); g.lineTo(mx + markW * 0.4, my + mh * 0.72);
      g.fill();
    }
    g.fillStyle = b.fg;
    var tx = x + markW + gap;
    if (b.spacing) {
      for (var i = 0; i < b.text.length; i++) { g.fillText(b.text[i], tx, y); tx += g.measureText(b.text[i]).width + b.spacing * size; }
    } else g.fillText(b.text, tx, y);
    if (b.accent) {   // a small smile-like underline in the brand's accent colour
      g.strokeStyle = b.accent; g.lineWidth = Math.max(2, Math.round(size * 0.12)); g.lineCap = 'round';
      g.beginPath(); g.moveTo(x + textW * 0.3, y + size * 0.62); g.quadraticCurveTo(x + textW * 0.55, y + size * 0.85, x + textW * 0.8, y + size * 0.55); g.stroke();
    }
  }

  var iconStatus = {};   // app id: 'shown' | 'didn\'t load' (for Settings → About → App details)
  function appById(id) { for (var i = 0; i < S.apps.length; i++) if (S.apps[i].id === id) return S.apps[i]; return null; }

  function tileSize() { return simple() ? '200x112' : '150x86'; }

  /** The dock's app order, to rebuild it only when the order really changed. */
  function dockOrderNow() { return S.dock.map(function (a) { return a.id; }).join(','); }

  function labelInstead() {
    var tile = this.parentNode, a = appById(tile.getAttribute('data-id'));
    if (!a) return;
    iconStatus[a.id] = 'didn\'t load';
    tile.className = tile.className.replace(/\s*has-icon\b/, '');
    tile.style.background = a.color;
    tile.innerHTML = '<span class="label">' + esc(a.title) + '</span>';
  }

  /**
   * A logo fills its tile. Logos are rarely the tile's shape, so the space around it takes the colour at the logo's
   * edge and it looks like one piece; if the TV won't let the app read the logo's colours, the logo is enlarged to fill.
   */
  var tileColors = {};
  function fillTile() {
    var tile = this.parentNode;
    if (!tile) return;   // the dock was redrawn while this logo loaded
    var id = tile.getAttribute('data-id');
    iconStatus[id] = 'shown';
    if (!tileColors[id]) {
      try {
        var c = document.createElement('canvas');
        c.width = c.height = 1;
        var g = c.getContext('2d');
        g.drawImage(this, 0, 0, 1, 1, 0, 0, 1, 1);   // the top-left pixel
        var d = g.getImageData(0, 0, 1, 1).data;
        tileColors[id] = d[3] > 200 ? 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')' : 'plain';   // see-through: neutral tile
      } catch (e) { tileColors[id] = 'cover'; }
    }
    var img = this, bg = tileColors[id] === 'cover' || tileColors[id] === 'plain' ? '' : tileColors[id];
    if (bg) tile.style.background = bg;
    var keep = function () { if (drawnTiles[id]) drawnTiles[id].bg = bg; };
    // Draw it once at the tile's size: moving the highlight then never resizes the (sometimes large) logo again.
    try {
      var c = tileCanvas(tile), g = c.getContext('2d'), w = c.width, h = c.height;
      var iw = img.naturalWidth || w, ih = img.naturalHeight || h;
      var s = tileColors[id] === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
      g.drawImage(img, Math.round((w - iw * s) / 2), Math.round((h - ih * s) / 2), Math.round(iw * s), Math.round(ih * s));
      keep();
    } catch (e) {
      if (tileColors[id] === 'cover') tile.className += ' cover';
    }
  }

  function openDockItem(a) {
    if (a.id === ':settings') { openSettings(); return; }
    if (a.id === ':samsung') {
      toast('Samsung\'s screen: press Home on your remote any time', 2200);
      setTimeout(TV.hide, 900);
      return;
    }
    openApp(a);
  }

  function openApp(a) {
    S.appOpenedAt = Date.now();
    var used = {}, old = Store.get('appUsed');
    for (var k in old) used[k] = old[k];
    used[a.id] = Date.now();
    Store.set('appUsed', used);
    if (!TV.isTV) { toast('On the TV, this opens ' + a.title); return; }
    if (Store.get('comeBack') && TV.storeId(a.id)) {
      // The background helper watches it through the TV's status service: it keeps working while the TV freezes
      // this page, and it sees YouTube leave the screen (its engine never closes).
      stopWatching('the helper watches ' + a.id);
      TV.helper({cmd: 'watch', app: a.id, store: TV.storeId(a.id), shown: shownStores().join(',')});
      Diag.note('helper watches ' + a.id + ' (' + TV.storeId(a.id) + ')');
      TV.launch(a.id, function (ok) { if (!ok) toast('Couldn\'t open ' + a.title); }, Store.get('launchMode'));
      return;
    }
    var go = function () {
      TV.launch(a.id, function (ok) { if (!ok) { toast('Couldn\'t open ' + a.title); stopWatching('didn\'t open'); } }, Store.get('launchMode'),
                function (how) { cameBack(a.id, how); });
    };
    if (!Store.get('comeBack')) { go(); return; }
    // Note what's running first: whatever appears after the app opens is that app (YouTube, for one, runs as
    // Samsung's com.samsung.tv.cobalt-yt rather than under its own id).
    var started = false, once = function (ids) { if (started) return; started = true; watchFor(a, ids || []); go(); };
    TV.running(once);
    setTimeout(function () { once(null); }, 600);   // don't keep you waiting if the TV is slow to answer
  }

  /** Store ids of all installed apps the helper can see on screen (to tell whether one of them took the screen). */
  function shownStores() { return S.apps.map(function (a) { return TV.storeId(a.id); }).filter(Boolean); }

  // MARK: - Back to BigTuna Home when the app it opened closes
  // Samsung's TVs go to their own home screen when an app closes. While another app is open, BigTuna Home keeps
  // checking whether that app is still running; once it has closed, BigTuna Home brings itself back to the front.
  // If you leave that app with Home instead (it keeps running), nothing happens: you meant to go to Samsung's screen.

  var watchTimer = null, stopStatus = function () {};
  function watchFor(a, before) {
    stopWatching('opening another app');
    var r = S.returnTo = {id: a.id, title: a.title, at: Date.now(), seen: false, hidden: false, before: before, mine: []};
    Diag.note('opened ' + a.id + ', watching for it to close');
    watchTimer = setInterval(checkReturn, 400);   // often, so the gap after an app closes stays short
    // The TV says when the app stops being active (closed, or left with Home).
    stopStatus = TV.watchStatus(a.id, function (active) {
      Diag.note('status: ' + a.id + (active ? ' active' : ' not active'));
      if (S.returnTo !== r) return;
      if (active) r.seen = true;
      else if (r.seen) setTimeout(function () { if (S.returnTo === r) checkClosed(r); }, 800);
    });
  }

  /** Not active any more: closed, or just sent to the background with Home? Only a closed app brings us back. */
  function checkClosed(r) {
    TV.running(function (ids) {
      if (S.returnTo !== r) return;
      if (ids && ids.indexOf(r.id) >= 0) { Diag.note(r.id + ' still running (left with Home?): staying put'); return; }
      cameBack(r.id, 'closed');
    });
  }

  function stopWatching(why) {
    if (S.returnTo) Diag.note('stopped watching ' + S.returnTo.id + ': ' + why);
    S.returnTo = null;
    clearInterval(watchTimer);
    watchTimer = null;
    stopStatus();
    stopStatus = function () {};
  }

  function checkReturn() {
    var r = S.returnTo;
    if (!r) { stopWatching('nothing to watch'); return; }
    if (Date.now() - r.at > 6 * 3600 * 1000) { stopWatching('6 hours passed'); return; }
    if (!document.hidden) {
      if (r.hidden) stopWatching('back on screen');            // you came back yourself
      else if (Date.now() - r.at > 20000) stopWatching('the app never opened');
      return;
    }
    r.hidden = true;
    if (r.asking) return;                                       // the last check hasn't been answered yet
    r.asking = true;
    if (Diag.on) watchSignals(r);
    TV.running(function (ids) {
      r.asking = false;
      if (!ids || S.returnTo !== r) return;                     // the TV won't say: do nothing rather than guess
      if (Diag.on) {
        // Test builds: every app starting or stopping, to find the earliest sign you've left an app.
        var last = r.lastIds || ids;
        var plus = ids.filter(function (id) { return last.indexOf(id) < 0; });
        var minus = last.filter(function (id) { return ids.indexOf(id) < 0; });
        if (plus.length || minus.length) Diag.note('list' + (plus.length ? ' +' + plus.join(' +') : '') + (minus.length ? ' -' + minus.join(' -') : ''));
        r.lastIds = ids;
      }
      // Test builds: when Samsung's AirPlay helper starts (it seems to start as Samsung's home screen appears).
      var airplay = ids.some(function (id) { return /airplay/i.test(id); });
      if (airplay && r.airplay === false) Diag.note('AirPlay helper started');
      r.airplay = airplay;
      // The first 15 seconds: whatever started running belongs to the app that was opened. The app's own id counts
      // too, even if it was already running in the background. Samsung's AirPlay helpers come and go on their own.
      if (Date.now() - r.at < 15000) {
        ids.forEach(function (id) {
          var fresh = r.before.indexOf(id) < 0 || id === r.id;
          if (fresh && id !== TV.self && !/airplay/i.test(id) && r.mine.indexOf(id) < 0) { r.mine.push(id); Diag.note('belongs to ' + r.id + ': ' + id); }
        });
        return;
      }
      // Background helpers (a music app's service, say) can outlive the app: the visible parts decide.
      var parts = r.mine.filter(function (id) { return !/service|daemon|provider|agent/i.test(id); });
      if (!parts.length) parts = r.mine;
      if (!parts.length) {
        if (!r.noted) { r.noted = true; Diag.note('nothing new started for ' + r.id + ': can\'t tell when it closes'); }
        return;
      }
      // You opened a different app yourself (from Samsung's screen): stop waiting, so BigTuna Home doesn't pop up
      // over it later. Only apps count here, not the TV's own services that come and go.
      var isApp = function (id) { return /^[A-Za-z0-9]{10}\./.test(id) || /^(org\.tizen\.(netflix-app|primevideo)|com\.samsung\.tv\.(cobalt-yt|aria-video))$/.test(id); };
      var other = ids.filter(function (id) {
        return isApp(id) && id !== TV.self && r.before.indexOf(id) < 0 && r.mine.indexOf(id) < 0 && !/service|airplay/i.test(id);
      });
      // Counted only once it has been running for 2 seconds (helpers flick on and off).
      var since = r.othersSince || (r.othersSince = {}), now = Date.now(), settled = null;
      other.forEach(function (id) { since[id] = since[id] || now; if (now - since[id] >= 2000) settled = id; });
      Object.keys(since).forEach(function (id) { if (other.indexOf(id) < 0) delete since[id]; });
      if (settled) { stopWatching('you opened ' + settled); return; }
      // Test builds: when each part of the app ends.
      parts.forEach(function (id) {
        var on = ids.indexOf(id) >= 0;
        if (r.partOn && r.partOn[id] && !on) Diag.note('ended: ' + id);
        (r.partOn = r.partOn || {})[id] = on;
      });
      var stillOn = parts.some(function (id) { return ids.indexOf(id) >= 0; });
      if (stillOn) { r.seen = true; return; }
      cameBack(r.id, 'closed (' + parts.join(', ') + ' ended)');
    });
  }

  /** Test builds: free memory and processor load while waiting, logged when they jump (the signal hunt). */
  function watchSignals(r) {
    var info = window.tizen && window.tizen.systeminfo;
    if (!info) return;
    try {
      info.getPropertyValue('MEMORY', function (m) {
        var free = Math.round(m.availableCapacity / 1048576);
        if (r.mem !== undefined && Math.abs(free - r.mem) >= 20) Diag.note('memory free ' + r.mem + ' -> ' + free + ' MB');
        r.mem = free;
      }, function () {});
      info.getPropertyValue('CPU', function (c) {
        var load = Math.round(c.load * 100);
        if (r.cpu !== undefined && Math.abs(load - r.cpu) >= 25) Diag.note('processor ' + r.cpu + '% -> ' + load + '%');
        r.cpu = load;
      }, function () {});
    } catch (e) {}
  }

  // MARK: - The TV turning back on
  // Turning the TV off only suspends it, so BigTuna Home is still open when it comes back on. When it comes back after
  // a break it didn't cause (not an app it opened), it asks "Who's watching?" again, as at the start. The TV may give
  // either of two signs, so both count: the page shows again without having opened an app, or the clock jumped while
  // it stayed on screen (nothing runs while the TV is off).
  var AWAY_LONG = 4 * 3600 * 1000;    // back from an app after this long: ask too (the TV may have been off meanwhile)
  var beatAt = Date.now(), beatSeen = true;
  function heartbeat() {
    var now = Date.now(), gap = now - beatAt, wasSeen = beatSeen;
    var byApp = S.appOpenedAt > beatAt - 20000;   // an app it opened (the page stops while that app has the screen)
    beatAt = now; beatSeen = !document.hidden;
    if (gap > 25000) Diag.note('heartbeat gap ' + Math.round(gap / 1000) + ' s' + (wasSeen ? '' : ' (was hidden)') + ' · ' + screenNow());
    if (beatSeen && wasSeen && gap > 3 * 60 * 1000 && !byApp) wokeUp('nothing ran for ' + Math.round(gap / 60000) + ' min');
  }
  // The power button: the page loses focus at once, but only hears it's hidden ~2 s later, when the TV has stopped
  // drawing and keeps the old screen to show first on power-on. So the calm look goes up at the first sign (losing
  // focus), and comes down again if the page gets focus back without having been hidden (a pop-up, Samsung's bar).
  function lostFocus() {
    if (Store.get('people').length < 2 || S.welcome || S.overlay === 'input' || Date.now() - S.appOpenedAt < 30000) return;
    S.preWelcome = true;
    if (document.body.className.indexOf(' fast') < 0) document.body.className += ' fast';
    tick();
  }
  function gotFocus() {
    if (!S.preWelcome) return;
    S.preWelcome = false;
    if (!S.welcome) { tick(); setTimeout(function () { document.body.className = document.body.className.replace(/ fast\b/g, ''); }, 50); }
  }

  /** Test builds: what's on screen now (layout classes, and whether the picker is up). */
  function screenNow() { return document.body.className + (S.overlay === 'list' && !$('picker').hidden ? ' +picker' : ''); }

  function leftScreen() {
    S.hiddenAt = Date.now();
    S.hiddenByApp = S.hiddenAt - S.appOpenedAt < 30000;
    beatSeen = false;
    // Set up "Who's watching?" now, while off screen, so the TV shows it straight away when it comes back on
    // (instead of the last screen for a moment).
    if (!S.hiddenByApp) wokeUp('left the screen', true);
  }
  function backOnScreen() {
    beatAt = Date.now();   // the time away isn't a gap for heartbeat()
    if (S.instant) {       // animations back on once the picker is showing
      S.instant = false;
      setTimeout(function () { document.body.className = document.body.className.replace(/ fast\b/g, ''); }, 600);
    }
    var away = Date.now() - S.hiddenAt;
    if (!S.hiddenByApp || away > AWAY_LONG) wokeUp(S.hiddenByApp ? 'back after ' + Math.round(away / 3600000) + ' h' : 'back without an app it opened');
  }
  function wokeUp(why, instant) {
    if (Store.get('people').length < 2 || S.welcome) return;
    // Off screen: no fades (they would play out when the TV comes back on).
    if (instant) { S.instant = true; if (document.body.className.indexOf(' fast') < 0) document.body.className += ' fast'; }
    Diag.note('asking who\'s watching: ' + why);
    // Whatever was open goes; the person's own screen is drawn once they're picked.
    $('night').hidden = true;
    if (S.inputDone) S.inputDone(false);   // a name being typed: cancelled
    $('detail').hidden = true; S.detail = null;
    S.lists = []; $('picker').hidden = true; $('settings').hidden = true; S.overlay = null;
    S.welcome = true;
    S.preWelcome = false;
    S.lastKey = Date.now();
    tick();
    pickPerson(true);
  }

  function cameBack(id, how) {
    var r = S.returnTo;
    if (!r || r.id !== id) return;
    Diag.note(id + ' ' + how + ': bringing BigTuna Home back');
    stopWatching(how);
    TV.bringBack();
  }

  /** The installed app for a streaming service, or null. */
  function appFor(providerId) {
    for (var i = 0; i < S.apps.length; i++) {
      var p = Movies.providerForApp(S.apps[i]);
      if (p && p.id === providerId) return S.apps[i];
    }
    return null;
  }

  // MARK: - Focus

  // Fast key presses only change where the highlight should be; the screen is drawn at most once per frame,
  // and only the tiles whose highlight changes are touched, so the TV keeps up.
  var drawQueued = false;
  var frame = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
  function focusDraw() {
    if (drawQueued) return;
    drawQueued = true;
    frame(function () { drawQueued = false; drawFocus(); });
  }

  function setClass(el, cls) { if (el.className !== cls) el.className = cls; }

  function drawFocus() {
    var zones = {filters: $('filters'), movies: $('row'), dock: $('dockInner')};
    Object.keys(zones).forEach(function (z) {
      var el = zones[z];
      if (!el) return;
      var on = z === S.zone && !S.overlay;
      setClass(el, el.className.replace(/\s*focus-zone/, '') + (on ? ' focus-zone' : ''));
      var kids = el.children, idx = z === 'filters' ? S.fIdx : z === 'movies' ? S.mIdx : S.dIdx;
      for (var i = 0; i < kids.length; i++) setClass(kids[i], kids[i].className.replace(/\s*focus\b/, '') + (i === idx ? ' focus' : ''));
    });
    // Keep the highlighted card and app on screen.
    var n = S.movies.length, x = Math.max(0, Math.min(S.mIdx * STEP - STEP * 7, n * STEP - 1728));
    $('row').style.transform = 'translateX(' + (-Math.max(0, x)) + 'px)';
    var di = $('dockInner');
    if (di && !simple()) {
      var dn = S.dock.length, dx = Math.max(0, Math.min(S.dIdx * 164 - 164 * 7, dn * 164 + 28 - 1760));
      di.style.transform = 'translateX(' + (-Math.max(0, dx)) + 'px)';
    }
  }

  var heroTimer;
  function move(dx, dy) {
    if (simple()) {
      // The app grid: left/right one app, up/down one row (down to a shorter last row lands on its last app).
      var n = S.dock.length, i2 = S.dIdx + dx + dy * COLS;
      if (dy > 0 && i2 >= n && Math.floor(S.dIdx / COLS) < Math.floor((n - 1) / COLS)) i2 = n - 1;
      if (i2 >= 0 && i2 < n) S.dIdx = i2;
      S.zone = 'dock';
      focusDraw();
      return;
    }
    if (dy) {
      var order = ['filters', 'movies', 'dock'], i = order.indexOf(S.zone) + dy;
      if (i < 0 || i > 2) return;
      if (order[i] === 'movies' && !S.movies.length) i += dy;
      if (i < 0 || i > 2) return;
      S.zone = order[i];
    } else if (S.zone === 'filters') S.fIdx = Math.max(0, Math.min(filterIds().length - 1, S.fIdx + dx));
    else if (S.zone === 'movies') {
      var m = Math.max(0, Math.min(S.movies.length - 1, S.mIdx + dx));
      // The highlight moves at once; the big title and background follow when you pause on a movie.
      if (m !== S.mIdx) { S.mIdx = m; clearTimeout(heroTimer); heroTimer = setTimeout(updateHero, 140); }
    } else S.dIdx = Math.max(0, Math.min(S.dock.length - 1, S.dIdx + dx));
    focusDraw();
  }

  function ok() {
    if (S.zone === 'filters') openFilter(filterIds()[S.fIdx]);
    else if (S.zone === 'movies' && current()) openDetail(current());
    else if (S.zone === 'dock' && S.dock[S.dIdx]) openDockItem(S.dock[S.dIdx]);
  }

  // MARK: - Detail card

  function openDetail(m) {
    var buttons = [], seen = {};
    var mine = myServices(), list = (m.where || []).slice();
    list.sort(function (a, b) { return (mine.indexOf(b) >= 0) - (mine.indexOf(a) >= 0); });
    list.forEach(function (pid) {
      var app = appFor(pid), p = Movies.provider(pid);
      if (app && p && !seen[app.id] && !buttons.length) { seen[app.id] = 1; buttons.push({label: 'Open in ' + p.name, app: app}); }
    });
    if (!buttons.length) buttons.push({label: list.length ? 'App not installed' : 'Not streaming', disabled: true});
    buttons.push({seen: true}, {watchlist: true}, {label: 'Close', close: true});
    S.detail = {m: m, buttons: buttons, idx: buttons[0].disabled ? 1 : 0};
    var large = img(m.posterLarge), poster = large ? 'background-image:url(' + large + ')' : 'background-image:' + grad(m.hue || 0);
    $('detail').innerHTML = '<div class="sheet detail-sheet"><div class="poster" style="' + poster + '">' +
      (large ? '' : '<div class="ph" style="position:absolute;left:0;right:0;bottom:0;padding:30px;font-size:36px;font-weight:700;color:#fff;line-height:1.15">' + esc(m.title) + '</div>') + '</div>' +
      '<div class="info"><h2>' + esc(m.title) + '</h2><div class="meta" style="margin-top:14px">' + metaHtml(m) + '</div>' +
      '<div class="scores">' + scoresHtml(m) + '</div>' +
      '<p class="plot">' + esc(m.overview) + '</p>' +
      '<div class="credits">' + (m.kind === 'tv' ? (m.creators ? '<b>Created by</b>  ' + esc(m.creators) + '<br>' : '') :
        m.director ? '<b>Director</b>  ' + esc(m.director) + '<br>' : '') + (m.cast ? '<b>Starring</b>  ' + esc(m.cast) : '') + '</div>' +
      '<div class="where">' + whereHtml(m, 6) + '</div>' +
      '<div class="buttons" id="detailButtons"></div></div>' +
      '<div class="attrib">Ratings: IMDb and Metacritic via OMDb · Streaming data: TMDB and JustWatch</div></div>';
    $('detail').hidden = false;
    S.overlay = 'detail';
    drawDetail();
    focusDraw();
  }

  function drawDetail() {
    var d = S.detail;
    $('detailButtons').innerHTML = d.buttons.map(function (b, i) {
      if (b.seen) b.label = has('watched', d.m.id) ? '✓ Seen' : 'Seen it';
      if (b.watchlist) b.label = has('watchlist', d.m.id) ? '✓ On watchlist' : '+ Watchlist';
      return '<div class="btn' + (i === 0 && !b.close && !b.disabled ? ' primary' : '') + (b.disabled ? ' disabled' : '') + (i === d.idx ? ' focus' : '') + '">' + esc(b.label) + '</div>';
    }).join('');
  }

  function detailKey(code) {
    var d = S.detail;
    if (code === K.left || code === K.right) {
      var i = d.idx + (code === K.left ? -1 : 1);
      while (i >= 0 && i < d.buttons.length && d.buttons[i].disabled) i += code === K.left ? -1 : 1;
      if (i >= 0 && i < d.buttons.length) { d.idx = i; drawDetail(); }
    } else if (code === K.ok) {
      var b = d.buttons[d.idx];
      if (b.close) closeDetail();
      else if (b.app) openApp(b.app);
      else if (b.seen) {
        toast(toggleIn('watched', d.m.id) ? 'Marked as seen' + (Store.get('showWatched') ? '' : ' (it leaves the list when you close this)') : 'Not seen');
        S.reloadAfter = S.reloadAfter || !Store.get('showWatched');
        drawDetail();
      } else if (b.watchlist) {
        toast(toggleIn('watchlist', d.m.id) ? 'Added to ' + person().name + '\'s watchlist' : 'Removed from the watchlist');
        S.reloadAfter = S.reloadAfter || Store.get('scope') === 'watchlist';
        drawDetail();
      }
    } else if (isBack(code)) closeDetail();
  }

  function closeDetail() {
    $('detail').hidden = true; S.overlay = null; S.detail = null;
    if (S.reloadAfter) { S.reloadAfter = false; load(); } else { renderRow(false); updateHero(); }
  }

  // MARK: - Lists (pickers and settings)

  /** Headings and the info text: shown, but the highlight skips them. */
  function readOnly(it) { return it.section || it.about; }

  /** cfg.make (optional) builds the items; the list is rebuilt with it when a list on top of it closes. */
  function openList(cfg) {
    if (cfg.make) cfg.items = cfg.make();
    cfg.idx = cfg.start || 0;
    while (cfg.items[cfg.idx] && readOnly(cfg.items[cfg.idx])) cfg.idx++;
    S.lists.push(cfg);
    S.overlay = 'list';
    drawList();
    focusDraw();
  }

  function drawList() {
    var cfg = S.lists[S.lists.length - 1], el = cfg.kind === 'picker' ? $('picker') : $('settings');
    $('picker').hidden = cfg.kind !== 'picker';
    $('settings').hidden = cfg.kind === 'picker';
    var html = '<div class="sheet list-sheet ' + (cfg.kind === 'picker' ? 'picker-sheet' : 'settings-sheet') + '"><h3>' + esc(cfg.title) + '</h3>' +
      (cfg.hint ? '<div class="hint">' + esc(cfg.hint) + '</div>' : '') + '<div class="list"><div class="list-inner">';
    cfg.items.forEach(function (it, i) {
      if (it.section) { html += '<div class="item section">' + esc(it.section) + '</div>'; return; }
      if (it.about) { html += '<div class="item" style="height:auto"><div class="about">' + it.about + '</div></div>'; return; }
      var left = (it.avatar ? '<span class="avatar" style="background:' + it.avatar + '">' + esc(it.label.charAt(0).toUpperCase()) + '</span>' : '') + (it.img !== undefined ? (img(it.img) ? '<img src="' + img(it.img) + '">' : '<span class="dot"></span>') : '') + '<span>' + esc(it.label) + '</span>' + (it.tag ? '<span class="tag">' + esc(it.tag) + '</span>' : '');
      var right = it.check !== undefined ? '<span class="check' + (it.check ? ' on' : '') + '">' + (it.check ? '✓' : '') + '</span>' : '<span class="val">' + esc(it.val || '') + '</span>';
      html += '<div class="item' + (i === cfg.idx ? ' focus' : '') + (it.sel ? ' sel' : '') + '" data-i="' + i + '"><div class="left">' + left + '</div>' + right + '</div>';
    });
    el.innerHTML = html + '</div></div></div>';
    scrollList(cfg);
  }

  /** The rows of this list, looked up inside its own panel (the picker and settings panels each have one). */
  function listInner(cfg) { return (cfg.kind === 'picker' ? $('picker') : $('settings')).querySelector('.list-inner'); }

  /** Moving up or down only moves the highlight (no redraw of the whole list), so long lists stay quick. */
  function moveHighlight(cfg, i) {
    var kids = listInner(cfg).children;
    kids[cfg.idx].className = kids[cfg.idx].className.replace(/\s*focus\b/, '');
    kids[i].className += ' focus';
    cfg.idx = i;
    scrollList(cfg);
  }

  function scrollList(cfg) {
    // Scroll the highlighted row into the middle. Setting scrollTop (not a transform) also undoes any
    // scrolling the browser did on its own, which used to push the highlight out of sight.
    var inner = listInner(cfg), item = inner.children[cfg.idx], box = inner.parentNode;
    if (item) box.scrollTop = Math.max(0, Math.min(item.offsetTop - box.clientHeight / 2 + item.offsetHeight / 2, inner.offsetHeight - box.clientHeight));
    // Fades with arrows where the list goes on past the edge.
    var sheet = box.parentNode, old = sheet.querySelectorAll('.more'), hints = '';
    for (var j = 0; j < old.length; j++) sheet.removeChild(old[j]);
    if (box.scrollTop > 2) hints += '<div class="more up" style="top:' + box.offsetTop + 'px">▴</div>';
    if (box.scrollTop + box.clientHeight < inner.offsetHeight - 2) hints += '<div class="more down" style="top:' + (box.offsetTop + box.clientHeight - 64) + 'px">▾</div>';
    sheet.insertAdjacentHTML('beforeend', hints);
  }

  // The mouse, for the browser preview: the wheel moves the highlight, a click picks a row.
  var wheel = 0;
  function listMouse(e) {
    if (S.overlay !== 'list') return;
    if (e.type === 'wheel') {
      e.preventDefault();
      wheel += e.deltaY;
      // One row per notch of a mouse wheel; a trackpad sends many small steps, so they add up first.
      while (Math.abs(wheel) >= 50) { listKey(wheel > 0 ? K.down : K.up); wheel -= wheel > 0 ? 50 : -50; }
      return;
    }
    var el = e.target;
    while (el && el !== e.currentTarget && !(el.getAttribute && el.getAttribute('data-i'))) el = el.parentNode;
    var cfg = S.lists[S.lists.length - 1], i = el && el.getAttribute ? parseInt(el.getAttribute('data-i'), 10) : NaN;
    if (isNaN(i) || readOnly(cfg.items[i])) return;
    cfg.idx = i;
    drawList();
    if (cfg.items[i].ok) cfg.items[i].ok();
  }

  function listKey(code) {
    var cfg = S.lists[S.lists.length - 1], it = cfg.items[cfg.idx];
    if (code === K.up || code === K.down) {
      var d = code === K.up ? -1 : 1, i = cfg.idx + d;
      while (cfg.items[i] && readOnly(cfg.items[i])) i += d;
      if (cfg.items[i]) moveHighlight(cfg, i);
    } else if (code === K.ok) { if (it && it.ok) it.ok(); }
    else if (code === K.left) { if (it && it.left) it.left(); }
    else if (code === K.right) { if (it && it.right) it.right(); }
    else if (isBack(code)) closeList();
  }

  function closeList() {
    var cfg = S.lists.pop();
    if (cfg && cfg.onClose) cfg.onClose();
    var top = S.lists[S.lists.length - 1];
    if (top) { if (top.make) refreshList(top.make()); else drawList(); return; }
    $('picker').hidden = true;
    $('settings').hidden = true;
    S.overlay = null;
    focusDraw();
  }

  /** Redraws the top list with new items, keeping the highlighted row. */
  function refreshList(items) {
    var cfg = S.lists[S.lists.length - 1];
    cfg.items = items;
    if (cfg.idx >= items.length) cfg.idx = items.length - 1;
    drawList();
  }

  // MARK: - Settings

  function cycle(key, values, dir) {
    var i = values.indexOf(Store.get(key));
    Store.set(key, values[(i + (dir || 1) + values.length) % values.length]);
  }

  var VOTES = [1000, 5000, 10000, 20000, 50000, 100000, 250000, 500000];
  var SIZES = [10, 15, 20, 25];

  function settingsItems() {
    var themeName = {dark: 'Dark', light: 'Light', auto: 'Automatic (dark at night)'};
    var bgName = {follow: 'Highlighted movie', still: 'First movie only', off: 'Plain'};
    function opt(label, val, key, values, after) {
      var change = function (d) { cycle(key, values, d); if (after) after(); refreshList(settingsItems()); };
      return {label: label, val: '‹  ' + val + '  ›', ok: function () { change(1); }, left: function () { change(-1); }, right: function () { change(1); }};
    }
    var listChanged = function () { renderFilters(); S.mIdx = 0; load(); };
    return [
      {section: 'Look'},
      opt('Layout', simple() ? 'Simple (apps only)' : 'Full (top movies)', 'layout', ['full', 'simple'], layoutChanged),
      opt('Appearance', themeName[Store.get('theme')], 'theme', ['dark', 'light', 'auto'], tick),
      simple() ? opt('Background', Store.get('backdrop') === 'off' ? 'Plain' : 'Mountains', 'backdrop', ['follow', 'off'], tick)
               : opt('Background', bgName[Store.get('backdrop')], 'backdrop', ['follow', 'still', 'off'], function () { tick(); updateHero(); }),
      opt('Animations', Store.get('animations') ? 'On' : 'Off', 'animations', [true, false], tick),
      opt('Clock', Store.get('clock24') ? '24-hour' : '12-hour', 'clock24', [false, true], tick),
      opt('Weather', Store.get('weather') ? 'On (New York)' : 'Off', 'weather', [true, false], showWeather),
      opt('Night screen', nightName(Store.get('night')), 'night', NIGHTS, tick),
      {section: 'People'},
      {label: 'Who\'s watching', val: person().name + '  ›', ok: pickPerson},
      {label: 'Add, rename or remove people', val: '›', ok: openPeople},
      {section: 'Top movies for ' + person().name},
      opt('Rank by', Store.get('rankBy') === 'meta' ? 'Metacritic' : 'IMDb rating', 'rankBy', ['imdb', 'meta'], listChanged),
      opt('Show', {mine: 'My services', all: 'All media', watchlist: 'Watchlist'}[Store.get('scope')], 'scope', SCOPES, function () { scopeChanged(); listChanged(); }),
      opt('Watched movies', Store.get('showWatched') ? 'Show (marked ✓)' : 'Hide', 'showWatched', [true, false], listChanged),
      opt('Minimum IMDb ratings', Store.get('minVotes').toLocaleString('en-US'), 'minVotes', VOTES, listChanged),
      opt('Movies in the list', String(Store.get('listSize')), 'listSize', SIZES, listChanged),
      {label: 'My streaming services', val: myServices().length + ' on  ›', ok: openServices},
      {label: 'Services in the list', val: (Store.get('scope') === 'mine' ? serviceLabel() : 'My services only') + '  ›', ok: openServiceFilter},
      {label: 'Refresh movie data', val: '', ok: function () { Movies.refresh(); Movies.loadLists(function () { listChanged(); toast('Movie data refreshed'); }); }},
      {section: 'Apps'},
      opt('Dock order', Store.get('dockSort') === 'recent' ? 'Recently used first' : 'My order', 'dockSort', ['recent', 'mine'], function () { S.dIdx = 0; buildDock(); }),
      opt('After closing an app', Store.get('comeBack') ? 'Come back to BigTuna Home' : 'Samsung\'s home screen', 'comeBack', [true, false]),
      {label: 'Apps in the dock', val: (S.apps.length - Store.get('dockHidden').filter(function (id) { return S.apps.some(function (a) { return a.id === id; }); }).length) + ' shown  ›', ok: openDockSettings},
      {label: 'Samsung TV settings', val: '›', ok: function () { S.appOpenedAt = Date.now(); TV.settings(); }},
      {section: 'Backup'},
      {label: 'Back up now', val: backupWhen(), ok: function () {
        toast(Backup.save() ? 'Backed up to ' + Backup.where : 'Couldn\'t save the backup', 3000);
        refreshList(settingsItems());
      }},
      {label: restoreArmed ? 'Press OK again to restore (replaces what\'s here now)' : 'Restore from backup', val: restoreArmed ? '' : '›', ok: function () {
        var b = Backup.load();
        if (!b) { toast('No backup found yet'); return; }
        if (!restoreArmed) { restoreArmed = true; refreshList(settingsItems()); return; }
        restoreArmed = false;
        restoreNow(b);
      }},
      {section: 'Remote shortcuts'},
      {about: 'Red: Full / Simple layout  ·  Green: my services / all media / watchlist  ·  Yellow: IMDb / Metacritic  ·  Blue: settings.<br>Home always opens Samsung\'s own screen.'},
      {section: 'About'},
      {about: 'BigTuna Home 1.0 · ' + esc(TV.model()) + '<br>Ratings from IMDb and Metacritic via OMDb. Streaming availability from TMDB and JustWatch. This product uses the TMDB API but is not endorsed or certified by TMDB. No ads, no tracking.'},
      {label: 'App details', val: '›', ok: openAppDetails},
      {label: 'Reset all settings', val: '', ok: function () { Store.reset(); Store.set('services', defaultServices()); toast('Settings reset'); tick(); buildDock(); listChanged(); refreshList(settingsItems()); }}
    ];
  }

  var NIGHTS = [21, 22, 23, 0, 'off'];
  function nightName(h) { return h === 'off' ? 'Off' : 'From ' + (h === 0 ? '12' : h - 12) + (h === 0 ? ' am' : ' pm') + ' to 6 am'; }

  // MARK: - People: each has their own movie settings, watched movies, watchlist and recent apps

  var COLORS = ['#E8A33D', '#4C8DF6', '#3DBE8B', '#E5585D', '#9B6BF2', '#2BB3C0'];
  function person() {
    var list = Store.get('people'), id = Store.get('person');
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }
  function colorOf(p) { var list = Store.get('people'); for (var i = 0; i < list.length; i++) if (list[i].id === p.id) return COLORS[i % COLORS.length]; return COLORS[0]; }

  function showWho() {
    var several = Store.get('people').length > 1, p = person();
    $('who').innerHTML = several ? '<span class="avatar" style="background:' + colorOf(p) + '">' + esc(p.name.charAt(0).toUpperCase()) + '</span>' + esc(p.name) : '';
  }

  /** Everything on screen follows the new person. */
  function personChanged() {
    // From Settings, to someone with the other layout: the same quick fade as changing it in Settings.
    var fade = !S.welcome && simple() !== (document.body.className.indexOf(' simple') >= 0);
    S.welcome = false;
    var draw = function () {
      tick();   // their layout (Full or Simple) and theme classes
      S.zone = simple() ? 'dock' : 'movies';   // where each layout starts
      showWho();
      renderFilters();
      S.mIdx = 0; S.dIdx = 0;
      buildDock();
      load();
      focusDraw();
    };
    if (fade) swapLayout(draw); else draw();
  }

  /** After the layout setting changed (Settings or the red button): show the new layout, with the fade. */
  function layoutChanged() {
    swapLayout(function () {
      tick();
      S.zone = simple() ? 'dock' : S.movies.length ? 'movies' : 'dock';
      buildDock();
      if (!simple() && !S.movies.length) load();
    });
  }

  /**
   * Full <-> Simple: a plain sheet fades over the screen (0.18 s), the layout changes under it, and once the TV has drawn
   * the new layout (two frames, plus a moment for the mountain picture) the sheet fades away (0.2 s). Instant with
   * Animations off.
   */
  var swapTimer = null;
  function swapLayout(change) {
    if (!Store.get('animations')) { change(); return; }
    clearTimeout(swapTimer);
    $('cover').className = 'cover on';
    swapTimer = setTimeout(function () {
      change();
      frame(function () { frame(function () {
        swapTimer = setTimeout(function () { $('cover').className = 'cover'; }, 80);
      }); });
    }, 190);
  }

  /** "Who's watching?": at the start (when there are two or more people) and from Settings. */
  function pickPerson(atStart) {
    var before = Store.get('person');
    var items = function () {
      return Store.get('people').map(function (p) {
        return {label: p.name, avatar: colorOf(p), val: p.id === Store.get('person') ? '✓' : '', sel: p.id === Store.get('person'),
                ok: function () { Store.set('person', p.id); closeList(); }};
      }).concat([{label: '+ Add a person', ok: function () { addPerson(function () { refreshList(items()); }); }}]);
    };
    var list = Store.get('people'), start = 0;
    for (var i = 0; i < list.length; i++) if (list[i].id === before) start = i;
    openList({kind: 'picker', title: 'Who\'s watching?', hint: 'Each person has their own rankings, watched movies and watchlist.', make: items, start: start,
              onClose: function () {
                var changed = Store.get('person') !== before;
                if (changed || atStart === true) personChanged();
                if (changed) toast('Hi, ' + person().name);
              }});
  }

  function addPerson(done) {
    askName('Add a person', '', function (name) {
      var list = Store.get('people').slice(), n = 1;
      while (list.some(function (p) { return p.id === 'p' + n; })) n++;
      list.push({id: 'p' + n, name: name});
      Store.set('people', list);
      showWho();
      done();
    });
  }

  function openPeople() {
    var items = function () {
      return Store.get('people').map(function (p) {
        return {label: p.name, avatar: colorOf(p), val: '›', ok: function () { openPerson(p); }};
      }).concat([{label: '+ Add a person', ok: function () { addPerson(function () { refreshList(items()); }); }}]);
    };
    openList({kind: 'settings', title: 'People', hint: 'OK to rename or remove someone.', make: items});
  }

  function openPerson(p) {
    var confirm = false;
    var items = function () {
      var out = [{label: 'Rename', val: '›', ok: function () {
        askName('Rename ' + p.name, p.name, function (name) {
          Store.set('people', Store.get('people').map(function (x) { return x.id === p.id ? {id: x.id, name: name} : x; }));
          p = {id: p.id, name: name};
          showWho();
          refreshList(items());
        });
      }}];
      if (Store.get('people').length > 1) {
        out.push({label: confirm ? 'Press OK again to remove ' + p.name : 'Remove ' + p.name, val: '', ok: function () {
          if (!confirm) { confirm = true; refreshList(items()); return; }
          Store.set('people', Store.get('people').filter(function (x) { return x.id !== p.id; }));
          Store.forget(p.id);
          var wasCurrent = Store.get('person') === p.id;
          if (wasCurrent) Store.set('person', Store.get('people')[0].id);
          toast(p.name + ' removed');
          closeList();
          if (wasCurrent) personChanged(); else showWho();
        }});
      }
      return out;
    };
    openList({kind: 'settings', title: p.name, make: items});
  }

  /** Typing a name: the TV shows its own keyboard. OK saves, Back cancels. */
  function askName(title, initial, done) {
    var prev = S.overlay;
    $('input').innerHTML = '<div class="sheet input-sheet"><h3>' + esc(title) + '</h3>' +
      '<input id="nameInput" type="text" maxlength="20" autocomplete="off" value="' + esc(initial) + '">' +
      '<div class="hint">Type a name, then OK. Back to cancel.</div></div>';
    $('input').hidden = false;
    S.overlay = 'input';
    var field = $('nameInput');
    field.focus();
    try { field.setSelectionRange(initial.length, initial.length); } catch (e) {}
    S.inputDone = function (save) {
      var name = field.value.replace(/^\s+|\s+$/g, '');
      if (save && !name) return;
      field.blur();
      $('input').hidden = true;
      $('input').innerHTML = '';
      S.overlay = prev;
      S.inputDone = null;
      if (save) done(name);
    };
  }

  // MARK: - Backup

  var restoreArmed = false;   // Restore needs a second OK
  function when(t) {
    var d = new Date(t);
    try {
      return d.toLocaleDateString('en-US', {timeZone: ZONE, month: 'short', day: 'numeric'}) + ', ' +
        d.toLocaleTimeString('en-US', {timeZone: ZONE, hour: 'numeric', minute: '2-digit', hour12: !Store.get('clock24')});
    } catch (e) { return d.toDateString(); }
  }
  function backupWhen() { var t = Backup.lastAt(); return t ? 'Last: ' + when(t) : 'Not yet'; }

  function restoreNow(b) {
    if (Backup.restore(b)) { toast('Restored. Starting again…'); setTimeout(function () { location.reload(); }, 900); }
    else toast('Couldn\'t restore the backup', 3000);
  }

  /** A fresh install with a backup on the TV: offer to bring it back. done() carries on with the start-up. */
  function offerRestore(done) {
    var b = Backup.fresh ? Backup.load() : null;
    if (!b) { done(); return; }
    Backup.pause(true);   // don't back up the empty new install over the good backup while asking
    var people = [];
    try { people = JSON.parse(b.data['bth.people'] || '[]').map(function (p) { return p.name; }); } catch (e) {}
    var decided = false;
    openList({kind: 'picker', title: 'Restore your backup?',
              hint: 'Found a backup from ' + when(b.at) + (people.length ? ' with ' + people.join(', ') : '') + '.',
              items: [{label: 'Restore it', ok: function () { decided = true; restoreNow(b); }},
                      {label: 'Start fresh', ok: function () { closeList(); }}],
              onClose: function () { if (!decided) { Backup.pause(false); done(); } }});
  }

  /** What the TV reports for each app: for fixing logos that don't show. */
  function openAppDetails() {
    var items = function () {
      var out = [];
      S.apps.forEach(function (a) {
        var status = !a.icon ? 'no logo from the TV' : iconStatus[a.id] ? 'logo ' + iconStatus[a.id] : 'checking…';
        out.push({label: a.title, val: status});
        out.push({about: 'App id: ' + esc(a.id) + '<br>Logo: ' + esc(a.icon || '(none)')});
      });
      return out.length ? out : [{about: 'No apps reported by the TV.'}];
    };
    // Check the logos of apps that aren't in the dock too.
    S.apps.forEach(function (a) {
      if (!a.icon || iconStatus[a.id]) return;
      var pic = new Image();
      pic.onload = function () { iconStatus[a.id] = 'shown'; refreshIfOpen(); };
      pic.onerror = function () { iconStatus[a.id] = 'didn\'t load'; refreshIfOpen(); };
      pic.src = a.icon;
    });
    function refreshIfOpen() { var top = S.lists[S.lists.length - 1]; if (top && top.title === 'App details') refreshList(items()); }
    openList({kind: 'settings', title: 'App details', hint: 'What the TV reports for each app. Read me the lines for any app whose logo is missing.', make: items});
  }

  function openSettings() { restoreArmed = false; openList({kind: 'settings', title: 'Settings', hint: 'OK or ◀ ▶ to change. Back to close.', make: settingsItems, start: 1}); }

  function openServices() {
    var items = function () {
      var mine = myServices(), installed = {};
      S.apps.forEach(function (a) { var p = Movies.providerForApp(a); if (p) installed[p.id] = 1; });
      var list = Movies.providers().slice().sort(function (a, b) { return (installed[b.id] || 0) - (installed[a.id] || 0); });
      return list.map(function (p) {
        return {label: p.name, img: p.logo, tag: installed[p.id] ? 'App installed' : '', check: mine.indexOf(p.id) >= 0,
                ok: function () {
                  var m = myServices().slice(), i = m.indexOf(p.id);
                  if (i >= 0) m.splice(i, 1); else m.push(p.id);
                  Store.set('services', m);
                  refreshList(items());
                }};
      });
    };
    openList({kind: 'settings', title: 'My streaming services', hint: 'Tick the services you pay for or use. OK to switch.', items: items(),
              onClose: function () {
                Store.set('service', picked().filter(function (id) { return myServices().indexOf(id) >= 0; }));
                renderFilters(); S.mIdx = 0; load();
              }});
  }

  function openDockSettings() {
    function ordered() {
      var order = Store.get('dockOrder');
      return S.apps.slice().sort(function (a, b) {
        var ia = order.indexOf(a.id), ib = order.indexOf(b.id);
        if (ia < 0 && ib < 0) return 0; if (ia < 0) return 1; if (ib < 0) return -1; return ia - ib;
      });
    }
    function moveApp(id, d) {
      var ids = ordered().map(function (a) { return a.id; }), i = ids.indexOf(id), j = i + d;
      if (j < 0 || j >= ids.length) return;
      ids[i] = ids[j]; ids[j] = id;
      Store.set('dockOrder', ids);
      var cfg = S.lists[S.lists.length - 1];
      cfg.idx = j;
      refreshList(items());
    }
    var items = function () {
      var hidden = Store.get('dockHidden');
      return ordered().map(function (a) {
        return {label: a.title, check: hidden.indexOf(a.id) < 0,
                ok: function () {
                  var h = Store.get('dockHidden').slice(), i = h.indexOf(a.id);
                  if (i >= 0) h.splice(i, 1); else h.push(a.id);
                  Store.set('dockHidden', h);
                  refreshList(items());
                },
                left: function () { moveApp(a.id, -1); }, right: function () { moveApp(a.id, 1); }};
      });
    };
    openList({kind: 'settings', title: 'Apps in the dock', hint: 'OK to show or hide. ◀ moves up, ▶ moves down.', items: items(),
              onClose: buildDock});
  }

  /** Services matched to the installed apps: the first guess at what you subscribe to. */
  function defaultServices() {
    var out = [];
    S.apps.forEach(function (a) { var p = Movies.providerForApp(a); if (p && out.indexOf(p.id) < 0) out.push(p.id); });
    return out;
  }

  // MARK: - The remote

  function isBack(code) { return code === K.back || code === K.back2 || code === 27; }

  // Fast mode: quick presses switch animations off, so the highlight jumps instead of animations piling up.
  var fastTimer = null;
  function fastMode() {
    if (Date.now() - S.lastKey < 160 && document.body.className.indexOf(' fast') < 0) document.body.className += ' fast';
    clearTimeout(fastTimer);
    fastTimer = setTimeout(function () { document.body.className = document.body.className.replace(/ fast\b/g, ''); }, 260);
  }

  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;
    fastMode();
    S.lastKey = Date.now();
    if (!$('night').hidden) { $('night').hidden = true; e.preventDefault(); return; }   // any key wakes it
    if (S.overlay === 'input') {
      // Typing goes to the name field; only OK/Done and Back/Cancel are ours.
      if (code === 13 || code === 65376) { e.preventDefault(); S.inputDone(true); }
      else if (code === 27 || code === 10009 || code === 65385) { e.preventDefault(); S.inputDone(false); }
      return;
    }
    if (!TV.isTV && code >= 49 && code <= 52) code = [K.red, K.green, K.yellow, K.blue][code - 49];
    if (code === K.red) {   // Full <-> Simple layout (not while choosing who's watching or typing a name)
      if (S.welcome || S.overlay === 'input') return;
      if (S.overlay === 'detail') closeDetail();
      cycle('layout', ['full', 'simple'], 1);
      layoutChanged();
      toast(simple() ? 'Simple layout' : 'Full layout');
      var top = S.lists[S.lists.length - 1];
      if (top && top.make) refreshList(top.make());
      return;
    }
    if (code === K.green && !S.overlay && !simple()) { toggleScope(); return; }
    if (code === K.yellow && !S.overlay && !simple()) { cycle('rankBy', ['imdb', 'meta'], 1); toast(Store.get('rankBy') === 'meta' ? 'Ranked by Metacritic' : 'Ranked by IMDb rating'); filtersChanged(); return; }
    if (code === K.blue && !S.overlay) { openSettings(); return; }
    var handled = [K.left, K.right, K.up, K.down, K.ok, K.back, K.back2, 27].indexOf(code) >= 0;
    if (!handled) return;
    e.preventDefault();
    if (S.overlay === 'detail') { detailKey(code); return; }
    if (S.overlay === 'list') { listKey(code); return; }
    if (code === K.left) move(-1, 0);
    else if (code === K.right) move(1, 0);
    else if (code === K.up) move(0, -1);
    else if (code === K.down) move(0, 1);
    else if (code === K.ok) ok();
    else if (isBack(code) && S.zone !== 'movies' && S.movies.length) { S.zone = 'movies'; focusDraw(); }
  });

  // MARK: - Start

  function fitPreview() {
    if (TV.isTV) return;
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.width = document.body.style.width = window.innerWidth + 'px';
    document.documentElement.style.height = document.body.style.height = window.innerHeight + 'px';
    $('screen').style.transform = 'scale(' + s + ')';
  }

  /** The browser preview reloads itself after a rebuild, so it never shows an old version. */
  function watchForChanges() {
    var seen = null;
    setInterval(function () {
      var x = new XMLHttpRequest();
      x.open('GET', 'version.txt', true);
      x.onload = function () {
        if (x.status !== 200 || !x.responseText) return;
        if (seen !== null && x.responseText !== seen) location.reload();
        seen = x.responseText;
      };
      x.send();
    }, 1500);
  }

  function start() {
    S.welcome = Store.get('people').length > 1;
    if (simple()) S.zone = 'dock';
    fitPreview();
    window.addEventListener('resize', fitPreview);
    document.addEventListener('wheel', listMouse, {passive: false});
    ['picker', 'settings'].forEach(function (id) { $(id).addEventListener('click', listMouse); });
    if (!TV.isTV) watchForChanges();
    TV.registerKeys();
    tick();
    setInterval(tick, 10000);
    renderFilters();
    renderRow(true);
    updateHero();
    var left = 2;
    function both() {
      if (--left) return;
      if (Store.get('services') === null) Store.set('services', defaultServices());
      // Version 1 missed Netflix and Apple TV: add any installed service it missed, once.
      if (Store.get('servicesSeed') < 2) {
        var add = defaultServices().filter(function (id) { return myServices().indexOf(id) < 0; });
        Store.set('services', myServices().concat(add));
        Store.set('servicesSeed', 2);
      }
      buildDock();
      renderFilters();
      showWho();
      offerRestore(function () {
        // Who's watching? first, so the list loads once, for the right person.
        if (Store.get('people').length > 1) pickPerson(true); else load();
        // Automatic backups: after changes, and at least once a day.
        Store.onChange(Backup.later);
        if (Date.now() - Backup.lastAt() > 864e5) Backup.later();
      });
      setTimeout(showWeather, 1500);
      setTimeout(Store.sweep, 30 * 1000);   // tidy old movie data once things have settled
    }
    TV.helper({cmd: 'hello'});   // starts the background helper
    var gotApps = false;
    TV.apps(function (apps) {
      if (gotApps) return;   // the TV sometimes answers twice
      gotApps = true;
      S.apps = apps;
      buildDock();
      both();
      // Test builds only: the report to the Mac (see diag.js).
      Diag.attach({apps: function () { return S.apps; }, iconStatus: iconStatus, returnTo: function () { return S.returnTo; },
                   open: function (id) { var a = appById(id); if (a) openApp(a); }});
    });
    Movies.loadLists(function (okd) { if (!okd) toast('Couldn\'t reach the movie services. Check the TV\'s internet.', 4000); both(); });
    // The TV comes back to this screen: pick up a new day's data.
    document.addEventListener('visibilitychange', function () {
      Diag.note((document.hidden ? 'BigTuna Home hidden' : 'BigTuna Home on screen') + ' · ' + screenNow());
      if (document.hidden) { leftScreen(); return; }
      TV.helper({cmd: 'back'});   // back on screen: the helper stops watching
      backOnScreen();             // after the TV was off (or Samsung's screen): Who's watching?
      // Back on screen: show it as it was at once; the dock reorders only if the order changed, and the movie
      // list and weather refresh a moment later, so nothing jumps while you arrive.
      S.lastKey = Date.now();
      tick();
      if (Store.get('dockSort') === 'recent') {
        var was = dockOrderNow();
        buildDock();
        if (dockOrderNow() !== was) S.dIdx = 0;
      }
      setTimeout(function () {
        if (document.hidden) return;
        showWeather();
        if (!S.overlay && !S.loading) load();
      }, 2500);
    });
    setInterval(showWeather, 5 * 60 * 1000);
    setInterval(heartbeat, 15000);
    window.addEventListener('blur', lostFocus);
    window.addEventListener('focus', gotFocus);
    // Test builds: every sign the page gets around the TV turning off and on.
    if (Diag.on) {
      ['freeze', 'resume'].forEach(function (ev) { document.addEventListener(ev, function () { Diag.note('page ' + ev + ' · ' + screenNow()); }); });
      ['pageshow', 'pagehide', 'blur', 'focus'].forEach(function (ev) { window.addEventListener(ev, function () { Diag.note('window ' + ev + ' · ' + screenNow()); }); });
    }
  }

  start();
})();
