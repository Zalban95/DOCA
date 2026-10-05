'use strict';

// Calling the hive by name (public/js/lib/wake-match.js; docs/experiments/wake-word.md): what Whisper writes for an
// invented name is a guess at its sound, so the match is by sound-alike spelling, near the start of what was said.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lib', 'wake-match.js'), 'utf8'), ctx);
const m = (t, w = 'DOCA') => ctx.wakeMatch(t, w);

test('the name, misheard the ways Whisper mishears it, starts a call and the rest is the first message', () => {
  assert.deepEqual({ ...m('Doca, what time is it?') }, { heard: true, rest: 'what time is it?' });
  assert.equal(m('Hey Doka, start the music.').rest, 'start the music.');
  assert.equal(m('Okay Dokka.').heard, true);
  assert.equal(m('Do ka, hi').rest, 'hi');
  assert.deepEqual({ ...m('Doca.') }, { heard: true, rest: '' });
});

test('words that only resemble it, or the name late in a sentence, do not', () => {
  for (const t of ['The dock is closed.', 'Docker compose is up.', 'I went to the doctor.', 'Thank you.', '', 'well hey there hello Doca'])
    assert.equal(m(t).heard, false, t);
});

test('any word a person sets is matched the same way', () => {
  assert.equal(m('Jarvis, lights on', 'Jarvis').rest, 'lights on');
  assert.equal(m('hey jarvus', 'Jarvis').heard, true);
  assert.equal(m('Harvest season', 'Jarvis').heard, false);
});

test('a screen is told which call experiments are on, without the owner\'s rights', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'screens', 'routes.js'), 'utf8');
  assert.match(src, /'bargeIn', 'faceVoice', 'wakeWord'/);
  assert.ok(require('../modules/experiments').EXPERIMENTS.some(e => e.id === 'wakeWord'));
});
