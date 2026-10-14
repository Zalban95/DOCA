'use strict';

/**
 * A watch's console playing a project page (console-pages.js, toolbox/console.js, cast/things.js showPreview; asked
 * 2026-10-14): the agent links the person's own watch to a preview only when asked; the page hears the watch's frames
 * (accel and gyro) and buttons through /__doca/console from its own address; and the same preview goes to a TV through
 * the cast door, which serves that one app to that device alone.
 */
process.env.DOCA_CAST_DOOR_ADDRESS = '127.0.0.1';
process.env.DOCA_CAST_DOOR_PORT = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');
const castStub = require('./fixtures/cast-stub');

let app, viaProxy, dev, preview, watch;
test.before(async () => {
  await H.start();
  app = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<h1>Benchie</h1>${req.url}`); });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  preview = require('../modules/canvas/previews').create({ port: app.address().port, title: 'Benchie' });
  // The canvas origin's preview half, as it answers a browser that entered this preview.
  viaProxy = http.createServer((req, res) => { if (!require('../modules/canvas/proxy').forward(req, res, preview.token)) { res.writeHead(404); res.end(); } });
  await new Promise(r => viaProxy.listen(0, '127.0.0.1', r));
  watch = H.mkDevice('Wrist', 'watch', H.WATCH_CAPS);
  require('../modules/api-v1/devices').update(watch.device.id, { userId: H.owner.user?.id || H.owner.id });
  dev = await castStub.start();
});
test.after(async () => { await require('../modules/cast/door').close(); await dev.close(); app.close(); viaProxy.closeAllConnections?.(); viaProxy.close(); await H.stop(); });

const tool = () => require('../modules/harness/toolbox/console').find(t => t.name === 'device_console');
const ctx = asked => ({ user: { id: H.owner.user?.id || H.owner.id, role: 'owner', name: 'Owner' }, byPerson: asked });

test('linked only when asked; the page hears its watch: accel and gyro frames, a held button and its release', async () => {
  assert.match(await tool().run({ action: 'link', device: 'Wrist', preview: preview.id }, ctx(false)), /^Error: link a console only when the person asked/);
  const said = await tool().run({ action: 'link', device: 'Wrist', preview: preview.id, asked: true }, ctx(true));
  assert.match(said, /plays into "Benchie"/);
  assert.match(said, /__doca\/console\.js/);
  const base = `http://127.0.0.1:${viaProxy.address().port}`;
  assert.match(await (await fetch(`${base}/__doca/console.js`)).text(), /window\.docaConsole/);
  assert.match(await (await fetch(`${base}/play`)).text(), /Benchie<\/h1>\/play/, 'the app behind it, as before');
  const ctrl = new AbortController();
  const r = await fetch(`${base}/__doca/console`, { signal: ctrl.signal });
  const reader = r.body.getReader(), dec = new TextDecoder();
  let got = '';
  const until = async re => { const end = Date.now() + 4000; while (!re.test(got) && Date.now() < end) { const { value, done } = await Promise.race([reader.read(), H.sleep(200).then(() => ({}))]); if (done) break; if (value) got += dec.decode(value); } return re.test(got); };
  assert.ok(await until(/event: hello/));
  const post = body => fetch(`${H.base}/api/v1/console`, { method: 'POST', headers: { Authorization: `Bearer ${watch.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ enabled: true, frames: [{ t: 10, accel: [0.1, 9.8, 0.2], gyro: [0.5, -0.25, 0] }] })).status, 200);
  assert.ok(await until(/event: frame\ndata: \{"t":10,"accel":\[0\.1,9\.8,0\.2\],"gyro":\[0\.5,-0\.25,0\]\}/), got);
  await post({ press: 'A' });
  assert.ok(await until(/event: button\ndata: \{"id":"A","behaviour":"button","down":true\}/), got);
  await post({ release: 'A' });
  assert.ok(await until(/"id":"A","behaviour":"button","down":false/), got);
  ctrl.abort();
  assert.match(await tool().run({ action: 'status' }, ctx(false)), /Wrist .*plays into Benchie/);
});

test('cast show {preview}: the TV is given that one app through the door, with its console; nothing of the panel', async () => {
  const store = require('../modules/nearby/store');
  store.writeSeen([{ id: 's9', name: 'Den TV', kind: 'tv', keys: ['cast:dd'], addresses: ['127.0.0.1'], can: ['cast'], how: { cast: { name: 'stub', ip: '127.0.0.1', port: dev.port } }, sources: ['cast'] }]);
  const tv = store.save({ seenId: 's9', place: 'Home', room: 'Den' });
  require('../modules/cast/routes').save?.({});
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), cast: { ...(loadPrefs().cast || {}), door: 'on' } });
  const r = await H.api(null, 'POST', `/api/cast/things/${tv.id}/show`, { preview: preview.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (let i = 0; i < 50 && !dev.fetched.length; i++) await H.sleep(20);
  const got = dev.fetched.at(-1);
  assert.equal(got.status, 200);
  const origin = new URL(got.url).origin;
  assert.match(await (await fetch(`${origin}/level/1`)).text(), /Benchie<\/h1>\/level\/1/, 'the app, at its own paths');
  assert.match(await (await fetch(`${origin}/__doca/console.js`)).text(), /docaConsole/);
  assert.equal((await fetch(`${origin}/api/prefs`)).status, 200, 'the app\'s own /api, never the panel\'s');
  assert.doesNotMatch(await (await fetch(`${origin}/api/prefs`)).text(), /harness|"theme"/);
});
