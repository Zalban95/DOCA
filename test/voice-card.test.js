'use strict';

/**
 * Settings → Voice → Voice (public/js/settings/voice-card*.js; asked 2026-10-08): one card for the voice, and with
 * "Different voices for each call" a row each for the Live call, the Deep call and Ambient's assistant. In a browser:
 * each kind is saved to its own key of the screen-home setting `voice` (this screen's layer, or the hive's prefs), a
 * row left at "Same as …" keeps no slot, ▶ speaks through what is shown before it is saved, and beside a chosen service
 * the card says whether it runs; a running voice service no voice uses is listed with Stop. Skipped without a browser.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)
const B = require('./panel-browser');

const heard = { kokoro: [], qwen: [] };
const stub = (who, voices) => http.createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
  if (req.url === '/v1/audio/voices') return res.end(JSON.stringify({ voices }));
  heard[who].push(JSON.parse(raw || '{}')); res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(480)); }); });
const kokoro = stub('kokoro', ['af_heart', 'if_sara']), qwen = stub('qwen', ['ryan', 'serena']);
const saved = {};

before(async () => {
  await Promise.all([kokoro, qwen].map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
  // The machine's own speech services are never reached: each row, for this file, is a stub (or a closed port).
  for (const r of require('../modules/services').INFERENCE_SERVICES) {
    if (!['whisper', 'kokoro', 'qwentts'].includes(r.id)) continue;
    saved[r.id] = r.port;
    r.port = r.id === 'kokoro' ? kokoro.address().port : r.id === 'qwentts' ? qwen.address().port : 1;
  }
  await B.start({ setup: () => {
    const u = require('../modules/utils');
    u.savePrefs({ ...u.loadPrefs(), setup: { mode: 'advanced' }, voiceServices: { ttsUrl: `http://127.0.0.1:${kokoro.address().port}`, sttUrl: 'http://127.0.0.1:1', ttsModel: 'kokoro', ttsVoice: 'af_heart', ttsSpeed: 1 } });
  } });
});
after(async () => {
  for (const r of require('../modules/services').INFERENCE_SERVICES) if (saved[r.id]) r.port = saved[r.id];
  await B.stop();
  await Promise.all([kokoro, qwen].map(s => new Promise(r => s.close(r))));
});

const set = (id, value) => B.evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const screenVoice = () => B.evaluate("screenLoad(true).then(s => s.from.voice === 'device' ? s.settings.voice : null)");
const ready = () => B.until("!!document.getElementById('vc-engine') && !document.querySelector('#voice-card [data-loading]')");

test('one Voice card, first on the page, where the old cards\' links land', { skip: B.skip }, async () => {
  await B.open('#settings/voice');
  assert.ok(await ready(), 'the card drew');
  const r = await B.evaluate(`(() => ({ first: document.querySelector('#sp-voice > .card').id, old: ['screen-voice-card', 'call-voices-card'].map(id => !!document.getElementById(id)?.closest('#voice-card')),
    calls: document.getElementById('vc-calls').hidden, rows: [...document.querySelectorAll('#vc-calls .vc-call')].map(r => r.dataset.kind),
    state: document.querySelector('#voice-card .vc-state')?.textContent.trim() }))()`);
  assert.deepEqual(r, { first: 'voice-card', old: [true, true], calls: true, rows: ['quick', 'deep', 'ambient'], state: 'Kokoro TTS is running' });
  const unused = await B.evaluate("document.querySelector('#voice-card .vc-unused')?.textContent.replace(/\\s+/g, ' ').trim()");
  assert.match(unused, /Qwen3-TTS .* running, not used by any voice Stop/, 'a voice service nobody speaks with is listed, with Stop');
});

test('this screen: the voice, and each call\'s, saved to their own keys; "Same as …" keeps no slot', { skip: B.skip }, async () => {
  await set('vc-voice', 'if_sara');
  await set('vc-speed', '1.2');
  await B.evaluate("document.getElementById('vc-split').click()");
  await set('vc-quick-service', 'qwentts');
  await B.until("document.querySelector('.vc-call[data-kind=\"quick\"]')?.dataset.service === 'qwentts'");
  await set('vc-quick-voice', 'ryan');
  await set('vc-deep-voice', 'af_heart');
  await set('vc-ambient-service', 'hive');
  await B.until("document.querySelector('.vc-call[data-kind=\"ambient\"]')?.dataset.service === 'hive'");
  await set('vc-ambient-voice', 'if_sara');
  await set('vc-quick-speed', '1.4');
  await B.evaluate('voiceCardSave()');
  assert.ok(await ready());
  assert.deepEqual(await screenVoice(), { ttsVoice: 'if_sara', ttsSpeed: 1.2, quick: { service: 'qwentts', voice: 'ryan', speed: 1.4 }, deep: { voice: 'af_heart' }, ambient: { service: 'hive', voice: 'if_sara' } });
  assert.equal(await B.evaluate("document.getElementById('vc-split').checked"), true, 'drawn again with the calls shown');
  assert.equal(await B.evaluate("document.getElementById('vc-quick-voice').value"), 'ryan');

  // Ambient's back to following the Live call: no slot of its own (call-voices.js then speaks the Live call's voice).
  await set('vc-ambient-service', '');
  await B.until("document.querySelector('.vc-call[data-kind=\"ambient\"]')?.dataset.service === ''");
  await set('vc-ambient-voice', '');
  await B.evaluate('voiceCardSave()');
  assert.ok(await ready());
  assert.equal((await screenVoice()).ambient, undefined);

  // One voice for every call again: the calls' slots go, the voice stays.
  await B.evaluate("document.getElementById('vc-split').click()");
  await B.evaluate('voiceCardSave()');
  assert.ok(await ready());
  assert.deepEqual(await screenVoice(), { ttsVoice: 'if_sara', ttsSpeed: 1.2 });
});

test('▶ speaks a sample through what is shown, before it is saved', { skip: B.skip }, async () => {
  const n = heard.qwen.length;
  await set('vc-engine', 'qwentts');
  assert.ok(await B.until("document.getElementById('voice-card').dataset.engine === 'qwentts'"));
  await set('vc-voice', 'serena');
  await B.evaluate("voiceCardTry('main')");
  assert.ok(await B.until("/Spoken|✗/.test(document.getElementById('vc-status')?.textContent || '')"));
  assert.equal(heard.qwen.length, n + 1, 'the expressive voice spoke it');
  assert.equal(heard.qwen.at(-1).voice, 'serena');
  assert.match(heard.qwen.at(-1).input, /how I sound/);
  assert.deepEqual(await screenVoice(), { ttsVoice: 'if_sara', ttsSpeed: 1.2 }, 'nothing was saved');
});

test('the hive: an admin saves the voice every screen without its own speaks in', { skip: B.skip }, async () => {
  await B.evaluate("voiceCardSave(true)");   // this screen back to the hive's
  assert.ok(await ready());
  assert.equal(await screenVoice(), null);
  await B.evaluate("document.querySelector('input[name=\"vc-scope\"][value=\"hive\"]').click()");
  assert.ok(await B.until("document.getElementById('voice-card').dataset.scope === 'hive'"));
  await set('vc-engine', 'qwentts');
  assert.ok(await B.until("document.getElementById('voice-card').dataset.engine === 'qwentts'"));
  await set('vc-voice', 'ryan');
  await B.evaluate("document.getElementById('vc-split').click()");
  await set('vc-deep-service', 'hive');
  await B.until("document.querySelector('.vc-call[data-kind=\"deep\"]')?.dataset.service === 'hive'");
  await B.evaluate('voiceCardSave()');
  assert.ok(await ready());
  assert.deepEqual(require('../modules/utils').loadPrefs().voice, { engine: 'qwentts', ttsVoice: 'ryan', deep: { service: 'hive' } });
  assert.equal(await screenVoice(), null, 'this screen kept no layer of its own');
  const state = await B.evaluate("document.querySelector('#voice-card .vc-row[data-kind=\"main\"] .vc-state')?.textContent.trim()");
  assert.equal(state, 'Qwen3-TTS (expressive voice) is running');
  assert.equal(await B.evaluate("!!document.querySelector('#voice-card .vc-unused')"), false, 'now in use: not listed');
  assert.deepEqual(B.errors, [], 'no page error');
});
