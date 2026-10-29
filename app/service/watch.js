/*
 * BigTuna Home's background helper. The TV runs it as its own small process (a Tizen web service), apart from the
 * home screen's page, so it keeps working while the TV freezes that page (it does whenever Samsung's home screen or a
 * heavy app is up). Its jobs:
 *
 *  1. Watch an app BigTuna opened, through the TV's own status service, and bring BigTuna back when that app leaves
 *     the screen (checked every half second). The status service (http://127.0.0.1:8001/api/v2/applications/<STORE id>) says whether an app is
 *     running and whether it is on screen. On this TV it only knows apps by their Samsung store id, which the page
 *     sends along. Exiting YouTube never closes it (it only leaves the screen), so "left the screen" is the signal.
 *  2. The Home button: when BigTuna loses the screen without having opened anything, the page says "away"; after a
 *     moment, if none of your apps took the screen, BigTuna comes back. The Samsung tile pauses this for a while.
 *
 * Bringing BigTuna back uses Samsung's own resume request (eden_resume), so it returns at once instead of reloading.
 * The page talks to it over 127.0.0.1:8130 (only reachable from the TV itself) and through service requests.
 * Plain ES5 for the TV's Node runtime. Approach from Skylight (github.com/SaudSatopay/skylight-tizen, MIT, Saud Satopay).
 */
'use strict';

var http = require('http');
var url = require('url');

var BIGTUNA = 'BigTunaHom.BigTunaHome';
var PORT = 8130;
var MAX_WATCH_MS = 6 * 60 * 60 * 1000;

var job = null;      // the app being watched: {app, store, shown, seen, hiddenSince, stops, busy, started, timer}
var away = null;     // after the Home button: {tries, timer}
var pausedUntil = 0; // the Samsung tile asked to leave Samsung's screen alone until then
var homeReturn = true;
var lines = [], startedAt = '';

function log(text) {
  var t = new Date(), two = function (n) { return (n < 10 ? '0' : '') + n; };
  lines.push(two(t.getHours()) + ':' + two(t.getMinutes()) + ':' + two(t.getSeconds()) + ' ' + text);
  if (lines.length > 120) lines.shift();
}

// ---- Asking the TV ----------------------------------------------------------------------------

function get(path, done) {
  var finished = false, finish = function (status, body) { if (!finished) { finished = true; done(status, body); } };
  var req = http.get({host: '127.0.0.1', port: 8001, path: path, headers: {'Cache-Control': 'no-cache'}}, function (res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (chunk) { body += chunk; });
    res.on('end', function () { finish(res.statusCode, body); });
  });
  req.setTimeout(1500, function () { req.abort(); finish(0, ''); });
  req.on('error', function () { finish(0, ''); });
}

/** {running, visible} for a store id, or null if the TV won't say. */
function state(store, done) {
  if (!store) { done(null); return; }
  get('/api/v2/applications/' + store, function (status, body) {
    try {
      var d = JSON.parse(body);
      done(status === 200 && typeof d.running === 'boolean' ? {running: d.running, visible: !!d.visible} : null);
    } catch (e) { done(null); }
  });
}

/** The store ids among `stores` (except `skip`) that are on screen now. */
function visibleAmong(stores, skip, done) {
  var list = stores.filter(function (s) { return s && s !== skip; }), pending = list.length, out = [];
  if (!pending) { done(out); return; }
  list.forEach(function (s) {
    state(s, function (st) {
      if (st && st.running && st.visible) out.push(s);
      if (--pending === 0) done(out);
    });
  });
}

function bringBack(why) {
  log('bringing BigTuna Home back: ' + why);
  try {
    var resume = new tizen.ApplicationControl('http://samsung.com/appcontrol/operation/eden_resume');
    tizen.application.launchAppControl(resume, BIGTUNA, function () { log('resumed'); }, function (e) {
      log('resume refused (' + (e && e.name) + '); launching instead');
      try { tizen.application.launch(BIGTUNA, function () {}, function (e2) { log('launch failed: ' + (e2 && e2.name)); }); } catch (e3) { log('launch threw'); }
    });
  } catch (e) {
    log('resume threw (' + e.name + '); launching instead');
    try { tizen.application.launch(BIGTUNA); } catch (e2) { log('launch threw'); }
  }
}

// ---- Watching an app BigTuna opened -----------------------------------------------------------

function stop(why) {
  if (job) { clearInterval(job.timer); if (why) log('stopped watching ' + job.app + ': ' + why); }
  job = null;
}

function watch(app, store, shown) {
  stop('another app was opened');
  cancelAway();
  if (!store) { log('no store id for ' + app + ': the page watches it instead'); return; }
  job = {app: app, store: store, shown: shown, seen: false, hiddenSince: 0, stops: 0, busy: false, started: Date.now(), timer: null};
  log('watching ' + app + ' (' + store + ')');
  job.timer = setInterval(check, 500);
}

function check() {
  var j = job;
  if (!j || j.busy) return;
  var age = Date.now() - j.started;
  if (age > MAX_WATCH_MS) { stop('6 hours passed'); return; }
  j.busy = true;
  state(j.store, function (st) {
    j.busy = false;
    if (job !== j || !st) return;
    if (st.running && st.visible) {
      if (!j.seen) log(j.app + ' is on screen');
      j.seen = true; j.hiddenSince = 0; j.stops = 0;
      return;
    }
    if (!j.seen) { if (age > 30000) stop('it never came on screen'); return; }
    if (!st.running && ++j.stops < 2) return;   // two answers in a row, so a hiccup isn't an exit
    // Off screen (or closed). Give the screen a moment, then see whether another of your apps took it.
    if (!j.hiddenSince) { j.hiddenSince = Date.now(); log(j.app + (st.running ? ' left the screen' : ' closed')); return; }
    if (Date.now() - j.hiddenSince < 800) return;
    j.busy = true;
    visibleAmong(j.shown, j.store, function (vis) {
      j.busy = false;
      if (job !== j) return;
      if (vis.length) { log('another app took the screen (' + vis[0] + '); watching that instead'); j.store = vis[0]; j.app = vis[0]; j.hiddenSince = 0; return; }
      var left = j.app;
      stop();
      bringBack(left + ' left the screen');
    });
  });
}

// ---- The Home button ---------------------------------------------------------------------------

function cancelAway() { if (away) { clearTimeout(away.timer); away = null; } }

function onAway(shown) {
  if (job) return;                                   // an app BigTuna opened has the screen; the watch handles it
  if (!homeReturn) { log('Home pressed; Home return is off'); return; }
  if (Date.now() < pausedUntil) { log('Home pressed; leaving Samsung\'s screen alone for now'); return; }
  cancelAway();
  away = {tries: 0, timer: null, shown: shown};
  log('BigTuna left the screen without opening anything (Home)');
  scheduleAway(1500);
}

function scheduleAway(ms) {
  if (!away) return;
  away.timer = setTimeout(function () {
    if (!away || job) return;
    if (Date.now() < pausedUntil) { cancelAway(); return; }
    visibleAmong(away.shown, '', function (vis) {
      if (!away) return;
      if (vis.length) { log(vis[0] + ' is on screen; staying away'); cancelAway(); return; }
      away.tries++;
      bringBack('Home was pressed (try ' + away.tries + ')');
      if (away.tries < 3) scheduleAway(2500); else cancelAway();
    });
  }, ms);
}

// ---- Commands (from the page) ------------------------------------------------------------------

var APP_ID = /^[A-Za-z0-9._-]{1,80}$/, STORE_ID = /^\d{6,16}$/;
var lastCmd = '', lastAt = 0;

function handle(cmd, p) {
  // The page sends each message two ways (its local port and a service request): act on it once.
  var key = cmd + '|' + (p.app || '') + '|' + (p.store || '') + '|' + (p.seconds || '');
  if (key === lastCmd && Date.now() - lastAt < 1500) return;
  lastCmd = key; lastAt = Date.now();
  // Only well-formed ids: an app id, and a numeric store id (it goes into a request to the TV's status service).
  var app = APP_ID.test(p.app || '') ? p.app : '', store = STORE_ID.test(p.store || '') ? p.store : '';
  var shown = (p.shown || '').split(',').filter(function (s) { return STORE_ID.test(s); }).slice(0, 60);
  if (p.homeReturn !== undefined) homeReturn = p.homeReturn !== 'false';
  if (cmd === 'watch') { if (app) watch(app, store, shown); }
  else if (cmd === 'away') onAway(shown);
  else if (cmd === 'back') { cancelAway(); stop('BigTuna is on screen'); }
  else if (cmd === 'pause') {
    var secs = Math.max(10, Math.min(900, parseInt(p.seconds, 10) || 180));
    pausedUntil = Date.now() + secs * 1000; cancelAway(); log('leaving Samsung\'s screen alone for ' + secs + ' s');
  }
  else if (cmd === 'hello') log('hello from the page (Home return ' + (homeReturn ? 'on' : 'off') + ')');
  else if (cmd) log('unknown request: ' + cmd);
}

/** BigTuna's own page (a packaged app) has no web origin; anything with an http(s) origin is a website. */
function fromWebsite(req) { return /^https?:/i.test(String(req.headers.origin || '')); }

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true), path = parsed.pathname.replace(/^\/+/, '');
  res.setHeader('Cache-Control', 'no-store');
  if (fromWebsite(req)) { res.statusCode = 403; res.end('forbidden'); return; }
  if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);   // file:// or null: our page
  if (path === 'log') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({since: startedAt, watching: job ? job.app : '', paused: Date.now() < pausedUntil, homeReturn: homeReturn, lines: lines}));
    return;
  }
  if (/^(watch|away|back|pause|hello)$/.test(path)) { handle(path, parsed.query); res.end('ok'); return; }
  res.statusCode = 404;
  res.end('not found');
});
server.on('error', function (e) { log('could not listen on ' + PORT + ': ' + e.message); });

function requestData() {
  var out = {};
  try {
    tizen.application.getCurrentApplication().getRequestedAppControl().appControl.data.forEach(function (d) { out[d.key] = d.value[0]; });
  } catch (e) {}
  return out;
}

module.exports = {
  onStart: function () {
    var t = new Date();
    startedAt = t.toDateString().slice(4, 10) + ' ' + t.toTimeString().slice(0, 8);
    log('helper started');
    try { server.listen(PORT, '127.0.0.1', function () { log('listening on 127.0.0.1:' + PORT); }); } catch (e) { log('listen threw: ' + e.message); }
  },
  onRequest: function () { var d = requestData(); handle(d.cmd, d); },
  onExit: function () { stop('helper exiting'); },
  onStop: function () { stop('helper stopping'); }
};
