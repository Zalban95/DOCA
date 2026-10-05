'use strict';

// A screen's own voice (settings-schema `voice`, a screen-home setting; chat.js handleSynthesize; TODO H2.4): read
// aloud in the voice and speed this screen chose, else the hive's. And a person's own devices link to their pages.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');

let tts, heard = [];
before(async () => {
  tts = http.createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => { heard.push(JSON.parse(raw)); res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.from('ID3')); }); });
  await new Promise(r => tts.listen(0, '127.0.0.1', r));
  await H.start();
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), voiceServices: { ttsUrl: `http://127.0.0.1:${tts.address().port}`, ttsModel: 'kokoro', ttsVoice: 'af_heart', ttsSpeed: 1 } });
});
after(async () => { await H.stop(); await new Promise(r => tts.close(r)); });

test('answers are read in this screen\'s voice when it chose one, the hive\'s otherwise', async () => {
  await H.api(null, 'GET', '/api/screen');   // this browser becomes a screen
  assert.equal((await H.api(null, 'POST', '/api/chat/synthesize', { text: 'hello' })).status, 200);
  assert.deepEqual([heard.at(-1).voice, heard.at(-1).speed], ['af_heart', 1]);
  const set = await H.api(null, 'POST', '/api/screen/settings', { voice: { ttsVoice: 'bf_emma', ttsSpeed: 1.3 } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  await H.api(null, 'POST', '/api/chat/synthesize', { text: 'hello' });
  assert.deepEqual([heard.at(-1).voice, heard.at(-1).speed], ['bf_emma', 1.3]);
  await H.api(null, 'POST', '/api/screen/settings', { voice: null });
  await H.api(null, 'POST', '/api/chat/synthesize', { text: 'hello' });
  assert.equal(heard.at(-1).voice, 'af_heart', 'back to the hive\'s');
});

test('the Devices list says which devices are this person\'s, whose pages they may open', async () => {
  const mine = H.mkDevice('My phone', 'phone', H.PHONE_CAPS);
  require('../modules/api-v1/devices').update(mine.device.id, { userId: H.owner.user.id });
  const other = H.mkDevice('Someone\'s watch', 'watch', H.WATCH_CAPS);
  const list = (await H.api(null, 'GET', '/api/devices')).body.devices;
  assert.equal(list.find(d => d.id === mine.device.id).mine, true);
  assert.equal(list.find(d => d.id === other.device.id).mine, false);
});
