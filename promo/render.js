/*
 * Neemt de promovideo op: draait promo/stage.html (met de echte app erin) frame voor frame
 * en stuurt de beelden naar ffmpeg. Weer- en routedata zijn een voorbeeld.
 *
 *   node promo/render.js            → promo/out/video.mp4 (zonder geluid)
 *   python3 promo/music.py          → promo/out/audio.wav
 *   ffmpeg … (zie promo/README.md)  → promo/out/ZonZeker-promo.mp4
 *
 * Optioneel: FRAMES=1-60 voor een stukje, SNAP=12.5,20 voor losse stilstaande beelden.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const TL = JSON.parse(fs.readFileSync(path.join(__dirname, 'timeline.json'), 'utf8'));
const NOW = new Date('2026-11-23T08:30:00+01:00');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

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
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/* ---------- voorbeeldweer: grijs in Nederland, zon in de Ardennen ---------- */

function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function sunFrac(lat, lon, day, model) {
  let f;
  if (lat > 51.1) f = 0.12; // Nederland en Noord-Duitsland: grijs
  else if (day === 0) f = lat < 50.6 ? 0.88 : 0.35;
  else if (day === 1) f = lat < 50.6 || (lon > 7.5 && lat < 51.5) ? 0.86 : 0.2;
  else if (day === 2) f = lat < 50.2 ? 0.82 : 0.25;
  else f = lat < 49.5 ? 0.85 : 0.18;
  const noise = (hash(lat * 31 + lon * 17 + day * 7 + model * 3) - 0.5) * 0.14;
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
      const sun = time.map((t, i) => (solarElevation(lat, lon, t * 1000 - 1800000) > 3 ? Math.round(sunFrac(lat, lon, Math.floor(i / 24), mi) * 3600) : 0));
      hourly['sunshine_duration_' + m] = sun;
      hourly['precipitation_' + m] = time.map((t, i) => (sunFrac(lat, lon, Math.floor(i / 24), mi) < 0.2 && i % 6 === 0 ? 0.3 : 0));
      hourly['temperature_2m_' + m] = time.map((t, i) => {
        const day = Math.floor(i / 24);
        const daytime = Math.max(0, Math.sin((((i % 24) - 8) / 9) * Math.PI));
        const v = -2 + (54 - lat) * 1.6 + daytime * (3 + sunFrac(lat, lon, day, mi) * 3.5) + mi * 0.2;
        return Math.round(v * 10) / 10;
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
  const km = coords.map((c) => haversineKm(coords[0], c) * 1.22);
  return { code: 'Ok', durations: [km.map((k) => (k / 92) * 3600)], distances: [km.map((k) => k * 1000)] };
}

/* ---------- opnemen ---------- */

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 540, height: 960 },
    deviceScaleFactor: 2,
    timezoneId: 'Europe/Amsterdam',
    locale: 'nl-NL',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('paginafout:', e.message));
  await page.clock.setFixedTime(NOW);
  await ctx.route('https://api.open-meteo.com/**', (route) => {
    const body = forecastResponse(route.request().url());
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body.length === 1 ? body[0] : body) });
  });
  await ctx.route('https://geocoding-api.open-meteo.com/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ name: 'Utrecht', admin1: 'Utrecht', country: 'Nederland', latitude: 52.0908, longitude: 5.1222 }] }),
    })
  );
  await ctx.route(/router\.project-osrm\.org|routing\.openstreetmap\.de/, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(osrmResponse(route.request().url())) })
  );
  await ctx.route('https://nominatim.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));

  await page.goto(`${base}/promo/stage.html`);
  await page.evaluate(() => window.stageReady);

  const total = Math.round(TL.duration * TL.fps);
  let [from, to] = [0, total - 1];
  if (process.env.FRAMES) [from, to] = process.env.FRAMES.split('-').map(Number);

  if (process.env.SNAP) {
    const times = process.env.SNAP.split(',').map(Number);
    for (let f = 0; f <= Math.round(Math.max(...times) * TL.fps); f++) {
      const t = f / TL.fps;
      await page.evaluate((t) => window.renderAt(t), t);
      const hit = times.find((x) => Math.round(x * TL.fps) === f);
      if (hit !== undefined) await page.screenshot({ path: path.join(OUT, `snap-${hit}.png`) });
    }
    await browser.close();
    server.close();
    return;
  }

  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(TL.fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path.join(OUT, 'video.mp4'),
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const t0 = Date.now();
  for (let f = 0; f <= to; f++) {
    const t = f / TL.fps;
    await page.evaluate((t) => window.renderAt(t), t);
    if (f < from) continue;
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 60 === 0) console.log(`frame ${f}/${total} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();
  server.close();
  console.log('klaar:', path.join(OUT, 'video.mp4'));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
