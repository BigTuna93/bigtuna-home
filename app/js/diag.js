/*
 * BigTuna Home: test builds only. Sends the Mac a report of what the TV sees: the apps and their logos (size, how long
 * each took to load, whether it loaded), how quickly each key press is drawn, which tiles were on screen when drawing
 * fell behind, and any errors. Off unless the build wrote a report address into js/diag-config.js.
 */
var Diag = (function () {
  'use strict';
  var cfg = window.DIAG;
  if (!cfg || !cfg.url) return {on: false, attach: function () {}, note: function () {}};

  var started = Date.now(), hooks = null, sentKeys = -1, sentErrors = -1;
  var errors = [], latency = [], slowOn = {}, notes = [], thumbs = {};
  var frames = {count: 0, slow: 0, worst: 0};
  var keys = {count: 0, held: 0};
  var logos = {};   // app id: {w, h, ms, ok}

  function push(list, x, max) { list.push(x); if (list.length > (max || 100)) list.shift(); }

  window.addEventListener('error', function (e) {
    push(errors, (e.message || 'error') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0));
  });
  var consoleError = console.error;
  console.error = function () {
    push(errors, Array.prototype.slice.call(arguments).join(' '));
    if (consoleError) consoleError.apply(console, arguments);
  };

  // MARK: - Timing: from each key press to the screen being drawn, and every frame while the remote is in use

  var now = window.performance && performance.now ? function () { return performance.now(); } : function () { return Date.now(); };
  var frame = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
  var activeUntil = 0, last = 0, running = false;

  function focused() {
    var f = document.querySelector('.focus-zone .focus') || document.querySelector('.item.focus');
    if (!f) return 'nothing highlighted';
    return f.getAttribute('data-id') || (f.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) || f.className;
  }

  function loop() {
    var t = now();
    if (last) {
      var dt = t - last;
      frames.count++;
      if (dt > frames.worst) frames.worst = Math.round(dt);
      if (dt > 50) {   // a frame that took more than three times as long as it should (16 ms)
        frames.slow++;
        var at = focused();
        slowOn[at] = (slowOn[at] || 0) + 1;
      }
    }
    last = t;
    if (t < activeUntil) frame(loop);
    else { running = false; last = 0; }
  }

  document.addEventListener('keydown', function (e) {
    var t0 = now();
    keys.count++;
    if (e.repeat) keys.held++;
    // Two frames later the change is on screen.
    frame(function () { frame(function () { push(latency, Math.round(now() - t0), 500); }); });
    activeUntil = t0 + 1500;
    if (!running) { running = true; frame(loop); }
  }, true);

  // MARK: - Logos: size and load time of each app's logo, including apps hidden from the dock

  function measureLogos() {
    if (!hooks) return;
    hooks.apps().forEach(function (a) {
      if (!a.icon || logos[a.id]) return;
      var t0 = now(), pic = new Image();
      logos[a.id] = {checking: true};
      pic.onload = function () {
        logos[a.id] = {ok: true, w: pic.naturalWidth, h: pic.naturalHeight, ms: Math.round(now() - t0)};
        // A small copy of the logo for the report, if the TV lets the app read its pixels.
        try {
          var c = document.createElement('canvas');
          c.width = 64; c.height = Math.max(1, Math.round(64 * pic.naturalHeight / pic.naturalWidth));
          c.getContext('2d').drawImage(pic, 0, 0, c.width, c.height);
          thumbs[a.id] = c.toDataURL('image/png');
          logos[a.id].readable = true;
        } catch (e) { logos[a.id].readable = false; }
      };
      pic.onerror = function () { logos[a.id] = {ok: false, ms: Math.round(now() - t0)}; };
      pic.src = a.icon;
    });
  }

  // MARK: - The report

  function stats(list) {
    if (!list.length) return {};
    var s = list.slice().sort(function (a, b) { return a - b; });
    return {presses: s.length, median: s[Math.floor(s.length / 2)], slowest10pct: s[Math.floor(s.length * 0.9)], worst: s[s.length - 1]};
  }

  function storageKB() {
    var n = 0;
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || '').length; } } catch (e) {}
    return Math.round(n * 2 / 1024);
  }

  function send(reason) {
    try { sendNow(reason); } catch (e) { status('report failed: ' + (e && e.message || e)); }
  }

  function sendNow(reason) {
    var apps = hooks ? hooks.apps().map(function (a) {
      return {title: a.title, id: a.id, logo: a.icon || '', shown: hooks.iconStatus[a.id] || (a.icon ? 'not in dock' : 'no logo'), file: logos[a.id] || null};
    }) : [];
    var report = {
      reason: reason, sentAt: new Date().toISOString(), minutesRunning: Math.round((Date.now() - started) / 6000) / 10,
      tv: {model: window.TV ? TV.model() : '', userAgent: navigator.userAgent, screen: screen.width + 'x' + screen.height,
           window: window.innerWidth + 'x' + window.innerHeight, pixelRatio: window.devicePixelRatio || 1},
      layout: document.body.className,
      keys: {count: keys.count, heldRepeats: keys.held, drawTimeMs: stats(latency)},
      frames: {whileInUse: frames.count, slow: frames.slow, worstMs: frames.worst, slowWhileHighlighted: slowOn},
      apps: apps, errors: errors, storageKB: storageKB(), notes: notes, answer: answer, logoThumbs: reason === 'start' ? thumbs : undefined,
      hidden: document.hidden, comeBack: hooks && hooks.returnTo ? hooks.returnTo() : null
    };
    var x = new XMLHttpRequest();
    x.open('POST', cfg.url, true);
    x.setRequestHeader('Content-Type', 'text/plain');   // a "simple" request: no extra permission round-trip
    x.timeout = 10000;
    x.onload = function () { status(x.status < 300 ? 'report sent ✓ ' + clock() : 'Mac refused the report (' + x.status + ')'); };
    x.onerror = function () { status('report blocked (network error) ' + clock()); };
    x.ontimeout = function () { status('report timed out ' + clock()); };
    status('sending report…');
    x.send(JSON.stringify(report));
    sentKeys = keys.count;
    sentErrors = errors.length;
  }

  // A small label so a test build is never mistaken for the normal one; it also says how the last report went.
  var labelEl = null;
  function label() {
    labelEl = document.createElement('div');
    labelEl.className = 'test-build';
    (document.getElementById('screen') || document.body).appendChild(labelEl);
    status('waiting to send the first report');
  }
  function status(text) { if (labelEl) labelEl.textContent = 'TEST BUILD · ' + text; }
  function clock() { var d = new Date(); return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }

  // While another app is on screen: a short report every 5 seconds, if BigTuna Home is still running then.
  var hiddenTimer = null, lastRunning = '';
  // Every app's start/stop as the TV reports it (to learn how YouTube and Samsung's home screen show up).
  if (window.TV && TV.watchStatus) TV.watchStatus(null, function (appId, active) { note('any app: ' + appId + (active ? ' active' : ' not active')); });
  document.addEventListener('visibilitychange', function () {
    clearInterval(hiddenTimer);
    if (document.hidden) {
      hiddenTimer = setInterval(function () {
        var tizenApi = window.tizen && window.tizen.application;
        if (tizenApi) {
          try {
            tizenApi.getAppsContext(function (list) {
              var ids = list.map(function (c) { return c.appId; }).join(', ');
              if (ids !== lastRunning) note('running (all): ' + ids);
              lastRunning = ids;
              send('in background');
            }, function (e) { note('running apps unavailable: ' + (e && e.message)); send('in background'); });
            return;
          } catch (e) { note('getAppsContext failed: ' + e.message); }
        }
        send('in background');
      }, 5000);
    } else send('back on screen');
  });

  function note(text) {
    var d = new Date();
    push(notes, d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2) + '.' +
         Math.floor(d.getMilliseconds() / 100) + ' ' + text, 80);
  }

  // A question from the Mac (test builds only): a piece of JavaScript run here; its answer goes back in a report.
  // The code gets done(value) for answers that arrive later (the TV's APIs answer through callbacks).
  var answer = null;
  function runQuestion(code) {
    var sent = false, done = function (value) {
      if (sent) return;
      sent = true;
      try { answer = JSON.parse(JSON.stringify(value === undefined ? null : value)); } catch (e) { answer = String(value); }
      send('answer');
      answer = null;
    };
    try {
      var value = new Function('done', 'tizen', code)(done, window.tizen);
      if (value !== undefined) done(value);
    } catch (e) { done('Error: ' + (e && e.message || e)); }
    setTimeout(function () { done('no answer within 8 s'); }, 8000);
  }

  // Instructions from the Mac (test builds only), so a test can run without the remote:
  // "open <app id>" opens it as if its tile were picked; "key <code>" acts as that remote key.
  function checkForInstruction() {
    var x = new XMLHttpRequest();
    x.open('GET', cfg.url.replace(/\/report$/, '/command'), true);
    x.timeout = 4000;
    x.onload = function () {
      var text = x.status === 200 ? String(x.responseText || '').trim() : '';
      if (!text) return;
      note('instruction: ' + text);
      var m = /^open (\S+)$/.exec(text), k = /^key (\d+)(?: (\d+))?(?: (\d+))?$/.exec(text);
      if (/^eval /.test(text)) { runQuestion(text.slice(5)); return; }
      if (m && hooks && hooks.open) { hooks.open(m[1]); send('after instruction'); }
      else if (k) {
        // "key <code> [times] [ms apart]": a burst of presses, like holding or tapping quickly on the remote.
        var times = +(k[2] || 1), gap = +(k[3] || 80), i = 0;
        var press = function () {
          var e = document.createEvent('Event');
          e.initEvent('keydown', true, true);
          e.keyCode = e.which = +k[1];
          document.dispatchEvent(e);
          if (++i < times) setTimeout(press, gap); else setTimeout(function () { send('after keys'); }, 1600);
        };
        press();
      }
    };
    try { x.send(); } catch (e) {}
  }

  return {
    on: true,
    note: note,
    /** Called by app.js once the apps are known. */
    attach: function (h) {
      if (hooks) { hooks = h; return; }   // once only
      hooks = h;
      label();
      measureLogos();
      setTimeout(function () { measureLogos(); send('start'); }, 8000);
      // Then every 20 seconds, but only when something new happened.
      setInterval(function () { if (keys.count !== sentKeys || errors.length !== sentErrors) send('update'); }, 20000);
      setInterval(checkForInstruction, 3000);
    }
  };
})();
