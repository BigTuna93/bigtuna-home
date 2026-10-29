/*
 * BigTuna Home: the weather next to the clock, for New York City.
 * From Open-Meteo (open-meteo.com): free, no key, no tracking. One small request at most every 30 minutes.
 */
var Weather = (function () {
  'use strict';
  var URL = 'https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01' +
    '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min' +
    '&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=1';
  var FRESH = 30 * 60 * 1000;

  // WMO weather codes, in words.
  function words(c) {
    if (c === 0) return 'Clear';
    if (c <= 2) return 'Partly cloudy';
    if (c === 3) return 'Cloudy';
    if (c <= 48) return 'Fog';
    if (c <= 57) return 'Drizzle';
    if (c <= 67) return 'Rain';
    if (c <= 77) return 'Snow';
    if (c <= 82) return 'Showers';
    if (c <= 86) return 'Snow showers';
    return 'Thunderstorms';
  }

  /** done({temp, text, hi, lo}) or done(null); the last reading is used while it's under 30 minutes old. */
  function now(done) {
    var cached = Store.cacheGet('wx', FRESH);
    if (cached) { done(cached); return; }
    var x = new XMLHttpRequest();
    x.open('GET', URL, true);
    x.timeout = 10000;
    x.onload = function () {
      var r = null;
      try { r = JSON.parse(x.responseText); } catch (e) {}
      if (!r || !r.current) { done(Store.cacheGet('wx', 3 * FRESH)); return; }
      var w = {temp: Math.round(r.current.temperature_2m), text: words(r.current.weather_code),
               hi: Math.round(r.daily.temperature_2m_max[0]), lo: Math.round(r.daily.temperature_2m_min[0])};
      Store.cacheSet('wx', w);
      done(w);
    };
    x.onerror = x.ontimeout = function () { done(Store.cacheGet('wx', 3 * FRESH)); };
    x.send();
  }

  return {now: now};
})();
