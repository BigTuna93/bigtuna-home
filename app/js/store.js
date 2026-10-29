/* BigTuna Home: settings and the data cache, kept in the TV app's own storage. */
var Store = (function () {
  'use strict';
  var PREFIX = 'bth.';
  var DEFAULTS = {
    theme: 'dark',        // dark | light | auto (dark from 7 pm to 7 am)
    layout: 'full',       // full (top movies) | simple (clock and bigger apps only)
    rankBy: 'imdb',       // imdb (user rating) | meta (Metacritic)
    minVotes: 20000,      // IMDb ratings a movie needs to make the list
    listSize: 10,
    scope: 'mine',        // mine (on my services) | all (every movie)
    genre: [],            // TMDB genre ids picked in the Genre filter, [] = all
    service: [],          // TMDB provider ids picked in the Service filter, [] = all
    year: [],             // years and decades picked in the Year filter ('2020s', '2024'), [] = any
    kind: ['movie'],      // Type filter: any of movie, series, mini; [] = all three
    services: null,       // TMDB provider ids I subscribe to; null until first set from the installed apps
    servicesSeed: 0,      // which version last added installed services
    dockOrder: [],
    dockHidden: [],
    dockSeeded: false,    // Internet is hidden from the dock once, at the start
    backdrop: 'follow',   // follow (the highlighted movie) | still (keeps the first) | off
    animations: true,
    clock24: false,
    dockSort: 'recent',   // recent (last opened first) | mine (the order set in Apps in the dock)
    night: 23,            // hour the night screen starts (until 6 am), or 'off'
    weather: true,
    launchMode: 'control', // control (opens apps as a request: the TV answers when they close) | launch (the usual way)
    comeBack: true,       // after an app it opened closes, BigTuna Home brings itself back
    people: [{id: 'p1', name: 'Me'}],
    person: 'p1',         // who's watching
    // Kept for each person:
    showWatched: true,    // watched movies stay in the list (with a small check)
    watched: [],          // TMDB ids
    watchlist: [],        // TMDB ids, newest first
    appUsed: {}           // app id: when last opened
  };
  // Settings kept separately for each person.
  var PER_PERSON = {layout: 1, rankBy: 1, minVotes: 1, listSize: 1, scope: 1, genre: 1, service: 1, year: 1, kind: 1,
                    showWatched: 1, watched: 1, watchlist: 1, appUsed: 1};
  // Not touched by Reset all settings.
  var KEEP = {people: 1, person: 1, watched: 1, watchlist: 1, appUsed: 1, services: 1, servicesSeed: 1, dockSeeded: 1};
  var mem = {};

  function storeKey(key) { return PER_PERSON[key] ? PREFIX + 'p.' + get('person') + '.' + key : PREFIX + key; }

  function read(k) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v === undefined ? null : v; } catch (e) { return null; }
  }

  function get(key) {
    var k = storeKey(key);
    if (k in mem) return mem[k];
    var v = read(k);
    // The first person keeps the settings from before there were people.
    if (v === null && PER_PERSON[key] && get('person') === 'p1') v = read(PREFIX + key);
    mem[k] = v === null || !valid(key, v) ? DEFAULTS[key] : v;
    return mem[k];
  }

  /** A damaged or unexpected saved value falls back to the default instead of breaking the app. */
  function valid(key, v) {
    var d = DEFAULTS[key];
    if (key === 'people') {
      return v instanceof Array && v.length > 0 && v.every(function (p) {
        return p && typeof p.id === 'string' && /^p\d{1,3}$/.test(p.id) && typeof p.name === 'string' && p.name.length <= 40;
      });
    }
    if (key === 'genre' || key === 'service' || key === 'year') return true;   // older versions kept one value here
    if (d instanceof Array) return v instanceof Array;
    if (d !== null && typeof d === 'object') return typeof v === 'object' && v !== null && !(v instanceof Array);
    if (typeof d === 'boolean' || typeof d === 'number') return typeof v === typeof d || (key === 'night' && v === 'off');
    if (typeof d === 'string') return typeof v === 'string';
    return true;
  }

  var changed = null;   // told about every change (the automatic backup)
  function set(key, value) {
    var k = storeKey(key);
    mem[k] = value;
    var raw = JSON.stringify(value);
    try { localStorage.setItem(k, raw); }
    catch (e) {
      // Storage is full: make room by dropping old movie data (never settings), then try again.
      prune();
      try { localStorage.setItem(k, raw); } catch (e2) {}
    }
    if (changed) changed(key);
  }

  /** Back to the defaults, for the current person; people, watched movies and watchlists stay. */
  function reset() {
    Object.keys(DEFAULTS).forEach(function (k) {
      if (KEEP[k]) return;
      try { localStorage.removeItem(storeKey(k)); localStorage.removeItem(PREFIX + k); } catch (e) {}
    });
    mem = {};
  }

  /**
   * The saved names starting with prefix (or matching a pattern), listed first: removing entries while stepping
   * through localStorage reshuffles it, so some would be skipped.
   */
  function keys(match) {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (typeof match === 'string' ? k.indexOf(match) === 0 : match.test(k)) out.push(k);
      }
    } catch (e) {}
    return out;
  }
  function removeAll(list) { list.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} }); }

  /** Everything kept for one person, when they're removed. */
  function forget(personId) {
    removeAll(keys(PREFIX + 'p.' + personId + '.'));
    mem = {};
  }

  // The cache: {v: value, t: saved at}. Old entries are dropped when storage fills up.
  var C = 'bthc.';
  function cacheGet(key, maxAgeMs) {
    try {
      var raw = localStorage.getItem(C + key);
      if (!raw) return null;
      var e = JSON.parse(raw);
      if (maxAgeMs && Date.now() - e.t > maxAgeMs) return null;
      return e.v;
    } catch (err) { return null; }
  }

  function cacheSet(key, value) {
    var raw = JSON.stringify({v: value, t: Date.now()});
    try { localStorage.setItem(C + key, raw); }
    catch (err) {
      prune();
      try { localStorage.setItem(C + key, raw); } catch (err2) {}
    }
  }

  function prune() {
    try {
      var list = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf(C) !== 0) continue;
        var t = 0;
        try { t = JSON.parse(localStorage.getItem(k)).t; } catch (e) {}
        list.push([k, t]);
      }
      list.sort(function (a, b) { return a[1] - b[1]; });
      list.slice(0, Math.ceil(list.length / 3)).forEach(function (x) { localStorage.removeItem(x[0]); });
    } catch (e) {}
  }

  /** Drops movie data older than a month (nothing reads it any more). Reads only each entry's time, so it's quick. */
  function sweep() {
    var old = Date.now() - 31 * 864e5;   // ratings are kept 30 days
    removeAll(keys(C).filter(function (k) {
      var t = /"t":(\d+)\}$/.exec(localStorage.getItem(k) || '');
      return !t || +t[1] < old;
    }));
  }

  function cacheClear() { removeAll(keys(C)); }

  return {get: get, set: set, reset: reset, forget: forget, onChange: function (fn) { changed = fn; }, defaults: DEFAULTS, cacheGet: cacheGet, cacheSet: cacheSet, cacheClear: cacheClear, sweep: sweep, keys: keys, removeAll: removeAll};
})();
