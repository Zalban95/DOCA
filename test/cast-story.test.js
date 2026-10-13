'use strict';

// Tones on a speaker and a story told in several (R3h; voice-tags.parts, cast/speech.js story, the cast tool's story):
// each part is said in its own tone and the parts played as one sound; a voice without tones says it once, plainly.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');

let tts, bodies = [];
test.before(async () => {
  await H.start();
  tts = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { if (!b) { res.writeHead(200); return res.end(); } bodies.push(JSON.parse(b)); res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(100 + bodies.length, bodies.length)); }); });
  await new Promise(r => tts.listen(0, '127.0.0.1', r));
});
test.after(async () => { tts.close(); await H.stop(); });

/** The person's Quick call voice: a voice that takes tones (as Qwen3-TTS does), or the hive's plain one. */
function voice(t, tags) {
  const cv = require('../modules/call-voices'), was = cv.pick;
  cv.pick = () => ({ engine: { ttsUrl: `http://127.0.0.1:${tts.address().port}`, ttsModel: 'stub', ttsVoice: 'v', tags }, voice: 'v' });
  t.after(() => { cv.pick = was; });
}

test('a story\'s parts: each tag colours what follows it until the next', () => {
  const { parts } = require('../modules/voice-tags');
  assert.deepEqual(parts('[calm] Once upon a time. [whispers] Quiet now. [excited] It was the cat!'),
    [{ tag: 'calm', text: 'Once upon a time.' }, { tag: 'whispers', text: 'Quiet now.' }, { tag: 'excited', text: 'It was the cat!' }]);
  assert.deepEqual(parts('Plain start. [sad] Then sad. [1] stays'), [{ tag: null, text: 'Plain start.' }, { tag: 'sad', text: 'Then sad. [1] stays' }]);
  assert.deepEqual(parts(''), []);
});

test('with a voice that takes tones: one request per part, each with its tone, joined into one sound', async t => {
  voice(t, 'instructions');
  bodies = [];
  const speech = require('../modules/cast/speech');
  assert.ok(speech.tones({ id: H.owner.user.id }).includes('whispers'));
  const a = await speech.story('[calm] Once upon a time. [whispers] Quiet now.', { id: H.owner.user.id });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].input, 'Once upon a time.');
  assert.match(bodies[0].instructions, /Calm/);
  assert.equal(bodies[1].input, 'Quiet now.');
  assert.match(bodies[1].instructions, /Whisper/);
  assert.equal(a.buffer.length, 101 + 102, 'the two parts, one after the other');
});

test('with a plain voice: said once, the tags dropped; the sheet offers no tones', async t => {
  voice(t, null);
  bodies = [];
  const speech = require('../modules/cast/speech');
  assert.deepEqual(speech.tones({ id: H.owner.user.id }), []);
  await speech.story('[calm] Once upon a time. [whispers] Quiet now.', { id: H.owner.user.id });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].input, 'Once upon a time. Quiet now.');
  assert.equal(bodies[0].instructions, undefined);
  assert.deepEqual((await H.api(null, 'GET', '/api/cast/things')).body.tones, []);
});

test('the sheet lists the tones when the voice takes them; the agent tells a story only when asked', async t => {
  voice(t, 'instructions');
  assert.ok((await H.api(null, 'GET', '/api/cast/things')).body.tones.includes('excited'));
  const tool = require('../modules/harness/toolbox/cast')[0];
  assert.ok(tool.parameters.properties.action.enum.includes('story'));
  const r = await tool.run({ action: 'story', thing: 'kitchen', text: '[calm] Hi.' }, { user: { id: H.owner.user.id, role: 'owner' }, byPerson: true });
  assert.match(r, /asked: true/);
});
