/*
 * Weerdata van Open-Meteo (gratis, geen sleutel nodig, CC BY 4.0).
 * We vragen meerdere weermodellen tegelijk op: als ze het eens zijn over zon,
 * is de voorspelling "zeker".
 */
(function (root) {
  const ZZ = (root.ZZ = root.ZZ || {});

  const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
  const VARS = ['sunshine_duration', 'precipitation', 'temperature_2m'];

  const MODEL_LABELS = {
    ecmwf_ifs025: 'ECMWF',
    icon_seamless: 'ICON (DWD)',
    gfs_seamless: 'GFS (NOAA)',
    meteofrance_seamless: 'Météo-France',
    best_match: 'Open-Meteo',
  };

  // Als Open-Meteo een modelnaam niet (meer) kent, proberen we de volgende set.
  const MODEL_SETS = [
    ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless', 'meteofrance_seamless'],
    ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'],
    ['best_match'],
  ];

  const BATCH = 50;
  const FORECAST_DAYS = 5;
  const MAX_AGE_MS = 60 * 60 * 1000;

  const cache = new Map(); // key -> { at, wx }
  let modelSetIndex = 0;

  class WeatherError extends Error {
    constructor(message, kind) {
      super(message);
      this.kind = kind;
    }
  }

  function keyOf(p) {
    return p.lat.toFixed(3) + ',' + p.lon.toFixed(3);
  }

  function pick(obj, v, model, single) {
    if (!obj) return null;
    const suffixed = obj[v + '_' + model];
    if (suffixed) return suffixed;
    return single ? obj[v] || null : null;
  }

  /** Zet één locatie uit het Open-Meteo-antwoord om naar ons eigen formaat. */
  function normalize(loc, models) {
    const h = loc.hourly || {};
    const single = models.length === 1;
    const out = { times: h.time || [], models: {} };
    for (const m of models) {
      const sun = pick(h, 'sunshine_duration', m, single);
      if (!sun) continue;
      out.models[m] = {
        sun,
        precip: pick(h, 'precipitation', m, single),
        temp: pick(h, 'temperature_2m', m, single),
      };
    }
    return out;
  }

  async function fetchJson(url, signal) {
    let res;
    try {
      res = await fetch(url, { signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new WeatherError('Kan de weerdienst niet bereiken. Controleer je internetverbinding.', 'network');
    }
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      /* geen JSON */
    }
    if (!res.ok || (body && body.error)) {
      const reason = (body && body.reason) || res.statusText || 'onbekende fout';
      if (res.status === 429 || /limit/i.test(reason)) {
        throw new WeatherError(
          'De gratis weerdienst (Open-Meteo) heeft even te veel aanvragen gehad. Probeer het over een tijdje opnieuw.',
          'limit'
        );
      }
      throw new WeatherError('Weerdienst gaf een fout: ' + reason, res.status === 400 ? 'bad-request' : 'server');
    }
    return body;
  }

  async function fetchBatch(places, timeZone, signal) {
    for (;;) {
      const models = MODEL_SETS[modelSetIndex];
      const params = new URLSearchParams({
        latitude: places.map((p) => p.lat.toFixed(3)).join(','),
        longitude: places.map((p) => p.lon.toFixed(3)).join(','),
        hourly: VARS.join(','),
        models: models.join(','),
        forecast_days: String(FORECAST_DAYS),
        timezone: timeZone,
        timeformat: 'unixtime',
      });
      try {
        const body = await fetchJson(ENDPOINT + '?' + params.toString(), signal);
        const list = Array.isArray(body) ? body : [body];
        return list.map((loc) => normalize(loc, models));
      } catch (e) {
        if (e.kind === 'bad-request' && modelSetIndex < MODEL_SETS.length - 1) {
          modelSetIndex++;
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * Haal voorspellingen op voor een lijst plekken. Gebruikt de cache waar mogelijk.
   * @returns {Promise<Map<string, object>>} plek-id -> genormaliseerde voorspelling
   */
  async function getForecasts(places, { timeZone, signal, onProgress } = {}) {
    const now = Date.now();
    const result = new Map();
    const missing = [];
    for (const p of places) {
      const c = cache.get(keyOf(p));
      if (c && now - c.at < MAX_AGE_MS) result.set(p.id, c.wx);
      else missing.push(p);
    }

    const batches = [];
    for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));

    let done = places.length - missing.length;
    if (onProgress) onProgress(done, places.length);

    // Twee batches tegelijk: snel genoeg en vriendelijk voor de gratis dienst.
    let next = 0;
    async function worker() {
      while (next < batches.length) {
        const batch = batches[next++];
        const list = await fetchBatch(batch, timeZone, signal);
        batch.forEach((p, i) => {
          const wx = list[i];
          if (!wx) return;
          cache.set(keyOf(p), { at: Date.now(), wx });
          result.set(p.id, wx);
        });
        done += batch.length;
        if (onProgress) onProgress(done, places.length);
      }
    }
    await Promise.all([worker(), worker()]);
    return result;
  }

  function modelLabel(id) {
    return MODEL_LABELS[id] || id;
  }

  ZZ.weather = { getForecasts, modelLabel, normalize, WeatherError, _cache: cache };
})(typeof window !== 'undefined' ? window : globalThis);
