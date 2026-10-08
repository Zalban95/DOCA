'use strict';

/**
 * What the Voice card and the typed settings are told (asked 2026-10-08): which voice services run and which voices use
 * each (GET /api/services/voices, modules/voice-services.js), and what an address, a model or a place could be
 * (GET /api/services/choices, modules/service-choices.js; GET /api/ambient/places). Read only, an admin's for the
 * machine's services, and never a way to make the hub fetch the open web.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder

const serve = handler => http.createServer(handler);
const kokoro = serve((req, res) => res.end(JSON.stringify(req.url === '/v1/models' ? { data: [{ id: 'kokoro' }, { id: 'tts-1' }] } : { voices: ['af_heart'] })));
const qwen = serve((req, res) => res.end(JSON.stringify({ voices: ['ryan'] })));
const geo = serve((req, res) => res.end(JSON.stringify({ results: new URL(req.url, 'http://x').searchParams.get('name') === 'Turin'
  ? [{ name: 'Turin', admin1: 'Piedmont', country_code: 'IT', latitude: 45.07, longitude: 7.68 }] : [] })));
const saved = {};

before(async () => {
  await Promise.all([kokoro, qwen, geo].map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
  process.env.DOCA_GEOCODE_API = `http://127.0.0.1:${geo.address().port}/v1/search`;
  for (const r of require('../modules/services').INFERENCE_SERVICES) {
    if (!['whisper', 'kokoro', 'qwentts'].includes(r.id)) continue;
    saved[r.id] = r.port;   // never the machine's own services: a stub, or a closed port
    r.port = r.id === 'kokoro' ? kokoro.address().port : r.id === 'qwentts' ? qwen.address().port : 1;
  }
  await H.start();
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), voiceServices: { ttsUrl: `http://127.0.0.1:${kokoro.address().port}`, sttUrl: 'http://127.0.0.1:1' } });
});
after(async () => {
  for (const r of require('../modules/services').INFERENCE_SERVICES) if (saved[r.id]) r.port = saved[r.id];
  await H.stop();
  await Promise.all([kokoro, qwen, geo].map(s => new Promise(r => s.close(r))));
});

const prefs = patch => { const u = require('../modules/utils'); u.savePrefs({ ...u.loadPrefs(), ...patch }); };

test('each voice service: whether it runs, what starting it needs, and which voices use it', async () => {
  const r = await H.api(null, 'GET', '/api/services/voices');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.services.map(s => [s.id, s]));
  assert.deepEqual(Object.keys(by).sort(), ['kokoro', 'qwentts', 'whisper'], 'the rows that speak or hear');
  assert.deepEqual([by.kokoro.running, by.qwentts.running, by.whisper.running], [true, true, false]);
  assert.deepEqual(by.kokoro.usedBy, ['the hive’s speech service']);
  assert.match(by.qwentts.needs, /^Needs an NVIDIA GPU with about 7 GB free/, 'the row\'s own words');
  assert.equal(by.qwentts.engine, true, 'a voice can be set to it');
  assert.deepEqual(r.body.unused, ['qwentts'], 'running, and no voice uses it');
  assert.equal(r.body.hive.row, 'kokoro');

  // A call's voice on the hive, and this screen's own voice, each count.
  prefs({ voice: { deep: { service: 'qwentts' } } });
  let again = (await H.api(null, 'GET', '/api/services/voices')).body;
  assert.deepEqual(again.services.find(s => s.id === 'qwentts').usedBy, ['the hive’s Deep call']);
  assert.deepEqual(again.unused, []);
  prefs({ voice: undefined });
  await H.api(null, 'GET', '/api/screen');
  await H.api(null, 'POST', '/api/screen/settings', { voice: { engine: 'qwentts', ambient: { service: 'hive' } } });
  again = (await H.api(null, 'GET', '/api/services/voices')).body;
  assert.deepEqual(again.services.find(s => s.id === 'qwentts').usedBy, ['this screen’s voice']);
  assert.deepEqual(again.services.find(s => s.id === 'kokoro').usedBy, ['the hive’s speech service', 'this screen’s Ambient’s assistant']);
  await H.api(null, 'POST', '/api/screen/settings', { voice: null });
});

test('the addresses and models to pick from, each saying where it is', async () => {
  const urls = (await H.api(null, 'GET', '/api/services/choices?what=tts-url')).body;
  const k = urls.items.find(i => i.value === `http://127.0.0.1:${kokoro.address().port}`);
  assert.deepEqual([k.label, k.where], ['Kokoro TTS', 'served here']);
  assert.equal(urls.items.find(i => i.label?.startsWith('Qwen3-TTS')).where, 'served here');
  const stt = (await H.api(null, 'GET', '/api/services/choices?what=stt-url')).body;
  assert.deepEqual(stt.items.map(i => [i.label, i.where]), [['Whisper STT', 'not running here']], 'the address set now is that row\'s: listed once');

  const models = (await H.api(null, 'GET', `/api/services/choices?what=tts-model&url=${encodeURIComponent(`http://127.0.0.1:${qwen.address().port}`)}`)).body;
  assert.ok(models.items.some(i => i.value === 'qwen3-tts'), 'a speech row\'s own model name, when the service lists none');
  const listed = (await H.api(null, 'GET', '/api/services/choices?what=tts-model')).body;
  assert.deepEqual(listed.items.map(i => i.value), ['kokoro', 'tts-1'], 'what the service set now lists');
  const away = await H.api(null, 'GET', `/api/services/choices?what=tts-model&url=${encodeURIComponent('https://example.com')}`);
  assert.equal(away.status, 400, 'an address that is not the owner\'s own is never asked');
  assert.equal((await H.api(null, 'GET', '/api/services/choices?what=nothing')).status, 400);
  const providers = (await H.api(null, 'GET', '/api/services/choices?what=provider-url&provider=llamacpp')).body;
  // llama.cpp's address: a model server answering there (where one runs), else its usual address.
  const llama = providers.items.find(i => i.value === 'http://127.0.0.1:8080/v1');
  assert.ok(llama && (llama.where === 'served here' || /its usual address/.test(llama.label)), JSON.stringify(providers.items));
});

test('a place by name, for Ambient\'s weather', async () => {
  const r = await H.api(null, 'GET', '/api/ambient/places?q=Turin');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items, [{ value: 'Turin, Piedmont, IT', where: '45.07, 7.68' }]);
  assert.deepEqual((await H.api(null, 'GET', '/api/ambient/places?q=T')).body.items, [], 'too short to ask');
});

test('a member reads places, but not the machine\'s services', async () => {
  const m = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/services/voices', undefined, { Cookie: m.cookie })).status, 403);
  assert.equal((await H.api(null, 'GET', '/api/services/choices?what=tts-url', undefined, { Cookie: m.cookie })).status, 403);
  assert.equal((await H.api(null, 'GET', '/api/ambient/places?q=Turin', undefined, { Cookie: m.cookie })).status, 200);
});
