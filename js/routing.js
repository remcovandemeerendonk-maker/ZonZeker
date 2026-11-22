/*
 * Rijtijden vanaf de startlocatie via de openbare OSRM-routeplanner
 * (OpenStreetMap-data). Lukt dat niet, dan schatten we de rijtijd uit de afstand.
 * Rijtijden worden per startlocatie in de browser bewaard: wegen veranderen zelden.
 */
(function (root) {
  const ZZ = (root.ZZ = root.ZZ || {});

  const SERVERS = [
    'https://router.project-osrm.org/table/v1/driving/',
    'https://routing.openstreetmap.de/routed-car/table/v1/driving/',
  ];
  const CHUNK = 80;
  /** OSRM rekent zonder verkeer; een kleine marge maakt het realistischer. */
  const TRAFFIC_FACTOR = 1.1;
  const STORE_PREFIX = 'zz.routes.v1.';

  function storeKey(start) {
    return STORE_PREFIX + start.lat.toFixed(3) + ',' + start.lon.toFixed(3);
  }

  function load(start) {
    try {
      const raw = localStorage.getItem(storeKey(start));
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function save(start, data) {
    try {
      localStorage.setItem(storeKey(start), JSON.stringify(data));
    } catch (_) {
      /* opslag vol of geblokkeerd: geen probleem */
    }
  }

  function withTimeout(signal, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    return { signal: ctrl.signal, done: () => clearTimeout(t) };
  }

  async function tableRequest(server, start, chunk, signal) {
    const coords = [start, ...chunk].map((p) => p.lon.toFixed(5) + ',' + p.lat.toFixed(5)).join(';');
    const url = server + coords + '?sources=0&annotations=duration,distance';
    const t = withTimeout(signal, 10000);
    try {
      const res = await fetch(url, { signal: t.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      if (body.code !== 'Ok' || !body.durations) throw new Error(body.code || 'onbekend');
      return chunk.map((_, i) => ({
        sec: body.durations[0][i + 1],
        m: body.distances ? body.distances[0][i + 1] : null,
      }));
    } finally {
      t.done();
    }
  }

  async function routeChunk(start, chunk, signal) {
    for (const server of SERVERS) {
      try {
        return await tableRequest(server, start, chunk, signal);
      } catch (e) {
        if (signal && signal.aborted) throw e;
      }
    }
    return null;
  }

  /**
   * @returns {Promise<Map<string, {sec:number, m:number, estimated:boolean}>>}
   */
  async function getDriveTimes(start, places, { signal } = {}) {
    const stored = load(start);
    const result = new Map();
    const missing = [];
    for (const p of places) {
      const s = stored[p.id];
      if (s) result.set(p.id, { sec: s[0], m: s[1], estimated: false });
      else missing.push(p);
    }

    let changed = false;
    let down = false; // na één mislukte poging niet blijven wachten: dan schatten we
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const routed = down ? null : await routeChunk(start, chunk, signal);
      if (!routed) down = true;
      chunk.forEach((p, j) => {
        const r = routed && routed[j];
        if (r && r.sec != null) {
          const sec = r.sec * TRAFFIC_FACTOR;
          const m = r.m != null ? r.m : ZZ.estimateDrive(ZZ.haversineKm(start.lat, start.lon, p.lat, p.lon)).m;
          stored[p.id] = [Math.round(sec), Math.round(m)];
          changed = true;
          result.set(p.id, { sec, m, estimated: false });
        } else {
          const est = ZZ.estimateDrive(ZZ.haversineKm(start.lat, start.lon, p.lat, p.lon));
          result.set(p.id, { sec: est.sec, m: est.m, estimated: true });
        }
      });
    }
    if (changed) save(start, stored);
    return result;
  }

  ZZ.routing = { getDriveTimes, TRAFFIC_FACTOR };
})(typeof window !== 'undefined' ? window : globalThis);
