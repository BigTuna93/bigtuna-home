/*
 * BigTuna Home: the TV layer. Lists and opens the TV's apps, opens Samsung's settings, reads the remote.
 * In a desktop browser (the preview) it uses sample apps and the keyboard.
 *
 * The Samsung app filter and app-id notes are adapted from Free My TV (github.com/simbasjungles/free-my-tv),
 * MIT License, Copyright (c) 2026 Free My TV contributors.
 */
var TV = (function () {
  'use strict';
  var tizen = typeof window.tizen !== 'undefined' && !!window.tizen.application;

  // Smart Hub's own pieces, the platform's tools, services, keyboards and ad players: not apps a person opens.
  var HIDDEN = new RegExp('^(org\\.volt\\.|org\\.tizen\\.(?!browser$|netflix|primevideo$)|org\\.tizen\\.netflixlowmem$|ise-|ug-|d75857a5-)' +
      '|[Ss]ervice$|[Dd]aemon|Preview$|syspopup|[Hh]elper$|AdPlayer|AdSuite|[Kk]eyboard|\\.OTApp$|dummy$|_companionapp$' +
      '|^com\\.samsung\\.calendar-account-manager' +
      '|^com\\.samsung\\.tv\\.(?!store$|SmartThingsApp$|aria-video$|tvplus$|gaminghub$)' +
      '|^com\\.samsung\\.tizen\\.' +
      '|^com\\.samsung\\.(ep[-.]|rdm[-.]|SelfDiagnosis$|mtm-banner$|hitcomp$|video-test$)' +
      '|^com\\.sausng\\.|^adplatform\\.' +
      '|^(unified-drm-|lib-|p2p-asm|mobilebff$|comss$|acm-watcher$|dmr_service_app$|aifw-|csapi-|capi-|ep-|test-|emergency-log-transmitter$|samsung-easy-support$)');

  var TITLES = {
    'NvZ26VG9Yw.HBOGOLAG': 'Max',
    'evKhCgZelL.AmazonIgnitionLauncher2': 'Prime Video',
    'org.tizen.primevideo': 'Prime Video',
    'rJeHak5zRg.Spotify': 'Spotify'
  };

  // Brand colors for tiles whose icon can't be read.
  var COLORS = [
    [/netflix/i, '#E50914'], [/youtube/i, '#FF0033'], [/prime|amazon/i, '#1A98FF'], [/disney/i, '#113CCF'],
    [/^max$|hbo/i, '#002BE7'], [/hulu/i, '#1CE783'], [/apple/i, '#1C1C1E'], [/paramount/i, '#0064FF'],
    [/peacock/i, '#111111'], [/spotify/i, '#1DB954'], [/plex/i, '#E5A00D'], [/tubi/i, '#7408FF'],
    [/pluto/i, '#2C2C2C'], [/crunchyroll/i, '#F47521'], [/plus|tv\s?plus/i, '#3A4A5C']
  ];

  var SAMPLE = ['Netflix', 'YouTube', 'YouTube TV', 'Prime Video', 'Disney+', 'Max', 'Hulu', 'Apple TV', 'Paramount+', 'Peacock', 'Spotify', 'Internet'];

  function color(title) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i][0].test(title)) return COLORS[i][1];
    return '#3A3F4B';
  }

  var self = 'BigTunaHom.BigTunaHome';
  if (tizen) { try { self = window.tizen.application.getCurrentApplication().appInfo.id; } catch (e) {} }

  function apps(done) {
    if (!tizen) {
      // ?icons=1 in the preview: stand-in logos shaped like a TV's (and one that fails to load), to test logo tiles.
      var icons = /[?&]icons=1/.test(location.search);
      done(SAMPLE.map(function (t, i) {
        var icon = !icons ? '' : i === 1 ? 'file:///no/such/logo.png' :
          'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="423"><rect width="512" height="423" fill="' +
          color(t) + '"/><text x="256" y="230" font-family="Helvetica" font-weight="700" font-size="64" fill="#fff" text-anchor="middle">' + t + '</text></svg>');
        return {id: 'sample.' + t.toLowerCase().replace(/\W/g, ''), title: t, icon: icon, color: color(t)};
      }));
      return;
    }
    try {
      window.tizen.application.getAppsInfo(function (list) {
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var a = list[i];
          if (!a.id || a.id === self || HIDDEN.test(a.id) || a.show === false) continue;
          var icon = a.iconPath || '';
          if (icon && icon.indexOf('://') < 0) icon = 'file://' + icon;
          var title = TITLES[a.id] || a.name || a.id;
          out.push({id: a.id, title: title, icon: icon, color: color(title)});
        }
        // The built-in Netflix only when the store's Netflix isn't there.
        if (out.some(function (x) { return /\.Netflix$/.test(x.id); })) out = out.filter(function (x) { return x.id.indexOf('org.tizen.netflix') !== 0; });
        out.sort(function (x, y) { var a = x.title.toLowerCase(), b = y.title.toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; });
        done(out);
      }, function () { done([]); });
    } catch (e) { done([]); }
  }

  function plainLaunch(id, done) {
    try {
      window.tizen.application.launch(id, function () { if (done) done(true); }, function () { if (done) done(false); });
    } catch (e) { if (done) done(false); }
  }

  /**
   * Opens an app. mode 'control' (a test): opens it as a request from this app that expects an answer, which on
   * some TVs brings you back here when that app closes. If the TV won't open an app that way, the usual way is used.
   */
  function launch(id, done, mode, onClosed) {
    if (!tizen) { if (done) setTimeout(function () { done(true); }, 0); return; }
    if (mode === 'control') {
      try {
        var request = new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null, []);
        // The TV answers a request when the app that took it ends: one more way to notice it closed.
        var answered = function () { if (onClosed) onClosed('answer'); };
        window.tizen.application.launchAppControl(request, id,
          function () { if (done) done(true); },
          function () { plainLaunch(id, done); },
          {onsuccess: answered, onfailure: answered});
        return;
      } catch (e) {}
    }
    plainLaunch(id, done);
  }

  /** The ids of the apps running now (null if the TV won't say). */
  function running(done) {
    if (!tizen) { done(null); return; }
    try {
      window.tizen.application.getAppsContext(function (list) {
        done(list.map(function (c) { return c.appId; }));
      }, function () { done(null); });
    } catch (e) { done(null); }
  }

  /**
   * Tells cb(isActive) whenever app id starts or stops being the active app (Tizen 4+). Returns a function that stops it.
   * With no id, cb(appId, isActive) hears about every app.
   */
  function watchStatus(id, cb) {
    if (!tizen || !window.tizen.application.addAppStatusChangeListener) return function () {};
    try {
      var lid = id ? window.tizen.application.addAppStatusChangeListener(function (appId, active) { cb(active, appId); }, id)
                   : window.tizen.application.addAppStatusChangeListener(function (appId, active) { cb(appId, active); });
      return function () { try { window.tizen.application.removeAppStatusChangeListener(lid); } catch (e) {} };
    } catch (e) { return function () {}; }
  }

  /**
   * Brings BigTuna Home back to the front, with the request Samsung's own home uses to resume an app (eden_resume),
   * so it returns at once instead of reloading; a plain launch if the TV refuses that.
   */
  function bringBack() {
    if (!tizen) return;
    var plain = function () { try { window.tizen.application.launch(self, function () {}, function () {}); } catch (e) {} };
    try {
      var resume = new window.tizen.ApplicationControl('http://samsung.com/appcontrol/operation/eden_resume');
      window.tizen.application.launchAppControl(resume, self, function () {}, plain);
    } catch (e) { plain(); }
  }

  // MARK: - The background helper (service/watch.js)

  // Samsung store ids: the TV's status service (port 8001) only knows apps by these, not by their app ids.
  // `0 was_execute <app id>` over the developer connection shows an app's store id (app_id[...]).
  var STORE_IDS = {
    '9Ur5IzDKqV.TizenYouTube': '111299001912', 'PvWgqxV3Xa.YouTubeTV': '3201707014489',
    'org.tizen.netflix-app': '3201907018807', 'org.tizen.primevideo': '3201910019365',
    'MCmYXNxgcu.DisneyPlus': '3201901017640', 'LBUAQX1exg.Hulu': '3201601007625',
    'gzcc4LRFBF.Peacock': '3202006020991', 'com.samsung.tv.aria-video': '3201807016597',
    'rJeHak5zRg.Spotify': '3201606009684', '5b8c3eb16b.BeamCTVDev': '3202301029760'
  };
  function storeId(appId) { return STORE_IDS[appId] || ''; }

  var HELPER = self.split('.')[0] + '.Watch', HELPER_URL = 'http://127.0.0.1:8130/';

  /**
   * Tells the helper something (and starts it if it isn't running): over its local port, and as a service request.
   * Either is enough; both are tried. (The port is what makes the return seamless: a secret-code lock that made the
   * helper wait for the service request first was tried, and the return got slower, so Samsung's bar showed.)
   */
  function helper(data) {
    if (!tizen) return;
    var q = [];
    for (var k in data) q.push(k + '=' + encodeURIComponent(String(data[k])));
    try {
      var x = new XMLHttpRequest();
      x.open('GET', HELPER_URL + data.cmd + '?' + q.join('&'), true);
      x.timeout = 1500;
      x.send();
    } catch (e) {}
    try {
      var items = [];
      for (var key in data) items.push(new window.tizen.ApplicationControlData(key, [String(data[key])]));
      var request = new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service', null, null, null, items);
      window.tizen.application.launchAppControl(request, HELPER, function () {}, function () {});
    } catch (e) {}
  }

  /** The helper's recent log, for Settings and test builds: done(object or null). */
  function helperLog(done) {
    if (!tizen) { done(null); return; }
    try {
      var x = new XMLHttpRequest();
      x.open('GET', HELPER_URL + 'log', true);
      x.timeout = 2000;
      x.onload = function () { try { done(JSON.parse(x.responseText)); } catch (e) { done(null); } };
      x.onerror = x.ontimeout = function () { done(null); };
      x.send();
    } catch (e) { done(null); }
  }

  function settings(done) {
    if (!tizen) { if (done) done(true); return; }
    try {
      var control = new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/setting', null, null, null, []);
      window.tizen.application.launchAppControl(control, null, function () { if (done) done(true); }, function () { launch('org.tizen.menu', done); });
    } catch (e) { launch('org.tizen.menu', done); }
  }

  /** Steps aside: whatever is under the app (Samsung's screen or the TV picture) shows. */
  function hide() {
    if (!tizen) return;
    try { window.tizen.application.getCurrentApplication().hide(); } catch (e) {}
  }

  function registerKeys() {
    if (!tizen || !window.tizen.tvinputdevice) return;
    ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlayPause'].forEach(function (k) {
      try { window.tizen.tvinputdevice.registerKey(k); } catch (e) {}
    });
  }

  function model() {
    if (!tizen) return 'Preview in a browser';
    var out = '';
    try { out = window.tizen.systeminfo.getCapability('http://tizen.org/system/model_name') || ''; } catch (e) {}
    try { out += ' · Tizen ' + window.tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'); } catch (e) {}
    return out;
  }

  return {
    isTV: tizen,
    apps: apps,
    launch: launch,
    running: running,
    watchStatus: watchStatus,
    bringBack: bringBack,
    storeId: storeId,
    helper: helper,
    helperLog: helperLog,
    self: self,
    settings: settings,
    hide: hide,
    registerKeys: registerKeys,
    model: model,
    keys: {left: 37, up: 38, right: 39, down: 40, ok: 13, back: tizen ? 10009 : 27, back2: 8,
           red: 403, green: 404, yellow: 405, blue: 406}
  };
})();
