/* ZonZeker: de interface. */
(function () {
  'use strict';
  const ZZ = window.ZZ;
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam';
  const SETTINGS_KEY = 'zz.settings.v1';
  const NEAR_HOME_KM = 12;
  const TEMP_OPTIONS = [10, 15, 20];
  const TYPES = ['stad', 'kust', 'natuur', 'bergen'];
  const TYPE_LABEL = { stad: 'Stad', kust: 'Kust', natuur: 'Natuur', bergen: 'Bergen' };
  const CLASS_BY_ID = Object.fromEntries(ZZ.CLASSES.map((c) => [c.id, c]));

  const $ = (sel) => document.querySelector(sel);
  const el = {
    form: $('#search-form'),
    start: $('#start'),
    list: $('#start-list'),
    locate: $('#locate'),
    hours: $('#hours'),
    hoursOut: $('#hours-out'),
    days: $('#days'),
    go: $('#go'),
    status: $('#status'),
    results: $('#results'),
    summary: $('#summary'),
    tabs: $('#tabs'),
    sort: $('#sort'),
    types: $('#types'),
    temp: $('#temp'),
    dayNote: $('#day-note'),
    items: $('#list'),
  };

  const state = {
    start: null, // { name, detail, lat, lon }
    maxHours: 3,
    days: 4,
    sort: 'drive',
    types: new Set(TYPES),
    minTemp: null, // null = elke temperatuur, anders minimale maximumtemperatuur overdag
    tab: 'overzicht',
    showWeak: {}, // per tab: 'weinig'-groep uitgeklapt
    open: new Set(), // uitgeklapte plekken
    data: null, // laatste berekende resultaten
    run: null, // AbortController van de lopende zoekactie
  };

  /* ---------- opslag ---------- */

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (!s) return;
      if (s.start && typeof s.start.lat === 'number') state.start = s.start;
      if (s.maxHours >= 0.5 && s.maxHours <= 12) state.maxHours = s.maxHours;
      if (s.days === 3 || s.days === 4) state.days = s.days;
      if (s.sort === 'drive' || s.sort === 'sun') state.sort = s.sort;
      if (Array.isArray(s.types) && s.types.length) state.types = new Set(s.types.filter((t) => TYPES.includes(t)));
      if (TEMP_OPTIONS.includes(s.minTemp)) state.minTemp = s.minTemp;
    } catch (_) {
      /* niets bewaard */
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          start: state.start,
          maxHours: state.maxHours,
          days: state.days,
          sort: state.sort,
          types: [...state.types],
          minTemp: state.minTemp,
        })
      );
    } catch (_) {
      /* privévenster of opslag geblokkeerd */
    }
  }

  /* ---------- opmaak ---------- */

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const nf1 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const nf0 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });

  function fmtHours(h) {
    return h === 1 ? '1 uur' : nf1.format(h) + ' uur';
  }

  function fmtDrive(sec) {
    const min = Math.max(1, Math.round(sec / 60));
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h + ' u' + (m ? ' ' + String(m).padStart(2, '0') : '');
  }

  function fmtKm(m) {
    return nf0.format(Math.round(m / 1000)) + ' km';
  }

  const dayLongFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const hourFmt = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

  function dayDate(key) {
    return new Date(key + 'T12:00:00Z');
  }

  const weekdayFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', timeZone: 'UTC' });
  const weekdayShortFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  const dateFmt = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const clean = (s) => s.replace(/\./g, '');

  /** Kort label: Vandaag, Morgen, Di 24. */
  function dayLabel(key, days) {
    const i = days.indexOf(key);
    if (i === 0) return 'Vandaag';
    if (i === 1) return 'Morgen';
    return cap(clean(weekdayShortFmt.format(dayDate(key))));
  }

  /** Voor de tabbladen: { label: 'Dinsdag', sub: '24 nov' }. */
  function dayTab(key, days) {
    const i = days.indexOf(key);
    const label = i === 0 ? 'Vandaag' : i === 1 ? 'Morgen' : cap(weekdayFmt.format(dayDate(key)));
    return { label, sub: clean(dateFmt.format(dayDate(key))) };
  }

  function dayLong(key, days) {
    const i = days.indexOf(key);
    const date = dayLongFmt.format(dayDate(key));
    if (i === 0) return 'vandaag (' + date + ')';
    if (i === 1) return 'morgen (' + date + ')';
    return date;
  }

  const wxIcon = (s) => ZZ.icons.weatherIcon(s);
  const UI = ZZ.icons.UI;

  function pct(f) {
    return Math.round(f * 100) + '%';
  }

  /* ---------- startlocatie ---------- */

  let suggestCtrl = null;
  let suggestions = [];
  let activeSuggestion = -1;

  function setStart(loc, { run } = { run: true }) {
    state.start = loc;
    el.start.value = loc.name;
    closeSuggestions();
    saveSettings();
    if (run) search({ reveal: true });
  }

  function closeSuggestions() {
    el.list.hidden = true;
    el.list.innerHTML = '';
    el.start.setAttribute('aria-expanded', 'false');
    el.start.removeAttribute('aria-activedescendant');
    suggestions = [];
    activeSuggestion = -1;
  }

  function renderSuggestions() {
    if (!suggestions.length) return closeSuggestions();
    el.list.innerHTML = suggestions
      .map(
        (s, i) =>
          `<li role="option" id="sugg-${i}" data-i="${i}" aria-selected="${i === activeSuggestion}">` +
          `<span class="sugg-name">${esc(s.name)}</span>` +
          (s.detail ? `<span class="sugg-detail">${esc(s.detail)}</span>` : '') +
          '</li>'
      )
      .join('');
    el.list.hidden = false;
    el.start.setAttribute('aria-expanded', 'true');
    if (activeSuggestion >= 0) el.start.setAttribute('aria-activedescendant', 'sugg-' + activeSuggestion);
  }

  let suggestTimer = 0;
  el.start.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = el.start.value;
    if (q.trim().length < 2) return closeSuggestions();
    suggestTimer = setTimeout(async () => {
      if (suggestCtrl) suggestCtrl.abort();
      suggestCtrl = new AbortController();
      try {
        suggestions = await ZZ.geocode.search(q, { signal: suggestCtrl.signal });
        activeSuggestion = -1;
        if (document.activeElement === el.start) renderSuggestions();
      } catch (_) {
        /* afgebroken */
      }
    }, 250);
  });

  el.start.addEventListener('keydown', (e) => {
    if (el.list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = suggestions.length;
      activeSuggestion = (activeSuggestion + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderSuggestions();
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      setStart(suggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });

  el.list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    setStart(suggestions[Number(li.dataset.i)]);
  });

  el.start.addEventListener('blur', () => setTimeout(closeSuggestions, 150));

  el.locate.addEventListener('click', () => {
    if (!navigator.geolocation) return showError('Je browser kan je locatie niet doorgeven. Typ een plaatsnaam.');
    el.locate.disabled = true;
    showStatus('Locatie bepalen…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        el.locate.disabled = false;
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const name = (await ZZ.geocode.reverse(lat, lon)) || 'Mijn locatie';
        setStart({ name, detail: 'huidige locatie', lat, lon });
      },
      () => {
        el.locate.disabled = false;
        showError('Je locatie is niet beschikbaar. Geef toestemming of typ een plaatsnaam.');
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
    );
  });

  async function resolveStartFromInput() {
    const q = el.start.value.trim();
    if (!q) return null;
    if (state.start && state.start.name === q) return state.start;
    const found = (await ZZ.geocode.search(q)).concat(await ZZ.geocode.searchAddress(q));
    return found[0] || null;
  }

  /* ---------- instellingen ---------- */

  function syncControls() {
    el.hours.value = String(state.maxHours);
    el.hoursOut.textContent = fmtHours(state.maxHours);
    const pctFill = ((state.maxHours - 0.5) / (12 - 0.5)) * 100;
    el.hours.style.setProperty('--fill', pctFill + '%');
    for (const b of el.days.querySelectorAll('[data-days]')) {
      b.setAttribute('aria-checked', String(Number(b.dataset.days) === state.days));
    }
    for (const b of el.sort.querySelectorAll('[data-sort]')) {
      b.setAttribute('aria-checked', String(b.dataset.sort === state.sort));
    }
    for (const b of el.types.querySelectorAll('[data-type]')) {
      b.setAttribute('aria-pressed', String(state.types.has(b.dataset.type)));
    }
    for (const b of el.temp ? el.temp.querySelectorAll('[data-temp]') : []) {
      const v = b.dataset.temp === 'all' ? null : Number(b.dataset.temp);
      b.setAttribute('aria-checked', String(v === state.minTemp));
    }
  }

  let rerunTimer = 0;
  function rerunSoon() {
    if (!state.data) return;
    clearTimeout(rerunTimer);
    rerunTimer = setTimeout(() => search(), 450);
  }

  el.hours.addEventListener('input', () => {
    state.maxHours = Number(el.hours.value);
    syncControls();
    saveSettings();
    rerunSoon();
  });

  el.days.addEventListener('click', (e) => {
    const b = e.target.closest('[data-days]');
    if (!b) return;
    state.days = Number(b.dataset.days);
    syncControls();
    saveSettings();
    rerunSoon();
  });

  el.sort.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    state.sort = b.dataset.sort;
    syncControls();
    saveSettings();
    renderList();
  });

  el.types.addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    const t = b.dataset.type;
    if (state.types.has(t) && state.types.size === 1) {
      TYPES.forEach((x) => state.types.add(x)); // laatste uitzetten = alles weer aan
    } else if (state.types.has(t)) {
      state.types.delete(t);
    } else {
      state.types.add(t);
    }
    syncControls();
    saveSettings();
    renderView();
  });

  el.temp?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-temp]');
    if (!b) return;
    state.minTemp = b.dataset.temp === 'all' ? null : Number(b.dataset.temp);
    syncControls();
    saveSettings();
    renderView();
  });

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    closeSuggestions();
    if (!state.start || state.start.name !== el.start.value.trim()) {
      showStatus('Startlocatie zoeken…');
      const loc = await resolveStartFromInput();
      if (!loc) return showError('Startlocatie niet gevonden. Probeer een plaatsnaam, bijvoorbeeld “Utrecht”.');
      state.start = loc;
      el.start.value = loc.name;
      saveSettings();
    }
    search({ reveal: true });
  });

  /* ---------- status ---------- */

  const SKELETON =
    '<div class="skeletons" aria-hidden="true">' +
    '<div class="skel"></div>'.repeat(4) +
    '</div>';

  function showStatus(text, progress) {
    el.status.className = 'status';
    const bar =
      progress != null
        ? `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress * 100)}"><span style="width:${Math.max(4, Math.round(progress * 100))}%"></span></div>`
        : '';
    el.status.innerHTML =
      `<div class="card loading"><div class="loading-row"><span class="spinner" aria-hidden="true"></span><span>${esc(text)}</span></div>${bar}</div>` +
      (state.data ? '' : SKELETON);
  }

  function showError(text) {
    el.status.className = 'status';
    el.status.innerHTML =
      `<div class="card error"><p>${esc(text)}</p>` +
      (state.start ? '<button type="button" class="btn btn-soft" id="retry">Opnieuw proberen</button>' : '') +
      '</div>';
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => search());
  }

  function clearStatus() {
    el.status.className = 'status';
    el.status.innerHTML = '';
  }

  /* ---------- zoeken ---------- */

  async function search({ reveal = false } = {}) {
    if (!state.start) {
      el.start.focus();
      return showError('Kies eerst waar je vertrekt.');
    }
    if (state.run) state.run.abort();
    const ctrl = new AbortController();
    state.run = ctrl;
    const start = state.start;
    const maxSec = state.maxHours * 3600;
    const now = Date.now();
    const days = ZZ.upcomingDays(now, state.days, TZ);

    // Hemelsbreed kan je in een uur hooguit ~100 km opschieten; ruimer filteren we later op echte rijtijd.
    // Plekken vlak bij huis laten we weg: daarvoor is de "Thuis"-regel.
    const radiusKm = state.maxHours * 100;
    const candidates = ZZ.PLACES.filter((p) => {
      const km = ZZ.haversineKm(start.lat, start.lon, p.lat, p.lon);
      return km >= NEAR_HOME_KM && km <= radiusKm;
    });
    const home = { id: '__home', name: start.name, lat: start.lat, lon: start.lon };

    el.go.disabled = true;
    showStatus(`Zonverwachting ophalen voor ${candidates.length} plekken…`, 0);
    try {
      const [forecasts, drives] = await Promise.all([
        ZZ.weather.getForecasts(candidates.concat(home), {
          timeZone: TZ,
          signal: ctrl.signal,
          onProgress: (done, total) => {
            if (state.run === ctrl) showStatus(`Zonverwachting ophalen… ${Math.min(done, total)} van ${total} plekken`, done / total);
          },
        }),
        ZZ.routing.getDriveTimes(start, candidates, { signal: ctrl.signal }),
      ]);
      if (state.run !== ctrl) return;

      const places = [];
      for (const p of candidates) {
        const drive = drives.get(p.id);
        const wx = forecasts.get(p.id);
        if (!drive || !wx || drive.sec > maxSec) continue;
        const summaries = ZZ.summarizeDays(wx, {
          lat: p.lat,
          lon: p.lon,
          timeZone: TZ,
          days,
          earliestMs: 0,
        });
        // Vandaag: alleen de uren na aankomst tellen.
        const today = ZZ.summarizeDays(wx, {
          lat: p.lat,
          lon: p.lon,
          timeZone: TZ,
          days: [days[0]],
          earliestMs: now + drive.sec * 1000,
        });
        summaries[days[0]] = today[days[0]];
        places.push({ place: p, drive, summaries });
      }

      const homeWx = forecasts.get('__home');
      const homeSummaries = homeWx
        ? Object.assign(
            ZZ.summarizeDays(homeWx, { lat: start.lat, lon: start.lon, timeZone: TZ, days }),
            ZZ.summarizeDays(homeWx, { lat: start.lat, lon: start.lon, timeZone: TZ, days: [days[0]], earliestMs: now })
          )
        : null;

      const estimated = places.some((x) => x.drive.estimated);
      state.data = { start, days, places, homeSummaries, maxHours: state.maxHours, estimated, at: now };
      if (state.tab !== 'overzicht' && !days.includes(state.tab)) state.tab = 'overzicht';
      clearStatus();
      renderAll();
      if (reveal && window.matchMedia('(max-width: 959px)').matches) {
        el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (e) {
      if (e.name === 'AbortError' || state.run !== ctrl) return;
      console.error(e);
      showError(e.message || 'Er ging iets mis bij het ophalen van het weer.');
    } finally {
      if (state.run === ctrl) {
        el.go.disabled = false;
        state.run = null;
      }
    }
  }

  /* ---------- resultaten ---------- */

  function renderAll() {
    el.results.hidden = false;
    renderSummary();
    renderList();
  }

  function visiblePlaces() {
    return state.data.places.filter((x) => state.types.has(x.place.type));
  }

  /** Voldoet een dag aan het temperatuurfilter? */
  function warmEnough(s, min = state.minTemp) {
    return min == null || (s && s.tmax != null && s.tmax >= min);
  }

  /** Zonnigste dag van een plek die ook warm genoeg is. */
  function bestKeyFor(x, min = state.minTemp) {
    let best = null;
    for (const k of state.data.days) {
      const s = x.summaries[k];
      if (!s || !s.valid || !warmEnough(s, min)) continue;
      if (!best || s.score > x.summaries[best].score) best = k;
    }
    return best;
  }

  function dayKeyFor(x, tab, min = state.minTemp) {
    return tab === 'overzicht' ? bestKeyFor(x, min) : tab;
  }

  function summaryFor(x, tab, min = state.minTemp) {
    const k = dayKeyFor(x, tab, min);
    return k ? x.summaries[k] : null;
  }

  /** Plekken die nu in de lijst passen (soort, daglicht en temperatuur). */
  function shownFor(tab, min = state.minTemp) {
    return visiblePlaces().filter((x) => {
      const s = summaryFor(x, tab, min);
      return s && s.valid && warmEnough(s, min);
    });
  }

  /** Warmste bereikbare plek (op deze dag, of in het overzicht op welke dag dan ook). */
  function warmest(tab) {
    let top = null;
    const days = tab === 'overzicht' ? state.data.days : [tab];
    for (const x of visiblePlaces()) {
      for (const k of days) {
        const s = x.summaries[k];
        if (!s || !s.valid || s.tmax == null) continue;
        if (!top || s.tmax > top.t) top = { x, k, t: s.tmax };
      }
    }
    return top;
  }

  function warmestText(tab) {
    const w = warmest(tab);
    if (!w) return '';
    const when = tab === 'overzicht' ? ` op ${dayLong(w.k, state.data.days)}` : '';
    return `Het warmst wordt het in <strong>${esc(w.x.place.name)}</strong>: ${fmtTemp(w.t)}${when}, ${fmtDrive(w.x.drive.sec)} rijden.`;
  }

  /** Aantal plekken per temperatuurkeuze op de filterknoppen. */
  function renderTempCounts() {
    if (!el.temp) return;
    for (const b of el.temp.querySelectorAll('[data-temp]')) {
      const min = b.dataset.temp === 'all' ? null : Number(b.dataset.temp);
      const n = shownFor(state.tab, min).length;
      const label = min == null ? 'Alle<span class="opt-long"> temp.</span>' : `≥ ${min}°`;
      b.innerHTML = `${label}<span class="opt-count${n ? '' : ' zero'}">${n}</span>`;
      b.title = `${n} ${n === 1 ? 'plek' : 'plekken'}`;
    }
  }

  function renderView() {
    if (!state.data) return;
    renderSummary();
    renderList();
  }

  function fmtTemp(t) {
    return nf0.format(Math.round(t)) + '°';
  }

  function homeHtml() {
    const { homeSummaries, days, start } = state.data;
    if (!homeSummaries) return '';
    return (
      '<div class="home">' +
      `<span class="home-label">Thuis in ${esc(start.name)}</span>` +
      '<div class="home-days">' +
      days
        .map((k) => {
          const s = homeSummaries[k];
          const val = s && s.valid ? pct(s.mean) : '–';
          const temp = s && s.valid && s.tmax != null ? `<span class="hd-temp">${fmtTemp(s.tmax)}</span>` : '';
          return (
            `<span class="home-day" title="${esc(dayLong(k, days))}">` +
            `<span class="hd-label">${esc(dayLabel(k, days))}</span>${wxIcon(s)}<span class="hd-val">${val}</span>${temp}</span>`
          );
        })
        .join('') +
      '</div></div>'
    );
  }

  function renderSummary() {
    const { days, maxHours, start } = state.data;
    const places = shownFor('overzicht');
    const warm = state.minTemp != null ? ` en minstens ${state.minTemp}°` : '';
    const within = `binnen ${fmtHours(maxHours)} rijden van ${esc(start.name)}`;
    let lead;
    let sub = '';
    let hero = ZZ.icons.classIcon('weinig');
    if (!places.length) {
      lead = state.minTemp != null ? `Geen plekken van minstens ${state.minTemp}° ${within}.` : `Geen bestemmingen gevonden ${within}.`;
      sub = state.minTemp != null ? warmestText('overzicht') || 'Kies een lagere temperatuur of een langere rijtijd.' : 'Schuif de rijtijd wat verder op.';
    } else {
      const best = new Map(places.map((x) => [x, bestKeyFor(x)]));
      const byClass = (cls) => places.filter((x) => x.summaries[best.get(x)].cls === cls);
      const sure = byClass('zeker');
      const likely = byClass('waarschijnlijk');
      const nearest = (arr) => arr.slice().sort((a, b) => a.drive.sec - b.drive.sec)[0];
      if (sure.length) {
        const n = nearest(sure);
        hero = ZZ.icons.classIcon('zeker');
        lead = `<strong>${sure.length} ${sure.length === 1 ? 'plek' : 'plekken'} met zekere zon${warm}</strong> ${within}`;
        sub = `Dichtstbij: <strong>${esc(n.place.name)}</strong>, ${fmtDrive(n.drive.sec)} rijden, ${dayLong(best.get(n), days)}.`;
      } else if (likely.length) {
        const n = nearest(likely);
        hero = ZZ.icons.classIcon('waarschijnlijk');
        lead = `Geen zekere zon${warm} ${within}, maar <strong>waarschijnlijk zonnig op ${likely.length} ${likely.length === 1 ? 'plek' : 'plekken'}</strong>`;
        sub = `Dichtstbij: <strong>${esc(n.place.name)}</strong>, ${fmtDrive(n.drive.sec)} rijden, ${dayLong(best.get(n), days)}.`;
      } else {
        lead = `De komende ${days.length} dagen is er ${within} weinig zon te vinden${warm ? ' bij die temperatuur' : ''}`;
        sub = 'Probeer een langere rijtijd.';
      }
    }
    el.summary.innerHTML =
      `<div class="summary-top"><div class="summary-icon">${hero}</div>` +
      `<div><p class="lead">${lead}</p>${sub ? `<p class="sub">${sub}</p>` : ''}</div></div>` +
      homeHtml();
  }

  function renderTabs() {
    const { days } = state.data;
    const sureCount = (tab) => shownFor(tab).filter((x) => summaryFor(x, tab).cls === 'zeker').length;
    const tabs = [{ id: 'overzicht', label: 'Beste dag', sub: `${days.length} dagen`, count: sureCount('overzicht') }];
    for (const k of days) tabs.push({ id: k, ...dayTab(k, days), count: sureCount(k) });
    el.tabs.innerHTML = tabs
      .map(
        (t) =>
          `<button type="button" role="tab" class="tab" data-tab="${t.id}" aria-selected="${t.id === state.tab}">` +
          `<span class="tab-label">${esc(t.label)}</span>` +
          (t.sub ? `<span class="tab-sub">${esc(t.sub)}</span>` : '') +
          `<span class="tab-count${t.count ? '' : ' zero'}" title="${t.count} ${t.count === 1 ? 'plek' : 'plekken'} met zekere zon">${UI.sunSmall}${t.count} zeker</span>` +
          '</button>'
      )
      .join('');
  }

  el.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    renderList();
  });

  function sortItems(items, tab) {
    const s = (x) => summaryFor(x, tab);
    return items.sort((a, b) => {
      if (state.sort === 'sun') return s(b).score - s(a).score || a.drive.sec - b.drive.sec;
      return a.drive.sec - b.drive.sec || s(b).score - s(a).score;
    });
  }

  function renderList() {
    if (!state.data) return;
    // Alleen animeren bij een nieuwe lijst, niet bij het openklappen van één plek.
    const animate = !el.items.classList.contains('no-anim');
    el.items.classList.remove('no-anim');
    el.items.classList.toggle('animate', animate);
    const { days } = state.data;
    const tab = state.tab;
    const vis = visiblePlaces();
    renderTabs();
    renderTempCounts();

    const valid = shownFor(tab);
    const tooLate = tab === days[0] ? vis.filter((x) => !(x.summaries[tab] && x.summaries[tab].valid)).length : 0;
    const allLate = tooLate > 0 && tooLate === vis.length;

    if (tab === days[0]) {
      el.dayNote.hidden = false;
      el.dayNote.textContent =
        'Voor vandaag tellen alleen de uren na aankomst als je nu vertrekt.' +
        (tooLate ? ` ${tooLate} ${tooLate === 1 ? 'plek haal' : 'plekken haal'} je niet meer bij daglicht.` : '');
    } else if (tab === 'overzicht') {
      el.dayNote.hidden = false;
      el.dayNote.textContent = `Per plek de zonnigste van de komende ${days.length} dagen. Tik op een dag om die dag te bekijken.`;
    } else {
      el.dayNote.hidden = true;
    }

    if (!valid.length) {
      let msg;
      if (allLate) {
        msg = '<p>Vandaag kom je nergens meer aan voordat het donker wordt. Kijk bij de volgende dagen.</p>';
      } else if (state.minTemp != null) {
        const period = tab === 'overzicht' ? `de komende ${days.length} dagen` : dayLong(tab, days);
        msg =
          `<p>Binnen ${fmtHours(state.data.maxHours)} rijden wordt het ${period} nergens ${state.minTemp}° of warmer.</p>` +
          (warmestText(tab) ? `<p class="sub">${warmestText(tab)}</p>` : '') +
          '<button type="button" class="btn btn-soft" data-temp-reset>Toon alle temperaturen</button>';
      } else {
        msg = '<p>Geen bestemmingen om te tonen. Zet meer soorten aan of kies een langere rijtijd.</p>';
      }
      el.items.innerHTML = `<div class="empty card">${msg}</div>`;
      return;
    }

    const groups = ZZ.CLASS_ORDER.map((cls) => ({
      cls,
      items: sortItems(valid.filter((x) => summaryFor(x, tab).cls === cls), tab),
    })).filter((g) => g.items.length);
    const anyGood = groups.some((g) => g.cls === 'zeker' || g.cls === 'waarschijnlijk');

    let n = 0;
    el.items.innerHTML = groups
      .map((g) => {
        const c = CLASS_BY_ID[g.cls];
        const collapsible = g.cls === 'weinig' || (g.cls === 'wisselend' && anyGood && g.items.length > 8);
        const key = tab + ':' + g.cls;
        const expanded = !collapsible || !!state.showWeak[key];
        const head =
          `<h2 class="group-head cls-${g.cls}"><span class="gh-icon">${ZZ.icons.classIcon(g.cls)}</span>` +
          `<span class="gh-label">${c.label}</span><span class="gh-count">${g.items.length}</span></h2>`;
        const body = expanded
          ? `<div class="group-items">${g.items.map((x) => placeHtml(x, tab, n++)).join('')}</div>`
          : '';
        const toggle = collapsible
          ? `<button type="button" class="btn btn-soft group-toggle" data-group="${key}">${
              expanded ? 'Verberg' : 'Toon'
            } ${g.items.length} ${g.items.length === 1 ? 'plek' : 'plekken'} met ${c.label.toLowerCase()}</button>`
          : '';
        return `<section class="group">${head}${body}${toggle}</section>`;
      })
      .join('');
  }

  function stripHtml(x, days, highlight) {
    return (
      '<div class="strip">' +
      days
        .map((k) => {
          const s = x.summaries[k];
          const ok = s && s.valid;
          const cold = ok && !warmEnough(s);
          const temp = ok && s.tmax != null ? fmtTemp(s.tmax) : '';
          const title = ok
            ? `${pct(s.mean)} zon${temp ? ', max ' + temp : ''}${cold ? ', kouder dan ' + state.minTemp + '°' : ''}`
            : 'niet bij daglicht te halen';
          return (
            `<button type="button" class="strip-day${k === highlight ? ' best' : ''}${ok ? ' cls-' + s.cls : ' na'}${cold ? ' cold' : ''}" data-goto="${k}" ` +
            `title="${esc(dayLong(k, days))}: ${title}">` +
            `<span class="sd-label">${esc(dayLabel(k, days))}</span>` +
            `<span class="sd-icon">${wxIcon(s)}</span>` +
            `<span class="sd-val">${ok ? pct(s.mean) : '–'}</span>` +
            `<span class="sd-temp">${temp || '&nbsp;'}</span>` +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function detailsHtml(x, s, dayKey) {
    const { start, days } = state.data;
    const agreeing = s.models.filter((m) => m.frac >= 0.5).length;
    const models = s.models
      .map(
        (m) =>
          `<li><span class="m-name">${esc(ZZ.weather.modelLabel(m.id))}</span>` +
          `<span class="m-bar"><span style="width:${Math.round(m.frac * 100)}%"></span></span>` +
          `<span class="m-val">${pct(m.frac)}</span></li>`
      )
      .join('');
    const hours = s.hours
      .map(
        (h) =>
          `<span class="hour" style="--sun:${h.frac == null ? 0 : h.frac.toFixed(2)}" title="${hourFmt.format(new Date((h.t - 3600) * 1000))}: ${
            h.frac == null ? 'onbekend' : pct(h.frac) + ' zon'
          }"></span>`
      )
      .join('');
    const firstH = s.hours.length ? hourFmt.format(new Date((s.hours[0].t - 3600) * 1000)) : '';
    const lastH = s.hours.length ? hourFmt.format(new Date(s.hours[s.hours.length - 1].t * 1000)) : '';
    const rainy = Math.round(s.rainShare * s.models.length);
    const rain =
      rainy === 0
        ? 'Droog volgens alle modellen'
        : `${rainy} van ${s.models.length} modellen verwachten wat regen (gem. ${nf1.format(s.rainMm)} mm)`;
    const route =
      'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      `&origin=${start.lat.toFixed(5)},${start.lon.toFixed(5)}&destination=${x.place.lat.toFixed(5)},${x.place.lon.toFixed(5)}`;
    const title = dayLong(dayKey, days).replace(/^./, (c) => c.toUpperCase());
    return (
      '<div class="details">' +
      `<div class="d-head"><span class="d-day">${esc(title)}${s.partial ? ' · vanaf aankomst' : ''}</span>` +
      `<span class="d-agree"><strong>${agreeing}/${s.models.length}</strong> modellen zien veel zon</span></div>` +
      `<ul class="models">${models}</ul>` +
      `<div class="hours-wrap"><div class="hours" aria-label="Zon per uur">${hours}</div>` +
      `<div class="hours-scale"><span>${firstH}</span><span>zon per uur</span><span>${lastH}</span></div></div>` +
      '<div class="d-facts">' +
      `<span class="fact">${UI.drop}${rain}</span>` +
      (s.tmax != null ? `<span class="fact">${UI.thermo}max ${nf0.format(s.tmax)}°C</span>` : '') +
      '</div>' +
      `<a class="btn btn-soft d-route" href="${route}" target="_blank" rel="noopener">${UI.route}Route plannen</a>` +
      '</div>'
    );
  }

  function tempClass(t) {
    return t >= 20 ? ' t-warm' : t >= 15 ? ' t-mild' : t >= 10 ? ' t-fris' : ' t-koud';
  }

  function placeHtml(x, tab, index) {
    const { days } = state.data;
    const dayKey = dayKeyFor(x, tab);
    const s = x.summaries[dayKey];
    const p = x.place;
    const open = state.open.has(p.id);
    const when = tab === 'overzicht' ? `<span class="best-day">${esc(dayLabel(dayKey, days))}</span>` : '';
    return (
      `<article class="place cls-${s.cls}${open ? ' open' : ''}" data-id="${p.id}" style="--i:${Math.min(index, 12)}">` +
      `<button type="button" class="place-main" aria-expanded="${open}">` +
      `<span class="p-icon">${wxIcon(s)}</span>` +
      '<span class="p-info">' +
      `<span class="p-name">${esc(p.name)}<span class="cc">${p.cc}</span></span>` +
      `<span class="p-meta">${TYPE_LABEL[p.type]} · ${esc(p.region)}</span>` +
      `<span class="p-sun">${when}<span class="p-sunh">${nf1.format(s.sunH)} u zon</span><span class="p-pct">${pct(s.mean)}</span>` +
      (s.tmax != null ? `<span class="p-temp${tempClass(s.tmax)}">${UI.thermo}${fmtTemp(s.tmax)}</span>` : '') +
      `<span class="meter" aria-hidden="true"><span style="width:${Math.round(s.mean * 100)}%"></span></span></span>` +
      '</span>' +
      '<span class="p-drive">' +
      `<span class="p-time">${UI.car}${fmtDrive(x.drive.sec)}</span>` +
      `<span class="p-km">${fmtKm(x.drive.m)}${x.drive.estimated ? ' · schatting' : ''}</span>` +
      UI.chevron +
      '</span>' +
      '</button>' +
      (tab === 'overzicht' ? stripHtml(x, days, dayKey) : '') +
      (open ? detailsHtml(x, s, dayKey) : '') +
      '</article>'
    );
  }

  el.items.addEventListener('click', (e) => {
    if (e.target.closest('[data-temp-reset]')) {
      state.minTemp = null;
      syncControls();
      saveSettings();
      renderView();
      return;
    }
    const goto = e.target.closest('[data-goto]');
    if (goto) {
      state.tab = goto.dataset.goto;
      renderList();
      el.tabs.querySelector(`[data-tab="${state.tab}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      el.results.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const toggle = e.target.closest('[data-group]');
    if (toggle) {
      const k = toggle.dataset.group;
      state.showWeak[k] = !state.showWeak[k];
      renderList();
      return;
    }
    const main = e.target.closest('.place-main');
    if (main) {
      const id = main.closest('.place').dataset.id;
      if (state.open.has(id)) state.open.delete(id);
      else state.open.add(id);
      el.items.classList.add('no-anim');
      renderList();
      const again = el.items.querySelector(`.place[data-id="${id}"] .place-main`);
      if (again) again.focus({ preventScroll: true });
    }
  });

  /* ---------- start ---------- */

  loadSettings();
  syncControls();
  if (state.start) {
    el.start.value = state.start.name;
    search();
  } else {
    el.status.innerHTML =
      '<div class="card hello">' +
      `<div class="hello-icon">${ZZ.icons.classIcon('waarschijnlijk')}</div>` +
      '<h2>Op zoek naar de zon?</h2>' +
      '<p>Vul in waar je vertrekt en hoe lang je wilt rijden. ZonZeker vergelijkt vier weermodellen en laat je zien waar de zon de komende dagen het zekerst schijnt, en hoe ver dat rijden is.</p>' +
      '<ol class="hello-steps"><li>Kies je vertrekplaats</li><li>Stel je maximale rijtijd in</li><li>Kies de dag en de plek die je bevalt</li></ol>' +
      '</div>';
  }
})();
