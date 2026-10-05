'use strict';

/**
 * `npm run experiment -- wake-word` (docs/experiments/wake-word.md): phrases that call the hive by name and phrases that
 * do not are spoken by this machine's text-to-speech in several voices, then heard by its speech-to-text — with the wake
 * word as the spelling hint and without — and matched as the panel matches them (public/js/lib/wake-match.js). It
 * reports how many calls were caught, how many non-calls started one, and how long hearing took. Synthesized voices are
 * cleaner than a room: this is the floor of the error, and real calls are the rest of the measure.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CALLS = ['{w}, what time is it?', 'Hey {w}, turn on the lights.', '{w}.', 'Okay {w}, what is on my calendar today?', '{w}, start the music please.'];
const OTHERS = ['The dock is closed on Sundays.', 'I went to the doctor yesterday.', 'Thank you.', 'Let us play Dota tonight.',
  'Docker compose is up.', 'Okay, so what is next?', 'Can you hear me?'];
const VOICES = ['af_heart', 'am_adam', 'bf_emma'];

function matcher() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'lib', 'wake-match.js'), 'utf8'), ctx);
  return ctx.wakeMatch;
}

async function measure() {
  const chat = require('../../modules/chat');
  const vs = chat.loadVoiceServices();
  const word = require('../../modules/settings-schema').value('call.wakeWord') || require('../../modules/branding').name('product');
  const wakeMatch = matcher();
  const rows = [];
  for (const voice of VOICES) for (const [list, isCall] of [[CALLS, true], [OTHERS, false]]) for (const p of list) {
    const text = p.replace('{w}', word);
    const r = await fetch(`${vs.ttsUrl}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: vs.ttsModel, input: text, voice, response_format: 'mp3' }), signal: AbortSignal.timeout(60000) }).catch(e => ({ ok: false, statusText: e.message }));
    if (!r.ok) { console.log(`Text-to-speech at ${vs.ttsUrl} did not answer (${r.status || r.statusText}); nothing measured.`); return 1; }
    const audio = Buffer.from(await r.arrayBuffer());
    for (const hint of [true, false]) {
      const t0 = Date.now();
      const heard = await chat.transcribeAudio(audio, 'audio/mpeg', 'p.mp3', hint ? { prompt: word } : {});
      rows.push({ voice, text, isCall, hint, heard, ms: Date.now() - t0, matched: wakeMatch(heard, word).heard });
    }
  }
  for (const r of rows.filter(r => r.matched !== r.isCall)) console.log(`${r.isCall ? 'missed' : 'FALSE START'} [${r.voice}${r.hint ? ', hint' : ''}] "${r.text}" heard as "${r.heard}"`);
  const day = new Date().toISOString().slice(0, 10);
  for (const hint of [true, false]) {
    const set = rows.filter(r => r.hint === hint), calls = set.filter(r => r.isCall), others = set.filter(r => !r.isCall);
    const ms = set.map(r => r.ms).sort((a, b) => a - b)[Math.floor(set.length / 2)];
    console.log(`| ${day} | ${vs.sttModel} | "${word}" ${hint ? 'with' : 'without'} the hint | ${calls.filter(r => r.matched).length} of ${calls.length} | ${others.filter(r => r.matched).length} of ${others.length} | ${ms} ms |`);
  }
  return 0;
}

module.exports = { measure };
