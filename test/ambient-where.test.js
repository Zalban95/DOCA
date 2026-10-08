'use strict';

// Where a screen is, for the weather (2026-10-08: a fresh Ambient said "weather isn't available, no place set" to a
// person holding a phone that knew where it was, and the agent's `today` said the same). With no town named the screen
// uses its device's own position and keeps it as its own (public/js/ambient-where.js → `ambient.here`); without one it
// offers to use this device's location or to type a town; the agent's `today` reads the asking screen's place, else its
// device's position, and says which it used (modules/ambient/where.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./helpers');

let stub;
test.before(async () => {
  stub = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname === '/rev') return res.end(JSON.stringify({ city: 'Pesaro', countryCode: 'IT' }));
    if (u.pathname === '/geo') return res.end(JSON.stringify(u.searchParams.get('name') === 'Nowhere' ? {} : { results: [{ name: 'Pesaro', admin1: 'Marche', country_code: 'IT', latitude: 43.91, longitude: 12.91 }] }));
    res.end(JSON.stringify({ current: { temperature_2m: 19.2, apparent_temperature: 18.5, weather_code: 1, wind_speed_10m: 6, relative_humidity_2m: 60, is_day: 1 },
      daily: { time: ['2026-10-08', '2026-10-09'], weather_code: [1, 3], temperature_2m_max: [21, 20], temperature_2m_min: [12, 13], precipitation_probability_max: [0, 10] } }));
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  process.env.DOCA_GEOCODE_API = `http://127.0.0.1:${stub.address().port}/geo`;
  process.env.DOCA_WEATHER_API = `http://127.0.0.1:${stub.address().port}/forecast`;
  process.env.DOCA_REVGEO_API = `http://127.0.0.1:${stub.address().port}/rev`;
  await H.start();
});
test.after(async () => { await H.stop(); stub.close(); });

const today = () => require('../modules/harness/toolbox/day.js').find(t => t.name === 'today');

test('no place anywhere: no weather, and the agent is told how to set this screen\'s', async () => {
  const screen = (await H.api(null, 'GET', '/api/screen')).body.id;
  assert.equal((await H.api(null, 'GET', '/api/ambient')).body.weather, null);
  const out = await today().run({}, { screen });
  assert.match(out, /No place is known for this screen/);
  assert.match(out, /settings_propose \{screen: "this", asked: true, changes: \[\{path: "ambient\.place"/);
  // settings_read finds the screen's place by the word — it used to answer "No settings match" (2026-10-08).
  const read = require('../modules/harness/toolbox/settings.js').find(t => t.name === 'settings_read');
  const user = { id: (await H.api(null, 'GET', '/api/auth/me')).body.user?.id, role: 'owner' };
  assert.match(read.run({ filter: 'place' }, { screen, user }), /This screen's own[\s\S]*ambient\.place = ""/);
});

test('a screen whose device reported its position: the weather is there, for the page and the agent, saying whose', async () => {
  const screen = (await H.api(null, 'GET', '/api/screen')).body.id;
  await H.api(null, 'POST', '/api/screen/settings', { ambient: { here: { lat: 43.91, lon: 12.91, name: 'Pesaro, IT', at: new Date().toISOString() } } });
  const r = (await H.api(null, 'GET', '/api/ambient')).body;
  assert.equal(r.weather.place, 'Pesaro, IT');
  assert.equal(r.where.from, 'device');
  const out = await today().run({}, { screen });
  assert.match(out, /^Weather for Pesaro, IT — this device's own location\. Say which place it is\./);
  // A town named wins over the device's position, and is said as the screen's.
  await H.api(null, 'POST', '/api/screen/settings', { ambient: { place: 'Pesaro', here: { lat: 1, lon: 1 } } });
  assert.match(await today().run({}, { screen }), /^Weather for Pesaro, Marche, IT — this screen's place/);
  await H.api(null, 'POST', '/api/screen/settings', { ambient: null });
});

test('a paired phone\'s reported location sample is its place when it names none', async () => {
  const phone = H.mkDevice('Phone', 'phone', { ...H.PHONE_CAPS, sensors: [{ id: 'location' }] }).device;
  const sensors = require('../modules/api-v1/sensors');
  const got = sensors.ingest(require('../modules/api-v1/devices').get(phone.id), { sensors: { autoReport: ['location'] } },
    { samples: [{ sensor: 'location', values: [43.91, 12.91] }] });
  assert.equal(got.accepted, 1);
  assert.match(await today().run({}, { screen: phone.id }), /^Weather for Pesaro, IT — this device's own location/);
});

/** ambient-where.js in a sandbox, with a geolocation that answers or refuses. */
function page(geo) {
  const saved = [];
  const ctx = { navigator: { geolocation: geo }, Promise, Date, Number, Math, JSON, String, encodeURIComponent,
    escHtml: s => String(s), screenSave: async p => { saved.push(p); return {}; }, apiFetch: async () => ({}), AMB: { s: {} }, _ambLoad: () => {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/ambient-where.js'), 'utf8'), ctx);
  return { ctx, saved, run: src => vm.runInContext(src, ctx) };
}

test('the page uses this device\'s position when no town is named, and keeps it, named, as the screen\'s', async () => {
  const p = page({ getCurrentPosition: ok => ok({ coords: { latitude: 43.9101, longitude: 12.9133 } }) });
  assert.equal(await p.run('ambientWhere({})'), '43.910,12.913');
  assert.equal(await p.run('ambientWhere({ place: "Rome" })'), 'Rome', 'a town named wins');
  const kept = await p.run('ambientRemember({}, { here: true, place: "Pesaro, IT" })');
  assert.equal(p.saved.length, 1);
  assert.deepEqual({ ...p.saved[0].ambient.here, at: undefined }, { lat: 43.91, lon: 12.913, name: 'Pesaro, IT', at: undefined });
  await p.ctx.ambientRemember(kept, { here: true, place: 'Pesaro, IT' });
  assert.equal(p.saved.length, 1, 'the same place is not kept again');
});

test('no position: the weather slot offers this device\'s location or a town, and says why it has none', async () => {
  const p = page({ getCurrentPosition: (_ok, no) => no({ code: 1 }) });
  assert.equal(await p.run('ambientWhere({})'), '');
  const html = p.run('ambientWhereChoices()');
  assert.match(html, /Use this device's location/);
  assert.match(html, /placeholder="Type a town"/);
  assert.match(html, /location is not allowed for this page/);
  const none = page(undefined);
  assert.equal(await none.run('ambientWhere({})'), '');
  assert.match(none.run('ambientWhereChoices()'), /this browser gives no location here/);
});
