'use strict';

// A device's call hearing its own voice (asked 2026-10-09 from a Xiaomi Watch 5: "in the call the agent picks up its
// own voice"): an utterance that began over the answer and is mostly the answer's own words is dropped as "our own
// voice", before anything reaches the hive; a person talking over it still gets through (modules/realtime/pipeline.js).

require('./helpers');   // first: the data folder is a test's own before any module reads a path
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pipeline = require('../modules/realtime/pipeline');

const tone = (ms, amp = 6000) => { const b = Buffer.alloc(ms * 48); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(amp * Math.sin(i / 5)), i * 2); return b; };
const quiet = ms => tone(ms, 30);
const wait = ms => new Promise(r => setTimeout(r, ms));

/** A pipeline whose transcriber hears `words`, its voice two seconds of PCM a sentence; what it emits, in order. */
function call(words) {
  const ev = [];
  const p = pipeline.connect({ silenceMs: 200, transcribe: async () => words.shift() ?? '', synth: async () => Buffer.alloc(96000) });
  for (const e of ['heard', 'user', 'interrupted']) p.on(e, x => ev.push(x === undefined ? e : [e, x]));
  p.on('tool', t => ev.push(['tool', t.args.request]));
  p.on('dropped', why => ev.push(['dropped', why]));
  return { p, ev };
}

test('isEcho: mostly the words just said, as the panel\'s _callIsEcho', () => {
  const said = ['The lights in the hall are on now.', 'Anything else?'];
  assert.equal(pipeline.isEcho('the lights in the hall are on', said), true);
  assert.equal(pipeline.isEcho('lights hall are on now anything', said), true);
  assert.equal(pipeline.isEcho('stop, turn off the kitchen instead', said), false);
  assert.equal(pipeline.isEcho('', said), false);
  assert.equal(pipeline.isEcho('the lights are on', []), false);
});

test('its own answer heard back over the speaker is dropped as our own voice, and no turn starts', async () => {
  const { p, ev } = call(['The lights in the hall are on now']);
  p.say('The lights in the hall are on now.');
  await wait(10);
  p.audio(Buffer.concat([tone(600), quiet(400)]));   // the speaker, into the microphone, while it plays
  await wait(30);
  const dropped = ev.filter(e => e[0] === 'dropped');
  assert.equal(dropped.length, 1);
  assert.match(dropped[0][1], /^our own voice/);
  assert.equal(ev.some(e => e === 'heard' || e[0] === 'user' || e[0] === 'tool'), false, 'nothing reaches the hive, and the device is not told it heard');
  p.close();
});

test('a person talking over the answer still gets through', async () => {
  const { p, ev } = call(['Stop, turn off the kitchen instead']);
  p.say('The lights in the hall are on now.');
  await wait(10);
  p.audio(Buffer.concat([tone(600), quiet(400)]));
  await wait(30);
  assert.ok(ev.includes('interrupted'));
  assert.ok(ev.includes('heard'), 'heard once the words show it is a person');
  assert.deepEqual(ev.filter(e => e[0] === 'tool'), [['tool', 'Stop, turn off the kitchen instead']]);
  assert.equal(ev.some(e => e[0] === 'dropped'), false);
  p.close();
});

test('the same words said when nothing plays are a request, not an echo', async () => {
  const ev = [];
  const p = pipeline.connect({ silenceMs: 200, transcribe: async () => 'the lights are on', synth: async () => Buffer.alloc(480) });   // 10 ms of voice
  p.on('heard', () => ev.push('heard')); p.on('tool', t => ev.push(['tool', t.args.request])); p.on('dropped', w => ev.push(['dropped', w]));
  p.say('The lights are on.');
  await wait(1700);   // past the answer and its grace
  p.audio(Buffer.concat([tone(600), quiet(400)]));
  await wait(30);
  assert.deepEqual(ev, ['heard', ['tool', 'the lights are on']]);
  p.close();
});
