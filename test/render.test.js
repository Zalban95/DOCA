'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const render = require('../modules/api-v1/render');
const motion = require('../modules/api-v1/motion');
const sampler = require('../modules/api-v1/sampler');

let agent, watch, phone, glasses;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const ANIMATED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#58a6ff"/><stop offset="1" stop-color="#3fb950"/></linearGradient></defs>
  <circle cx="50" cy="50" r="10" fill="url(#g)"><animate attributeName="r" from="10" to="40" dur="2s" repeatCount="indefinite"/></circle>
  <rect x="45" y="5" width="10" height="20" fill="#f85149"><animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="4s" repeatCount="indefinite"/></rect>
</svg>`;

before(async () => {
  await H.start();
  agent = H.mkDevice('agent', 'agent');
  watch = H.mkDevice('watch', 'watch', H.WATCH_CAPS);
  phone = H.mkDevice('phone', 'phone', H.PHONE_CAPS);
  glasses = H.mkDevice('glasses', 'watch', { formFactor: 'glasses', render: ['text'] });
});
after(H.stop);

test('SMIL subset sampler produces distinct frames and strips animation elements', () => {
  const parents = render.scanAnimations(ANIMATED_SVG);
  assert.equal(parents.length, 2);
  const f0 = render.frameAt(ANIMATED_SVG, parents, 0);
  const f1 = render.frameAt(ANIMATED_SVG, parents, 1000);
  assert.match(f0, /r="10\.000"/); assert.match(f1, /r="25\.000"/);
  assert.match(f1, /transform="rotate\(90\.000 50\.000 50\.000\)"/);
  assert.equal(/<animate/.test(f0), false);
  const sprite = render.spriteSvg(ANIMATED_SVG, { frames: 4, w: 50, h: 50 });
  assert.equal(sprite.frames, 4); assert.equal(sprite.totalMs, 4000);
  assert.match(sprite.svg, /width="200" height="50"/);
  assert.ok(sprite.svg.includes('id="g_f0"') && sprite.svg.includes('url(#g_f3)'), 'ids are namespaced per frame');
});

test('chart endpoint renders a PNG sized for the device and enforces read scope', async () => {
  await sampler.refresh(); await sampler.refresh();
  const r = await H.api(watch.token, 'GET', '/api/v1/render/chart?metrics=system.cpu.pct,system.memory.pct&title=Load&unit=%25&thresholds=%5B%7B%22level%22%3A%22warn%22%2C%22gte%22%3A70%7D%5D');
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.isBuffer(r.body) && r.body.subarray(0, 4).equals(PNG));
  assert.ok(r.body.length < 200 * 1024);
  const narrow = H.mkDevice('narrow', 'viewer'); require('../modules/api-v1/devices').update(narrow.device.id, { scopes: ['read:system.memory'] });
  assert.equal((await H.api(narrow.token, 'GET', '/api/v1/render/chart?metrics=system.cpu.pct')).status, 403);
  const svg = await H.api(phone.token, 'GET', '/api/v1/render/chart?metrics=system.cpu.pct&format=svg');
  assert.equal(svg.headers.get('content-type').split(';')[0], 'image/svg+xml');
  const notSvgCapable = await H.api(watch.token, 'GET', '/api/v1/render/chart?metrics=system.cpu.pct&format=svg');
  assert.equal(notSvgCapable.headers.get('content-type'), 'image/png', 'a client without render.svg gets PNG even if it asks');
});

test('one figure, three fidelities: svg for the phone, sprite for the watch, text for the glasses', async () => {
  const p = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', {
    title: 'VRAM draining', targets: [watch.device.id, phone.device.id, glasses.device.id],
    body: [{ type: 'figure', alt: 'VRAM 22 GB → 0 GB over 4 s', svg: ANIMATED_SVG, sizeHint: { w: 120, h: 120 },
             motion: { tracks: [{ type: 'ring', target: 'gpu.0.vram.pct', from: 0.9, to: 0, durationMs: 4000, easing: 'ease-out', color: 'ok' }, { type: 'bogus' }], caption: 'VRAM ring empties' } }],
    choices: [{ type: 'dismiss', label: 'ok' }],
  });
  assert.equal(p.status, 201);
  const id = p.body.prompt.id;
  const pv = (await H.api(phone.token, 'GET', `/api/v1/prompts/${id}`)).body.prompt.body[0];
  const wv = (await H.api(watch.token, 'GET', `/api/v1/prompts/${id}`)).body.prompt.body[0];
  const gv = (await H.api(glasses.token, 'GET', `/api/v1/prompts/${id}`)).body.prompt.body[0];
  assert.equal(pv.representation.kind, 'svg'); assert.equal(pv.representation.animated, true);
  assert.equal(wv.representation.kind, 'motion', 'watch declared motion.1 → gets the vocabulary before a sprite');
  assert.equal(wv.representation.scene.tracks.length, 1, 'unknown primitive dropped');
  assert.equal(wv.representation.scene.tracks[0].type, 'ring');
  assert.equal(gv.representation.kind, 'text'); assert.equal(gv.representation.text, 'VRAM ring empties');

  // A watch without motion support falls to a sprite sheet rendered server-side.
  require('../modules/api-v1/devices').update(watch.device.id, { caps: { motion: [] } });
  const wv2 = (await H.api(watch.token, 'GET', `/api/v1/prompts/${id}`)).body.prompt.body[0];
  assert.equal(wv2.representation.kind, 'sprite'); assert.equal(wv2.representation.frames, 8); assert.equal(wv2.representation.w, 120);
  const sheet = await H.api(watch.token, 'GET', wv2.representation.url);
  assert.equal(sheet.status, 200); assert.equal(sheet.headers.get('x-doca-frames'), '8'); assert.ok(sheet.body.subarray(0, 4).equals(PNG));
  const poster = await H.api(watch.token, 'GET', `/api/v1/render/figure/${wv2.id}?w=64&h=64`);
  assert.ok(poster.body.subarray(0, 4).equals(PNG));
  require('../modules/api-v1/devices').update(watch.device.id, { caps: { motion: ['1'] } });
});

test('representation picker unit cases', () => {
  const fig = motion.normalizeFigure({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', alt: 'static' });
  assert.equal(motion.pickRepresentation(fig, { render: ['image'] }).kind, 'image');
  assert.equal(motion.pickRepresentation(fig, { render: ['sprite', 'text'] }).kind, 'text', 'sprite only applies to animated svg');
  assert.equal(motion.pickRepresentation(fig, { render: ['svg'] }).kind, 'svg');
  const anim = motion.normalizeFigure({ svg: ANIMATED_SVG, alt: 'anim' });
  assert.equal(motion.pickRepresentation(anim, { render: ['svg'] }).kind, 'text', 'animated svg needs svg.smil');
  assert.equal(motion.pickRepresentation(anim, { render: ['svg', 'svg.smil'] }).kind, 'svg');
  assert.equal(motion.normalizeScene({ tracks: [{ type: 'pulse', target: 'x', count: 99, periodMs: 1 }] }).tracks[0].count, 20);
  assert.equal(motion.normalizeScene({ tracks: [] }), null);
});
