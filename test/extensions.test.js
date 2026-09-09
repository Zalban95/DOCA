'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let agent, watch, phone, glasses;

before(async () => {
  await H.start();
  agent   = H.mkDevice('agent', 'agent');
  watch   = H.mkDevice('watch', 'watch', H.WATCH_CAPS);
  phone   = H.mkDevice('phone', 'phone', H.PHONE_CAPS);
  glasses = H.mkDevice('glasses', 'watch', { formFactor: 'glasses', input: { camera: true, voice: true }, audio: { mic: true, speaker: true }, render: ['text'], sensors: ['heading', 'accelerometer'] });
});
after(H.stop);

test('device variables: device writes, agent reads, agent is notified', async () => {
  const a = H.sse(agent.token); await a.ready;
  const r = await H.api(watch.token, 'PATCH', '/api/v1/devices/me/vars', { batteryPct: 61, wristRaised: true, ext: { customThing: [1, 2] } });
  assert.equal(r.status, 200); assert.equal(r.body.version, 1);
  const ev = await a.waitFor('device.vars');
  assert.equal(ev.payload.deviceId, watch.device.id); assert.deepEqual(ev.payload.changed.sort(), ['batteryPct', 'ext', 'wristRaised']);
  const read = await H.api(agent.token, 'GET', `/api/v1/devices/${watch.device.id}/vars`);
  assert.deepEqual(read.body.vars, { batteryPct: 61, wristRaised: true, ext: { customThing: [1, 2] } });
  await H.api(watch.token, 'PATCH', '/api/v1/devices/me/vars', { wristRaised: null });
  assert.deepEqual((await H.api(watch.token, 'GET', '/api/v1/devices/me/vars')).body.vars, { batteryPct: 61, ext: { customThing: [1, 2] } });
  assert.equal((await H.api(watch.token, 'PATCH', `/api/v1/devices/${phone.device.id}/vars`, { x: 1 })).status, 403);
  assert.equal((await H.api(watch.token, 'GET', `/api/v1/devices/${phone.device.id}/vars`)).status, 403);
  assert.equal((await H.api(watch.token, 'PATCH', '/api/v1/devices/me/vars', { big: 'x'.repeat(20000) })).status, 413);
  a.close();
});

test('sensors: agent requests on demand, profile is the consent list, device streams samples back', async () => {
  const w = H.sse(watch.token); const a = H.sse(agent.token);
  await Promise.all([w.ready, a.ready]);
  // Nothing allowed yet → rejected
  let r = await H.api(agent.token, 'POST', '/api/v1/agent/sensors/requests', { deviceId: watch.device.id, sensors: ['heartRate'] });
  assert.equal(r.status, 403); assert.equal(r.body.error.rejected[0].reason, 'not_allowed_by_profile');
  // Phone allows heartRate + accelerometer
  await H.api(phone.token, 'PUT', `/api/v1/devices/${watch.device.id}/profile`, { pages: [], sensors: { allow: ['heartRate', 'accelerometer'], autoReport: ['battery'] } });
  r = await H.api(agent.token, 'POST', '/api/v1/agent/sensors/requests', { deviceId: watch.device.id, reason: 'checking stress before a risky restart', sensors: [{ id: 'heartRate', rateHz: 1, durationSec: 30 }, { id: 'accelerometer', rateHz: 500, durationSec: 5 }, 'location'], ext: { analysis: 'hrv' } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.rejected, [{ id: 'location', reason: 'not_declared' }]);
  assert.equal(r.body.request.sensors.find(s => s.id === 'accelerometer').rateHz, 50, 'clamped to the declared maxRateHz');
  const reqEv = await w.waitFor('sensor.request');
  assert.equal(reqEv.payload.request.id, r.body.request.id);
  assert.deepEqual(reqEv.payload.request.ext, { analysis: 'hrv' });

  const post = await H.api(watch.token, 'POST', '/api/v1/sensors/samples', { requestId: r.body.request.id, samples: [
    { sensor: 'heartRate', ts: new Date().toISOString(), value: 72 },
    { sensor: 'accelerometer', values: [0.01, -0.02, 9.79], accuracy: 3 },
    { sensor: 'battery', value: 61 },              // autoReport → accepted without request
    { sensor: 'heading', value: 12 },              // not declared → rejected
  ] });
  assert.equal(post.status, 200); assert.equal(post.body.accepted, 3);
  assert.deepEqual(post.body.rejected, [{ sensor: 'heading', reason: 'not_declared' }]);
  const samples = await a.waitFor('sensor.samples');
  assert.equal(samples.class, 'ephemeral');
  assert.equal(samples.payload.samples.find(s => s.sensor === 'accelerometer').values[2], 9.79);

  const read = await H.api(agent.token, 'GET', `/api/v1/agent/sensors/requests/${r.body.request.id}`);
  assert.equal(read.body.request.sampleCount, 2, 'battery sample was auto-reported, not part of the request');
  const latest = await H.api(agent.token, 'GET', `/api/v1/devices/${watch.device.id}/sensors`);
  assert.equal(latest.body.latest.battery.value, 61);

  const stop = await H.api(agent.token, 'DELETE', `/api/v1/agent/sensors/requests/${r.body.request.id}`);
  assert.equal(stop.body.request.status, 'stopped');
  await w.waitFor('sensor.stop');
  const late = await H.api(watch.token, 'POST', '/api/v1/sensors/samples', { requestId: r.body.request.id, samples: [{ sensor: 'heartRate', value: 70 }] });
  assert.equal(late.body.accepted, 0); assert.equal(late.body.rejected[0].reason, 'not_requested');
  assert.equal((await H.api(agent.token, 'POST', '/api/v1/agent/sensors/requests', { deviceId: agent.device.id, sensors: ['x'] })).status, 409);
  w.close(); a.close();
});

test('artifacts: delivered only to devices declaring the runtime; content is fetchable by target', async () => {
  const w = H.sse(watch.token); const g = H.sse(glasses.token);
  await Promise.all([w.ready, g.ready]);
  const code = 'export function rmssd(rr){ /* … */ return 42 }';
  const art = await H.api(agent.token, 'POST', '/api/v1/agent/artifacts', { name: 'hrv', runtime: 'js', content: code, entry: 'rmssd', params: { window: 60 }, purpose: 'compute HRV locally from heartRate samples', ttlSec: 3600 });
  assert.equal(art.status, 201); assert.equal(art.body.artifact.runtime, 'js'); assert.equal(art.body.artifact.bytes, Buffer.byteLength(code));
  const del = await H.api(agent.token, 'POST', `/api/v1/agent/artifacts/${art.body.artifact.id}/deliver`, { targets: [watch.device.id, glasses.device.id], inline: true, message: 'run this on new samples' });
  assert.equal(del.status, 202);
  const byId = Object.fromEntries(del.body.report.map(x => [x.deviceId, x]));
  assert.equal(byId[watch.device.id].delivered, true);
  assert.equal(byId[glasses.device.id].delivered, false); assert.equal(byId[glasses.device.id].reason, 'runtime_unsupported');
  const ev = await w.waitFor('artifact.deliver');
  assert.equal(ev.payload.artifact.entry, 'rmssd'); assert.ok(ev.payload.inline.startsWith('export function'));
  assert.equal(ev.payload.artifact.sha256.length, 64);
  const content = await H.api(watch.token, 'GET', `/api/v1/artifacts/${art.body.artifact.id}/content`);
  assert.equal(content.status, 200); assert.equal(content.headers.get('x-doca-runtime'), 'js');
  assert.equal((await H.api(glasses.token, 'GET', `/api/v1/artifacts/${art.body.artifact.id}`)).status, 200, 'untargeted artifact is visible to any artifacts:self device');
  const scoped = await H.api(agent.token, 'POST', '/api/v1/agent/artifacts', { runtime: 'wasm', contentBase64: Buffer.from([0, 0x61, 0x73, 0x6d]).toString('base64'), targets: [phone.device.id] });
  assert.equal((await H.api(watch.token, 'GET', `/api/v1/artifacts/${scoped.body.artifact.id}`)).status, 404, 'targeted artifact hidden from others');
  assert.equal((await H.api(phone.token, 'GET', `/api/v1/artifacts/${scoped.body.artifact.id}/content`)).status, 200);
  assert.equal((await H.api(agent.token, 'POST', '/api/v1/agent/artifacts', { runtime: 'js', content: 'x'.repeat(300000) })).status, 413);
  w.close(); g.close();
});

test('artifact blocks inside prompts degrade to text on devices without the runtime', async () => {
  const art = (await H.api(agent.token, 'POST', '/api/v1/agent/artifacts', { runtime: 'js', content: '1+1' })).body.artifact;
  const p = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', { title: 'run', targets: [watch.device.id, glasses.device.id], body: [{ type: 'artifact', artifactId: art.id, runtime: 'js', alt: 'a tiny calculation' }], choices: [{ type: 'dismiss', label: 'ok' }] });
  const wv = (await H.api(watch.token, 'GET', `/api/v1/prompts/${p.body.prompt.id}`)).body.prompt;
  const gv = (await H.api(glasses.token, 'GET', `/api/v1/prompts/${p.body.prompt.id}`)).body.prompt;
  assert.equal(wv.body[0].type, 'artifact'); assert.equal(wv.body[0].contentUrl, `/api/v1/artifacts/${art.id}/content`);
  assert.equal(gv.body[0].type, 'text'); assert.equal(gv.body[0].text, 'a tiny calculation');
});

test('free-form messages both ways, with ext passthrough', async () => {
  const a = H.sse(agent.token); const w = H.sse(watch.token);
  await Promise.all([a.ready, w.ready]);
  const up = await H.api(watch.token, 'POST', '/api/v1/messages', { type: 'gesture', payload: { name: 'double-tap' }, ext: { confidence: 0.91 } });
  assert.equal(up.status, 202); assert.equal(up.body.delivered[0].deviceId, agent.device.id);
  const ev = await a.waitFor('device.message');
  assert.equal(ev.payload.from, watch.device.id); assert.equal(ev.payload.type, 'gesture'); assert.deepEqual(ev.payload.ext, { confidence: 0.91 });
  const down = await H.api(agent.token, 'POST', '/api/v1/agent/messages', { type: 'hud', payload: { line1: 'Compile 82%' }, targets: [watch.device.id] });
  assert.equal(down.status, 202);
  const ev2 = await w.waitFor('agent.message');
  assert.deepEqual(ev2.payload.payload, { line1: 'Compile 82%' });
  a.close(); w.close();
});

test('media upload: owner and agent can read, others cannot; unsupported types refused', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' }), 'p.jpg');
  fd.append('meta', JSON.stringify({ w: 640, h: 480, source: 'camera', ext: { lens: 'wide' } }));
  const up = await H.api(glasses.token, 'POST', '/api/v1/media', fd);
  assert.equal(up.status, 201); assert.equal(up.body.media.kind, 'image'); assert.deepEqual(up.body.media.meta.ext, { lens: 'wide' });
  assert.equal((await H.api(glasses.token, 'GET', up.body.media.url)).status, 200);
  assert.equal((await H.api(agent.token, 'GET', up.body.media.url + '/info')).body.media.bytes, 7);
  assert.equal((await H.api(watch.token, 'GET', up.body.media.url)).status, 404);
  const bad = new FormData(); bad.append('file', new Blob([Buffer.from('x')], { type: 'application/x-msdownload' }), 'x.exe');
  assert.equal((await H.api(glasses.token, 'POST', '/api/v1/media', bad)).status, 415);
});

test('a display-less device still gets useful capabilities', async () => {
  const caps = (await H.api(glasses.token, 'GET', '/api/v1/capabilities')).body;
  assert.equal(caps.device.caps.formFactor, 'glasses'); assert.equal(caps.device.caps.screen, null);
  assert.deepEqual(caps.render.defaults, { w: 320, h: 160, round: false });
  assert.deepEqual(caps.sensors.declared.map(s => s.id), ['heading', 'accelerometer']);
  assert.deepEqual(caps.artifacts.runtimes, []);
});
