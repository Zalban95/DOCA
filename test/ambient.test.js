'use strict';

/** The ambient screen (modules/ambient, public/js/face/galaxy.js): the weather, notices by person, and the galaxy's place. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./helpers');

let stub, asked = [];
test.before(async () => {
  // Open-Meteo's two services, as they answer.
  stub = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    asked.push(u.pathname);
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname === '/geo') return res.end(JSON.stringify(u.searchParams.get('name') === 'Nowhere' ? {} : { results: [{ name: 'Milan', admin1: 'Lombardy', country_code: 'IT', latitude: 45.46, longitude: 9.19 }] }));
    res.end(JSON.stringify({ current: { temperature_2m: 21.4, apparent_temperature: 20.1, weather_code: 3, wind_speed_10m: 8, relative_humidity_2m: 70, is_day: 1 },
      daily: { time: ['2026-10-06', '2026-10-07'], weather_code: [3, 61], temperature_2m_max: [22, 19], temperature_2m_min: [14, 16], precipitation_probability_max: [5, 70] } }));
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  process.env.DOCA_GEOCODE_API = `http://127.0.0.1:${stub.address().port}/geo`;
  process.env.DOCA_WEATHER_API = `http://127.0.0.1:${stub.address().port}/forecast`;
  await H.start();
});
test.after(async () => { await H.stop(); stub.close(); });

test('the weather where the screen says it is: geocoded once, now and the days, kept a while', async () => {
  const r = await H.api(null, 'GET', '/api/ambient?place=Milan');
  assert.equal(r.status, 200);
  assert.equal(r.body.weather.place, 'Milan, Lombardy, IT');
  assert.equal(r.body.weather.now.text, 'overcast');
  assert.equal(r.body.weather.days[1].text, 'light rain');
  assert.equal(r.body.weather.unit, '°C');
  const before = asked.length;
  await H.api(null, 'GET', '/api/ambient?place=Milan');
  assert.equal(asked.length, before, 'kept, not asked again');
  assert.equal((await H.api(null, 'GET', '/api/ambient?place=45.4,9.1&units=imperial')).body.weather.unit, '°F', 'lat,lon needs no geocoding');
  assert.match((await H.api(null, 'GET', '/api/ambient?place=Nowhere')).body.weather.error, /No place called/);
  assert.equal((await H.api(null, 'GET', '/api/ambient')).body.weather, null, 'no place, no weather');
});

test('no calendar connected says how to get one; notices are the viewer\'s own', async () => {
  const r = await H.api(null, 'GET', '/api/ambient');
  assert.match(r.body.calendar.none, /Field → Connectors/);
  assert.ok(Array.isArray(r.body.notices));
  const viewer = await H.signIn('viewer');
  const v = await H.api(null, 'GET', '/api/ambient', undefined, { Cookie: viewer.cookie });
  assert.equal(v.status, 200, 'any signed-in person may rest a screen on it');
  assert.ok(!v.body.notices.some(n => n.kind === 'propose'), 'proposals are an admin\'s');
});

test('the galaxy rests in the bottom fifth, wider than tall, and rises to the middle when called', () => {
  const ctx = { Math, Array, Object, Number };
  vm.createContext(ctx);
  for (const f of ['poly.js', 'galaxy.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/face', f), 'utf8'), ctx);
  const rnd = (() => { let s = 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const n = 600, form = vm.runInContext('faceAmbientForm', ctx)(n, rnd);
  const ax = 1.84, ay = 1.15;   // a 1280×800 screen in face units
  form.frame(1, { ax, ay, rise: 0 });
  const pts = Array.from({ length: n }, (_, i) => form.at(i));
  const ys = pts.map(p => p[1]), xs = pts.map(p => p[0]);
  const bottomFifth = ay * 0.6;   // y in face units below which is the bottom fifth of the screen
  assert.ok(ys.filter(y => y > bottomFifth && y < ay).length > n * 0.9, 'nearly every point in the bottom fifth');
  assert.ok(Math.max(...xs) - Math.min(...xs) > (Math.max(...ys) - Math.min(...ys)) * 4, 'seen from the side: much wider than tall');
  const near = pts.filter(p => Math.abs(p[0]) < 0.2).length;
  assert.ok(near > n * 0.3, 'gathered at the centre');
  form.frame(2, { ax, ay, rise: 1 });
  const up = Array.from({ length: n }, (_, i) => form.at(i)[1]);
  assert.ok(up.every(y => Math.abs(y) < 1), 'called: every point in the middle, as the call\'s form');
});
