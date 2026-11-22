/*
 * Startlocatie zoeken: Open-Meteo-geocoding voor suggesties tijdens het typen,
 * Nominatim (OpenStreetMap) voor de naam bij "mijn locatie" en als vangnet.
 */
(function (root) {
  const ZZ = (root.ZZ = root.ZZ || {});

  async function search(query, { signal } = {}) {
    const q = query.trim();
    if (q.length < 2) return [];
    const url =
      'https://geocoding-api.open-meteo.com/v1/search?' +
      new URLSearchParams({ name: q, count: '6', language: 'nl', format: 'json' });
    try {
      const res = await fetch(url, { signal });
      if (res.ok) {
        const body = await res.json();
        const list = (body.results || []).map((r) => ({
          name: r.name,
          detail: [r.admin1, r.country].filter(Boolean).join(', '),
          lat: r.latitude,
          lon: r.longitude,
        }));
        if (list.length) return list;
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
    return [];
  }

  /** Eenmalige zoekactie via Nominatim (ook adressen en postcodes). */
  async function searchAddress(query, { signal } = {}) {
    const url =
      'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', 'accept-language': 'nl' });
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return [];
      const body = await res.json();
      return body.map((r) => {
        const parts = String(r.display_name || '').split(',').map((s) => s.trim());
        return {
          name: r.name || parts[0] || query,
          detail: parts.slice(1, 4).join(', '),
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
        };
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return [];
    }
  }

  async function reverse(lat, lon) {
    const url =
      'https://nominatim.openstreetmap.org/reverse?' +
      new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: '12', 'accept-language': 'nl' });
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const body = await res.json();
      const a = body.address || {};
      return a.city || a.town || a.village || a.municipality || body.name || null;
    } catch (_) {
      return null;
    }
  }

  ZZ.geocode = { search, searchAddress, reverse };
})(typeof window !== 'undefined' ? window : globalThis);
