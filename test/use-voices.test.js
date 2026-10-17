'use strict';

// What uses a speech service names the hive's own voices on it (machines/use-ports.js; audit 2026-10-17): the expressive
// voice was the Live call's voice and the voice every screen starts with, and "what uses it" said only "an inference
// service" — so stopping it would have asked nothing that mattered.

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

test.after(() => H.stop());

test('the hive\'s screen voice and Live call voice on a service are said; a kind without a slot of its own is not', async () => {
  await H.start();
  const u = require('../modules/utils');
  const prefs = u.loadPrefs();
  u.savePrefs({ ...prefs, voice: { engine: 'qwentts', ttsVoice: 'serena', quick: { service: 'qwentts', voice: 'serena' } } });
  const port = Number(new URL(require('../modules/tts-engines').forVoice({ engine: 'qwentts' }).ttsUrl).port);
  const said = require('../modules/machines/use-ports').reasons(port, 'Qwen3-TTS');
  assert.ok(said.includes('Qwen3-TTS is the voice every screen starts with'), said.join(' | '));
  assert.ok(said.some(s => /Live call voice/.test(s)), said.join(' | '));
  assert.ok(!said.some(s => /Ambient/.test(s)), 'Ambient speaks as the Live call: said once');
  u.savePrefs(prefs);
});
