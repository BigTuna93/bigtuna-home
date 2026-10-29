/*
 * BigTuna Home: a backup of people, watched movies, watchlists and settings.
 * On the TV it's a file in the TV's Documents storage, which stays when the app is uninstalled; in the browser
 * preview it's kept in the browser. Two copies (the latest and the one before), so a half-written file can't lose both.
 */
var Backup = (function () {
  'use strict';
  var fs = typeof window.tizen !== 'undefined' && window.tizen.filesystem && window.tizen.filesystem.openFile;
  var FILE = 'documents/bigtuna-home-backup.json', PREV = 'documents/bigtuna-home-backup-prev.json';
  var PREFIX = 'bth.';
  var AT = 'bthb.at';   // when the last backup was made (not part of the backup itself)

  // A fresh install has nothing saved yet: checked before the app saves anything.
  var fresh = (function () {
    try {
      for (var i = 0; i < localStorage.length; i++) if (localStorage.key(i).indexOf(PREFIX) === 0) return false;
    } catch (e) {}
    return true;
  })();

  function collect() {
    var data = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf(PREFIX) === 0) data[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    return {app: 'BigTuna Home', v: 1, at: Date.now(), data: data};
  }

  function readText(path) {
    if (!fs) { try { return localStorage.getItem(path); } catch (e) { return null; } }
    try {
      if (!window.tizen.filesystem.pathExists(path)) return null;
      var fh = window.tizen.filesystem.openFile(path, 'r');
      var text = fh.readString();
      fh.close();
      return text;
    } catch (e) { return null; }
  }

  function writeText(path, text) {
    if (!fs) { localStorage.setItem(path, text); return; }
    var fh = window.tizen.filesystem.openFile(path, 'w');
    fh.writeString(text);
    fh.close();
  }

  function parse(text) {
    try { var b = JSON.parse(text); return b && b.app === 'BigTuna Home' && b.data ? b : null; } catch (e) { return null; }
  }

  /** Saves a backup now. Returns true if it worked. */
  function save() {
    try {
      var old = readText(FILE);
      if (parse(old)) writeText(PREV, old);
      var b = collect();
      writeText(FILE, JSON.stringify(b));
      localStorage.setItem(AT, String(b.at));
      return true;
    } catch (e) { return false; }
  }

  /** The newest good backup, or null. */
  function load() { return parse(readText(FILE)) || parse(readText(PREV)); }

  /**
   * Replaces everything saved with the backup's copy. The app reloads afterwards.
   * Only BigTuna's own settings are taken (names like bth.theme or bth.p.p2.watchlist), each must be valid JSON,
   * and the whole backup is checked before anything is replaced.
   */
  var NAME = /^bth\.(p\.p\d{1,3}\.)?[A-Za-z0-9]{1,30}$/;
  function restore(b) {
    var keep = {}, n = 0;
    for (var key in b.data) {
      var v = b.data[key];
      if (!NAME.test(key) || typeof v !== 'string' || v.length > 100000) continue;
      try { JSON.parse(v); } catch (e) { continue; }
      keep[key] = v;
      n++;
    }
    if (!n) return false;
    try {
      Store.removeAll(Store.keys(PREFIX));
      for (var k2 in keep) localStorage.setItem(k2, keep[k2]);
      return true;
    } catch (e) { return false; }
  }

  // Automatic backups, a minute after the last change, so a burst of changes is one backup.
  var timer = null, paused = false;
  function later() {
    if (paused) return;
    clearTimeout(timer);
    timer = setTimeout(save, 60 * 1000);
  }

  function lastAt() { try { return parseInt(localStorage.getItem(AT), 10) || 0; } catch (e) { return 0; } }

  return {
    fresh: fresh,
    where: fs ? 'TV storage' : 'this browser',
    save: save, load: load, restore: restore, later: later, lastAt: lastAt,
    pause: function (p) { paused = p; if (p) clearTimeout(timer); }
  };
})();
