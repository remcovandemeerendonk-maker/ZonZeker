// Unit-tests voor de rekenkern. Draaien met: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

require('../js/places.js');
require('../js/core.js');
require('../js/weather.js');
const ZZ = globalThis.ZZ;

const TZ = 'Europe/Amsterdam';

test('hartlijnafstand Amsterdam–Groningen is ongeveer 145 km', () => {
  const km = ZZ.haversineKm(52.37, 4.895, 53.219, 6.567);
  assert.ok(km > 140 && km < 150, km);
});

test('zonshoogte klopt globaal (Amsterdam)', () => {
  // Zomerzonnewende rond 13:40 lokale tijd ≈ 61°, winterzonnewende ≈ 14°.
  const summer = ZZ.solarElevation(52.37, 4.9, Date.UTC(2026, 5, 21, 11, 40));
  const winter = ZZ.solarElevation(52.37, 4.9, Date.UTC(2026, 11, 21, 11, 40));
  const night = ZZ.solarElevation(52.37, 4.9, Date.UTC(2026, 11, 21, 0, 0));
  assert.ok(Math.abs(summer - 61) < 1.5, summer);
  assert.ok(Math.abs(winter - 14.2) < 1.5, winter);
  assert.ok(night < -50, night);
});

test('upcomingDays geeft opeenvolgende dagen', () => {
  const days = ZZ.upcomingDays(Date.UTC(2026, 10, 22, 13, 0), 4, TZ);
  assert.deepEqual(days, ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
});

test('alle plekken hebben geldige gegevens en unieke id', () => {
  const ids = new Set();
  for (const p of ZZ.PLACES) {
    assert.ok(p.lat > 35 && p.lat < 60, p.name);
    assert.ok(p.lon > -10 && p.lon < 20, p.name);
    assert.ok(['stad', 'kust', 'natuur', 'bergen'].includes(p.type), p.name);
    assert.ok(!ids.has(p.id), 'dubbel: ' + p.id);
    ids.add(p.id);
  }
});

/** Bouw een nep-voorspelling: per model een vaste zonfractie overdag. */
function fakeForecast(lat, lon, fracByModel, { rainByModel = {}, startMs = Date.UTC(2026, 10, 22, 0) } = {}) {
  const times = [];
  for (let h = 1; h <= 24 * 5; h++) times.push(startMs / 1000 + h * 3600);
  const models = {};
  for (const [id, frac] of Object.entries(fracByModel)) {
    models[id] = {
      sun: times.map((t) => (ZZ.solarElevation(lat, lon, t * 1000 - 1800000) > 5 ? frac * 3600 : 0)),
      precip: times.map(() => (rainByModel[id] || 0) / 8),
      temp: times.map(() => 8),
    };
  }
  return { times, models };
}

test('modellen eens over veel zon → "zeker"', () => {
  const wx = fakeForecast(49.6, 6.1, { a: 0.9, b: 0.85, c: 0.8, d: 0.9 });
  const days = ['2026-11-23', '2026-11-24'];
  const s = ZZ.summarizeDays(wx, { lat: 49.6, lon: 6.1, timeZone: TZ, days });
  for (const k of days) {
    assert.equal(s[k].valid, true);
    assert.equal(s[k].cls, 'zeker');
    assert.ok(s[k].mean > 0.8);
    assert.ok(s[k].sunH > 5 && s[k].sunH < 9, s[k].sunH);
    assert.equal(s[k].tmax, 8);
  }
});

test('modellen oneens → niet "zeker", ook al is het gemiddelde hoog', () => {
  const wx = fakeForecast(49.6, 6.1, { a: 1, b: 1, c: 1, d: 0.2 });
  const s = ZZ.summarizeDays(wx, { lat: 49.6, lon: 6.1, timeZone: TZ, days: ['2026-11-23'] });
  assert.notEqual(s['2026-11-23'].cls, 'zeker');
  assert.equal(s['2026-11-23'].cls, 'wisselend');
});

test('regen bij de helft van de modellen haalt "zeker" weg', () => {
  const wx = fakeForecast(49.6, 6.1, { a: 0.9, b: 0.9, c: 0.9, d: 0.9 }, { rainByModel: { a: 3, b: 3 } });
  const s = ZZ.summarizeDays(wx, { lat: 49.6, lon: 6.1, timeZone: TZ, days: ['2026-11-23'] });
  assert.equal(s['2026-11-23'].rainShare, 0.5);
  assert.equal(s['2026-11-23'].cls, 'waarschijnlijk');
});

test('bewolkt → "weinig"', () => {
  const wx = fakeForecast(52, 5, { a: 0.05, b: 0.1, c: 0 });
  const s = ZZ.summarizeDays(wx, { lat: 52, lon: 5, timeZone: TZ, days: ['2026-11-23'] });
  assert.equal(s['2026-11-23'].cls, 'weinig');
});

test('vandaag: aankomst na zonsondergang is niet geldig', () => {
  const wx = fakeForecast(52, 5, { a: 1 });
  const s = ZZ.summarizeDays(wx, {
    lat: 52,
    lon: 5,
    timeZone: TZ,
    days: ['2026-11-22'],
    earliestMs: Date.UTC(2026, 10, 22, 16, 0),
  });
  assert.equal(s['2026-11-22'].valid, false);
  assert.equal(s['2026-11-22'].reason, 'te-laat');
});

test('vandaag: alleen uren na aankomst tellen', () => {
  const wx = fakeForecast(52, 5, { a: 1 });
  const full = ZZ.summarizeDays(wx, { lat: 52, lon: 5, timeZone: TZ, days: ['2026-11-22'] });
  const late = ZZ.summarizeDays(wx, {
    lat: 52,
    lon: 5,
    timeZone: TZ,
    days: ['2026-11-22'],
    earliestMs: Date.UTC(2026, 10, 22, 11, 0),
  });
  assert.ok(late['2026-11-22'].sunH < full['2026-11-22'].sunH);
  assert.equal(late['2026-11-22'].partial, true);
});

test('model zonder data voor een dag telt niet mee', () => {
  const wx = fakeForecast(49.6, 6.1, { a: 0.9, b: 0.9 });
  wx.models.b.sun = wx.models.b.sun.map(() => null);
  const s = ZZ.summarizeDays(wx, { lat: 49.6, lon: 6.1, timeZone: TZ, days: ['2026-11-23'] });
  assert.equal(s['2026-11-23'].models.length, 1);
});

test('bestDay kiest de hoogste score', () => {
  const sums = {
    a: { valid: true, score: 40 },
    b: { valid: true, score: 80 },
    c: { valid: false },
    d: { valid: true, score: 80 },
  };
  assert.equal(ZZ.bestDay(sums, ['a', 'b', 'c', 'd']), 'b');
});

test('normalize leest per-model velden van Open-Meteo', () => {
  const loc = {
    hourly: {
      time: [1, 2],
      sunshine_duration_ecmwf_ifs025: [3600, 0],
      precipitation_ecmwf_ifs025: [0, 1],
      temperature_2m_ecmwf_ifs025: [5, 6],
      sunshine_duration_icon_seamless: [1800, 1800],
      precipitation_icon_seamless: [0, 0],
      temperature_2m_icon_seamless: [4, 4],
    },
  };
  const wx = ZZ.weather.normalize(loc, ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless']);
  assert.deepEqual(Object.keys(wx.models), ['ecmwf_ifs025', 'icon_seamless']);
  assert.deepEqual(wx.models.icon_seamless.sun, [1800, 1800]);

  const single = ZZ.weather.normalize({ hourly: { time: [1], sunshine_duration: [100] } }, ['best_match']);
  assert.deepEqual(single.models.best_match.sun, [100]);
});

test('schatting rijtijd is redelijk', () => {
  // ~190 km hemelsbreed (Utrecht–Luxemburg ~ 270 km over de weg, ~3 uur)
  const est = ZZ.estimateDrive(ZZ.haversineKm(52.09, 5.12, 49.61, 6.13));
  assert.ok(est.sec / 3600 > 2.5 && est.sec / 3600 < 4, est.sec / 3600);
});
