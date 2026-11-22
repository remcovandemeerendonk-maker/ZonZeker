/*
 * Rekenkern van ZonZeker: afstand, zonnestand en de zonscore per dag.
 * Geen netwerk, geen DOM: alles hier is los te testen met `node --test`.
 */
(function (root) {
  const ZZ = (root.ZZ = root.ZZ || {});
  const RAD = Math.PI / 180;

  /** Hartlijnafstand in km. */
  function haversineKm(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * RAD;
    const dLon = (lon2 - lon1) * RAD;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /**
   * Zonshoogte in graden boven de horizon (benadering, ±0,5°).
   * @param {number} lat
   * @param {number} lon
   * @param {number} ms  Unix-tijd in milliseconden
   */
  function solarElevation(lat, lon, ms) {
    const d = ms / 86400000 - 10957.5; // dagen sinds J2000.0
    const g = (357.529 + 0.98560028 * d) * RAD;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
    const e = (23.439 - 0.00000036 * d) * RAD;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmstHours = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
    const ha = (gmstHours * 15 + lon) * RAD - ra;
    const sinEl =
      Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha);
    return Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
  }

  const dayKeyFormatters = new Map();
  /** Datum als 'JJJJ-MM-DD' in de opgegeven tijdzone. */
  function dayKey(ms, timeZone) {
    let f = dayKeyFormatters.get(timeZone);
    if (!f) {
      f = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      dayKeyFormatters.set(timeZone, f);
    }
    return f.format(new Date(ms));
  }

  /** De eerstvolgende `count` dagen vanaf vandaag, als dagsleutels. */
  function upcomingDays(nowMs, count, timeZone) {
    const keys = [];
    let ms = nowMs;
    while (keys.length < count) {
      const k = dayKey(ms, timeZone);
      if (!keys.includes(k)) keys.push(k);
      ms += 6 * 3600 * 1000;
    }
    return keys;
  }

  /*
   * Grenzen voor de indeling. Een dag is "zeker zonnig" als de modellen
   * gemiddeld veel zon geven én ook het somberste model nog ruim zon ziet.
   */
  const CLASSES = [
    { id: 'zeker', label: 'Zeker zon', icon: '☀️' },
    { id: 'waarschijnlijk', label: 'Waarschijnlijk zonnig', icon: '🌤️' },
    { id: 'wisselend', label: 'Af en toe zon', icon: '⛅' },
    { id: 'weinig', label: 'Weinig zon', icon: '☁️' },
  ];

  /** Uren met de zon minstens zo hoog tellen als "beschikbare" zonuren. */
  const MIN_ELEVATION_FOR_CAPACITY = 5;
  /** Regen (mm overdag) vanaf wanneer een model een "natte dag" voorspelt. */
  const RAIN_MM = 0.5;

  function classify(mean, min, rainShare) {
    if (mean >= 0.65 && min >= 0.5 && rainShare <= 0.25) return 'zeker';
    if (mean >= 0.45 && min >= 0.25 && rainShare <= 0.5) return 'waarschijnlijk';
    if (mean >= 0.2) return 'wisselend';
    return 'weinig';
  }

  function scoreOf(mean, min, rainShare) {
    const s = 100 * (0.6 * mean + 0.4 * min) - 20 * rainShare;
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  /**
   * Vat de uurlijkse voorspelling samen per dag.
   *
   * @param {object} wx  Genormaliseerde voorspelling:
   *   { times: number[] (unix s, eind van het uur), models: { [id]: { sun:[], precip:[], temp:[] } } }
   * @param {object} opts
   *   lat, lon, timeZone, days: string[] (dagsleutels),
   *   earliestMs: tijdstip vanaf wanneer uren meetellen (vandaag: aankomsttijd)
   * @returns {Object<string, object>} samenvatting per dagsleutel
   */
  function summarizeDays(wx, opts) {
    const { lat, lon, timeZone, days, earliestMs = 0 } = opts;
    const modelIds = Object.keys(wx.models || {});
    const want = new Set(days);
    const perDay = {};
    for (const k of days) perDay[k] = { idx: [], capacityIdx: [] };

    for (let i = 0; i < wx.times.length; i++) {
      const endMs = wx.times[i] * 1000;
      const startMs = endMs - 3600 * 1000;
      const midMs = endMs - 1800 * 1000;
      const k = dayKey(midMs, timeZone);
      if (!want.has(k)) continue;
      if (startMs < earliestMs) continue;
      const el = solarElevation(lat, lon, midMs);
      if (el <= 0) continue;
      perDay[k].idx.push(i);
      if (el >= MIN_ELEVATION_FOR_CAPACITY) perDay[k].capacityIdx.push(i);
    }

    const out = {};
    for (const k of days) {
      const { idx, capacityIdx } = perDay[k];
      const capacityH = capacityIdx.length;
      if (capacityH < 2) {
        out[k] = { valid: false, reason: earliestMs ? 'te-laat' : 'geen-daglicht' };
        continue;
      }

      const models = [];
      for (const id of modelIds) {
        const m = wx.models[id];
        let sunS = 0;
        let have = 0;
        let rain = 0;
        let tmax = -Infinity;
        for (const i of idx) {
          const s = m.sun ? m.sun[i] : null;
          if (s != null && !Number.isNaN(s)) {
            sunS += s;
            have++;
          }
          const p = m.precip ? m.precip[i] : null;
          if (p != null) rain += p;
          const t = m.temp ? m.temp[i] : null;
          if (t != null && t > tmax) tmax = t;
        }
        if (have < idx.length * 0.5) continue; // model heeft geen data voor deze dag
        const frac = Math.min(1, sunS / (capacityH * 3600));
        models.push({
          id,
          frac,
          sunH: sunS / 3600,
          rainMm: rain,
          tmax: tmax === -Infinity ? null : tmax,
        });
      }

      if (!models.length) {
        out[k] = { valid: false, reason: 'geen-data' };
        continue;
      }

      const fracs = models.map((m) => m.frac);
      const mean = fracs.reduce((a, b) => a + b, 0) / fracs.length;
      const min = Math.min(...fracs);
      const max = Math.max(...fracs);
      const rainShare = models.filter((m) => m.rainMm >= RAIN_MM).length / models.length;
      const temps = models.map((m) => m.tmax).filter((t) => t != null);

      // Per uur: gemiddelde zonfractie over de modellen (voor het uurbalkje).
      const hours = idx.map((i) => {
        let sum = 0;
        let n = 0;
        for (const id of modelIds) {
          const s = wx.models[id].sun ? wx.models[id].sun[i] : null;
          if (s != null) {
            sum += s;
            n++;
          }
        }
        return { t: wx.times[i], frac: n ? Math.min(1, sum / n / 3600) : null };
      });

      out[k] = {
        valid: true,
        mean,
        min,
        max,
        spread: max - min,
        sunH: models.reduce((a, m) => a + m.sunH, 0) / models.length,
        capacityH,
        rainShare,
        rainMm: models.reduce((a, m) => a + m.rainMm, 0) / models.length,
        tmax: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
        models,
        hours,
        partial: earliestMs > 0,
        score: scoreOf(mean, min, rainShare),
        cls: classify(mean, min, rainShare),
      };
    }
    return out;
  }

  /** Beste geldige dag van een plek (hoogste score; bij gelijkspel de vroegste). */
  function bestDay(summaries, days) {
    let best = null;
    for (const k of days) {
      const s = summaries[k];
      if (!s || !s.valid) continue;
      if (!best || s.score > summaries[best].score) best = k;
    }
    return best;
  }

  /** Schatting van de rijtijd (s) als er geen routeplanner beschikbaar is. */
  function estimateDrive(km) {
    const roadKm = km * 1.25;
    const kmh = roadKm < 40 ? 55 : roadKm < 120 ? 75 : 92;
    return { sec: (roadKm / kmh) * 3600, m: roadKm * 1000 };
  }

  Object.assign(ZZ, {
    haversineKm,
    solarElevation,
    dayKey,
    upcomingDays,
    summarizeDays,
    bestDay,
    classify,
    scoreOf,
    estimateDrive,
    CLASSES,
    CLASS_ORDER: CLASSES.map((c) => c.id),
  });
})(typeof window !== 'undefined' ? window : globalThis);
