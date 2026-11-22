/*
 * End-to-end-test in Chromium met nagebootste weer-, geocoding- en routedata.
 * Draaien: npm run e2e   (vereist Playwright: npm i -D playwright && npx playwright install chromium)
 * Optioneel: SHOTS=map  → schermafbeeldingen in die map.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = process.env.SHOTS || '';
const FIXED_NOW = new Date('2026-11-23T08:30:00+01:00');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ---------- nepdata ---------- */

function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Een herkenbaar weerbeeld: zon in het zuidoosten, grijs in het noorden.
function sunFrac(lat, lon, day, model) {
  let f;
  if (day === 0) f = lat < 50.4 ? 0.88 : lat < 51.5 ? 0.45 : 0.12;
  else if (day === 1) f = lon > 7 ? 0.82 : lat < 50.5 ? 0.6 : 0.2;
  else if (day === 2) f = lon < 4 ? 0.35 : 0.86;
  else f = lat < 48 ? 0.9 : 0.1;
  const noise = (hash(lat * 31 + lon * 17 + day * 7 + model * 3) - 0.5) * 0.22;
  return Math.max(0, Math.min(1, f + noise));
}

function solarElevation(lat, lon, ms) {
  const RAD = Math.PI / 180;
  const d = ms / 86400000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra;
  return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
}

function forecastResponse(url) {
  const q = new URL(url).searchParams;
  const lats = q.get('latitude').split(',').map(Number);
  const lons = q.get('longitude').split(',').map(Number);
  const models = q.get('models').split(',');
  const startMs = Date.UTC(2026, 10, 22, 23, 0); // 23 nov 00:00 Amsterdamse tijd
  const time = [];
  for (let i = 0; i < 24 * 5; i++) time.push(startMs / 1000 + i * 3600);
  return lats.map((lat, li) => {
    const lon = lons[li];
    const hourly = { time };
    models.forEach((m, mi) => {
      hourly['sunshine_duration_' + m] = time.map((t, i) => {
        if (m === 'meteofrance_seamless' && i > 96) return null; // model loopt minder ver vooruit
        const day = Math.floor(i / 24);
        return solarElevation(lat, lon, t * 1000 - 1800000) > 3 ? Math.round(sunFrac(lat, lon, day, mi) * 3600) : 0;
      });
      hourly['precipitation_' + m] = time.map((t, i) => (sunFrac(lat, lon, Math.floor(i / 24), mi) < 0.2 && i % 5 === 0 ? 0.4 : 0));
      // Zuidelijker is warmer; overdag een paar graden hoger dan 's nachts.
      hourly['temperature_2m_' + m] = time.map((t, i) => {
        const hourOfDay = (i + 0) % 24;
        const daytime = Math.max(0, Math.sin(((hourOfDay - 7) / 12) * Math.PI));
        const dayShift = [0, -2.5, 2, -1, 0][Math.floor(i / 24)];
        return Math.round((4 + (54 - lat) * 0.9 + daytime * 4 + dayShift + mi * 0.3) * 10) / 10;
      });
    });
    return { latitude: lat, longitude: lon, hourly };
  });
}

function haversineKm(a, b) {
  const R = Math.PI / 180;
  const s = Math.sin(((b[1] - a[1]) * R) / 2) ** 2 + Math.cos(a[1] * R) * Math.cos(b[1] * R) * Math.sin(((b[0] - a[0]) * R) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

function osrmResponse(url) {
  const coords = new URL(url).pathname.split('/driving/')[1].split(';').map((c) => c.split(',').map(Number));
  const src = coords[0];
  const km = coords.map((c) => haversineKm(src, c) * 1.25);
  return {
    code: 'Ok',
    durations: [km.map((k) => (k / 88) * 3600)],
    distances: [km.map((k) => k * 1000)],
  };
}

/* ---------- test ---------- */

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else {
    failures++;
    console.log('  ✗ ' + msg);
  }
}

async function newPage(browser, opts, { osrm = true, weatherLimit = false } = {}) {
  const ctx = await browser.newContext({ timezoneId: 'Europe/Amsterdam', locale: 'nl-NL', ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.clock.setFixedTime(FIXED_NOW);
  const stats = { forecastCalls: 0, locations: 0 };
  await page.route('https://api.open-meteo.com/**', (route) => {
    stats.forecastCalls++;
    if (weatherLimit) {
      return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: true, reason: 'Minutely API request limit exceeded.' }) });
    }
    const body = forecastResponse(route.request().url());
    stats.locations += body.length;
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body.length === 1 ? body[0] : body) });
  });
  await page.route('https://geocoding-api.open-meteo.com/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ name: 'Utrecht', admin1: 'Utrecht', country: 'Nederland', latitude: 52.0908, longitude: 5.1222 }] }),
    })
  );
  await page.route(/router\.project-osrm\.org|routing\.openstreetmap\.de/, (route) =>
    osrm ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(osrmResponse(route.request().url())) }) : route.abort()
  );
  await page.route('https://nominatim.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
  return { page, ctx, errors, stats };
}

async function shot(page, name, opts = {}) {
  if (!SHOTS) return;
  await page.waitForTimeout(900); // animaties laten uitlopen
  await page.screenshot({ path: path.join(SHOTS, name), ...opts });
}

async function pickUtrecht(page) {
  await page.fill('#start', 'Utr');
  await page.waitForSelector('#start-list li');
  await page.click('#start-list li');
  await page.waitForSelector('#results:not([hidden]) .place', { timeout: 15000 });
}

function parseDriveMin(text) {
  const h = /(\d+) u/.exec(text);
  const m = /(\d+)(?: min)?$/.exec(text.replace(/^\d+ u ?/, ''));
  return (h ? Number(h[1]) * 60 : 0) + (m && m[1] ? Number(m[1]) : 0);
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();

  console.log('Telefoon, licht thema');
  {
    const { page, ctx, errors, stats } = await newPage(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(base);
    check(await page.isVisible('.hello'), 'welkomstscherm zichtbaar zonder startlocatie');
    await shot(page, 'mobiel-start.png');

    await pickUtrecht(page);
    check((await page.inputValue('#start')) === 'Utrecht', 'startlocatie ingevuld');
    check(await page.isVisible('.summary .lead'), 'samenvatting zichtbaar');
    const tabs = await page.$$eval('.tab', (els) => els.map((e) => e.querySelector('.tab-label').textContent));
    check(tabs.length === 5 && tabs[0] === 'Beste dag' && tabs[1] === 'Vandaag', 'tabbladen: ' + tabs.join(', '));

    const times = await page.$$eval('.p-time', (els) => els.map((e) => e.textContent.trim()));
    const maxMin = Math.max(...times.map(parseDriveMin));
    check(times.length > 5 && maxMin <= 180, `${times.length} plekken, langste rit ${maxMin} min (max 180)`);

    const groups = await page.$$eval('.group-head .gh-label', (els) => els.map((e) => e.textContent));
    const order = ['Zeker zon', 'Waarschijnlijk zonnig', 'Af en toe zon', 'Weinig zon'];
    const names = await page.$$eval('.p-name', (els) => els.map((e) => e.firstChild.textContent));
    check(!names.includes('Utrecht'), 'startplaats zelf staat niet in de lijst');
    check(groups.every((g, i) => i === 0 || order.indexOf(g) > order.indexOf(groups[i - 1])), 'groepen van mooi naar minder mooi: ' + groups.join(' → '));

    // binnen een groep: dichtstbij eerst
    const firstGroup = await page.$$eval('.group:first-child .p-time', (els) => els.map((e) => e.textContent.trim()));
    const mins = firstGroup.map(parseDriveMin);
    check(mins.every((m, i) => i === 0 || m >= mins[i - 1]), 'binnen de groep oplopende rijtijd');

    const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check(noHScroll, 'geen horizontale scroll op telefoonbreedte');
    await shot(page, 'mobiel-resultaten.png');

    // details openklappen
    await page.click('.place .place-main');
    await page.waitForSelector('.details');
    const modelRows = await page.$$eval('.details .models li', (els) => els.length);
    check(modelRows >= 3, `details tonen ${modelRows} weermodellen`);
    check(await page.isVisible('.details .hours .hour'), 'uurbalk zichtbaar');
    const href = await page.getAttribute('.details a.d-route', 'href');
    check(/google\.com\/maps\/dir/.test(href), 'routelink naar Google Maps');
    await page.locator('.place.open').scrollIntoViewIfNeeded();
    await shot(page, 'mobiel-details.png');

    // dag kiezen via de dagstrook
    await page.click('.place:not(.open) .strip-day:nth-child(3)');
    const selected = await page.$eval('.tab[aria-selected="true"] .tab-label', (e) => e.textContent);
    check(selected !== 'Beste dag', 'klik op dag in strook opent die dag: ' + selected);

    // vandaag: notitie over aankomst
    await page.click('.tab:nth-child(2)');
    check(/na aankomst/.test(await page.textContent('#day-note')), 'vandaag-tab legt aankomsttijd uit');

    // sorteren op meeste zon
    await page.click('.tab:nth-child(1)');
    await page.click('[data-sort="sun"]');
    const pcts = await page.$$eval('.group:first-child .place', (els) => els.length);
    check(pcts > 0, 'sorteren op zon werkt');

    // filter: alleen kust
    for (const t of ['stad', 'natuur', 'bergen']) await page.click(`.chip[data-type="${t}"]`);
    const metas = await page.$$eval('.p-meta', (els) => els.map((e) => e.textContent));
    check(metas.length > 0 && metas.every((m) => m.startsWith('Kust')), `filter kust: ${metas.length} plekken`);
    for (const t of ['stad', 'natuur', 'bergen']) await page.click(`.chip[data-type="${t}"]`);

    // temperatuur zichtbaar en filter werkt
    const temps = await page.$$eval('.place .p-temp', (els) => els.map((e) => parseInt(e.textContent, 10)));
    check(temps.length > 0, `temperatuur zichtbaar bij ${temps.length} plekken`);
    await page.click('[data-temp="10"]');
    const warm = await page.$$eval('.place .p-temp', (els) => els.map((e) => parseInt(e.textContent, 10)));
    check(warm.length > 0 && warm.every((t) => t >= 10), `≥ 10°: ${warm.length} plekken, allemaal minstens 10°`);
    check(/minstens 10°/.test(await page.textContent('.summary .lead')), 'samenvatting noemt de temperatuur');
    const coldCells = await page.$$eval('.strip-day.cold', (els) => els.length);
    check(coldCells > 0, `te koude dagen gedimd in de dagstrook (${coldCells})`);
    await shot(page, 'mobiel-temperatuur.png');
    await page.click('[data-temp="20"]');
    check(/minstens 20°/.test(await page.textContent('#list')) || /minstens 20°/.test(await page.textContent('.summary')), '≥ 20°: duidelijke melding als niets warm genoeg is');
    await page.click('[data-temp="all"]');
    const back = await page.$$eval('.place .p-temp', (els) => els.length);
    check(back === temps.length, 'alle temperaturen: weer alle plekken');

    // rijtijd verlagen naar 1 uur → minder plekken, met cache
    const before = stats.locations;
    await page.$eval('#hours', (e) => {
      e.value = '1';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('.summary .lead').textContent.includes('1 uur'), null, { timeout: 5000 });
    const times1 = await page.$$eval('.p-time', (els) => els.map((e) => e.textContent.trim()));
    check(Math.max(...times1.map(parseDriveMin)) <= 60, `1 uur: ${times1.length} plekken, allemaal binnen 60 min`);
    check(stats.locations === before, 'weerdata uit cache, geen nieuwe aanvragen');

    // instellingen onthouden
    await page.reload();
    await page.waitForSelector('#results:not([hidden]) .place', { timeout: 15000 });
    check((await page.inputValue('#start')) === 'Utrecht' && (await page.textContent('#hours-out')) === '1 uur', 'instellingen bewaard na herladen');

    check(errors.length === 0, 'geen fouten in de console' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log(`  (weer-aanvragen: ${stats.forecastCalls}, locaties: ${stats.locations})`);
    await ctx.close();
  }

  console.log('Desktop, donker thema, 6 uur rijden');
  {
    const { page, ctx, errors } = await newPage(browser, { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
    await page.goto(base);
    await page.$eval('#hours', (e) => {
      e.value = '6';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pickUtrecht(page);
    const count = await page.$$eval('.place', (els) => els.length);
    check(count > 20, `${count} plekken binnen 6 uur`);
    await page.click('[data-temp="10"]');
    const warm6 = await page.$$eval('.place .p-temp', (els) => els.map((e) => parseInt(e.textContent, 10)));
    check(warm6.length > 0 && warm6.length < count && warm6.every((t) => t >= 10), `≥ 10°: ${warm6.length} van ${count} plekken over, allemaal minstens 10°`);
    await page.click('[data-temp="all"]');
    const sticky = await page.$eval('.side', (e) => getComputedStyle(e).position);
    check(sticky === 'sticky', 'instellingen als vaste zijbalk op desktop');
    await shot(page, 'desktop-donker.png');
    check(errors.length === 0, 'geen fouten in de console' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  console.log('Desktop, licht thema');
  if (SHOTS) {
    const { page, ctx } = await newPage(browser, { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(base);
    await page.$eval('#hours', (e) => {
      e.value = '4';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pickUtrecht(page);
    await shot(page, 'desktop-licht.png');
    await ctx.close();
  }

  console.log('Routeplanner onbereikbaar → schatting');
  {
    const { page, ctx, errors } = await newPage(browser, { viewport: { width: 390, height: 844 } }, { osrm: false });
    await page.goto(base);
    await pickUtrecht(page);
    const kms = await page.$$eval('.p-km', (els) => els.map((e) => e.textContent));
    check(kms.length > 0 && kms.every((k) => k.includes('schatting')), 'rijtijden gemarkeerd als schatting');
    check(errors.length === 0, 'geen fouten in de console' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  console.log('Weerdienst aan zijn limiet');
  {
    const { page, ctx } = await newPage(browser, { viewport: { width: 390, height: 844 } }, { weatherLimit: true });
    await page.goto(base);
    await page.fill('#start', 'Utr');
    await page.waitForSelector('#start-list li');
    await page.click('#start-list li');
    await page.waitForSelector('.error');
    check(/te veel aanvragen/.test(await page.textContent('.error')), 'vriendelijke foutmelding bij limiet');
    check(await page.isVisible('#retry'), 'knop om opnieuw te proberen');
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} controle(s) mislukt` : '\nAlle controles geslaagd');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
