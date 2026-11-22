/* Eigen weericonen (SVG), zodat ze er op elk apparaat hetzelfde uitzien. Kleuren via CSS-variabelen. */
(function (root) {
  const ZZ = (root.ZZ = root.ZZ || {});

  const RAYS =
    'M24 4.5v5M24 38.5v5M4.5 24h5M38.5 24h5M10.2 10.2l3.6 3.6M34.2 34.2l3.6 3.6M10.2 37.8l3.6-3.6M34.2 13.8l3.6-3.6';

  const sun = (cx = 24, cy = 24, s = 1) =>
    `<g transform="translate(${cx - 24 * s} ${cy - 24 * s}) scale(${s})">` +
    `<path d="${RAYS}" stroke="var(--ic-sun)" stroke-width="3.2" stroke-linecap="round" fill="none"/>` +
    '<circle cx="24" cy="24" r="9.5" fill="var(--ic-sun)"/>' +
    '<circle cx="21" cy="21" r="4" fill="var(--ic-sun-hi)" opacity=".55"/>' +
    '</g>';

  // Wolk met vlakke onderkant; (x, y) is linksonder, w de schaal.
  const cloud = (x, y, s, fill) =>
    `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}">` +
    '<circle cx="9" cy="-9" r="8"/><circle cx="19" cy="-14" r="10.5"/><circle cx="28.5" cy="-8" r="7"/>' +
    '<rect x="9" y="-9" width="19.5" height="8"/></g>';

  const drops = (x, y) =>
    `<g stroke="var(--ic-rain)" stroke-width="3" stroke-linecap="round">` +
    `<path d="M${x} ${y}l-2 5M${x + 8} ${y}l-2 5M${x + 16} ${y}l-2 5"/></g>`;

  const svg = (inner, label) =>
    `<svg class="wx" viewBox="0 0 48 48" role="img" aria-label="${label}">${inner}</svg>`;

  const ICONS = {
    zeker: () => svg(sun(), 'zonnig'),
    waarschijnlijk: () => svg(sun(20, 19, 0.82) + cloud(17, 41, 0.78, 'var(--ic-cloud)'), 'overwegend zonnig'),
    wisselend: () => svg(sun(17, 17, 0.7) + cloud(7, 41, 1.06, 'var(--ic-cloud)'), 'half bewolkt'),
    weinig: () =>
      svg(cloud(14, 30, 0.85, 'var(--ic-cloud-back)') + cloud(4, 41, 1.08, 'var(--ic-cloud)'), 'bewolkt'),
    buien: () => svg(sun(17, 15, 0.62) + cloud(8, 34, 1, 'var(--ic-cloud)') + drops(17, 39), 'buien'),
    regen: () =>
      svg(cloud(14, 24, 0.8, 'var(--ic-cloud-back)') + cloud(5, 34, 1.04, 'var(--ic-cloud-dark)') + drops(16, 39), 'regen'),
    nacht: () =>
      svg('<path d="M30 8a16 16 0 1 0 10 28.5A14 14 0 0 1 30 8z" fill="var(--ic-moon)"/>', 'geen daglicht'),
  };

  function weatherIcon(s) {
    if (!s || !s.valid) return ICONS.nacht();
    if (s.rainShare >= 0.5) return s.mean >= 0.2 ? ICONS.buien() : ICONS.regen();
    return ICONS[s.cls]();
  }

  function classIcon(cls) {
    return ICONS[cls]();
  }

  const UI = {
    car:
      '<svg class="ui" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11m-14 0h14m-14 0a2 2 0 0 0-2 2v3.5h2V18a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.5h8V18a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.5h2V13a2 2 0 0 0-2-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7.5" cy="13.8" r="1.2" fill="currentColor"/><circle cx="16.5" cy="13.8" r="1.2" fill="currentColor"/></svg>',
    sunSmall:
      '<svg class="ui" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    chevron:
      '<svg class="ui chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    route:
      '<svg class="ui" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    thermo:
      '<svg class="ui" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="16.5" r="1.6" fill="currentColor"/></svg>',
    drop:
      '<svg class="ui" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  };

  ZZ.icons = { weatherIcon, classIcon, UI };
})(typeof window !== 'undefined' ? window : globalThis);
