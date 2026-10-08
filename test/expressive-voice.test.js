'use strict';

/**
 * The expressive voice (asked 2026-10-08): Qwen3-TTS as a speech service row that only a click starts, a screen
 * choosing it beside the hive's voice, the tone tags a spoken answer may carry — turned into words for a voice that
 * takes instructions, dropped for any other, never shown or kept — and the guided set-up suggesting it only to
 * whoever asked for a voice with feeling.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./helpers');   // first: it points the settings at a temporary folder

const heard = { hive: [], expressive: [] };
const stub = (who, voices) => http.createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
  if (req.url === '/v1/audio/voices') return res.end(JSON.stringify({ voices }));
  heard[who].push(JSON.parse(raw)); res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.from('ID3')); }); });
let kokoro, qwen, row, rowPort;

before(async () => {
  kokoro = stub('hive', ['af_heart', 'if_sara']); qwen = stub('expressive', ['ryan', 'serena', 'vivian']);
  await Promise.all([kokoro, qwen].map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
  row = require('../modules/services').INFERENCE_SERVICES.find(s => s.id === 'qwentts');
  rowPort = row.port; row.port = qwen.address().port;   // the row's address, for this test: the stub
  await H.start();
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), voiceServices: { ttsUrl: `http://127.0.0.1:${kokoro.address().port}`, ttsModel: 'kokoro', ttsVoice: 'af_heart', ttsSpeed: 1 } });
});
after(async () => { row.port = rowPort; await H.stop(); await Promise.all([kokoro, qwen].map(s => new Promise(r => s.close(r)))); });

test('tone tags become words for a voice that takes instructions, and are dropped for any other', () => {
  const tags = require('../modules/voice-tags');
  assert.equal(tags.strip('[whispers] Quiet, the baby is asleep.'), 'Quiet, the baby is asleep.');
  assert.equal(tags.strip('And then [laughs] the cat ran.'), 'And then the cat ran.');
  assert.equal(tags.strip('See [the docs](https://x) and note [1]. [Calm] Done.'), 'See [the docs](https://x) and note [1]. Done.', 'only the known words, never a link or a footnote');
  assert.deepEqual(tags.forVoice('[whispers] Piano, dorme.', 'instructions'), { input: 'Piano, dorme.', instructions: tags.TAGS.whispers.ask });
  assert.deepEqual(tags.forVoice('[whispers] Piano, dorme.', null), { input: 'Piano, dorme.' });
  assert.deepEqual(tags.forVoice('Plain words.', 'instructions'), { input: 'Plain words.' });
  assert.deepEqual(tags.found('[excited] Yes! [laughing] [excited] again'), ['excited', 'laughs']);
});

test('the panel drops the same tags as they stream, a tag split across pieces included', () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/lib/voice-tags.js'), 'utf8'), ctx);
  const hub = Object.values(require('../modules/voice-tags').TAGS).flatMap(t => t.says).sort();
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(VOICE_TAG_WORDS.slice().sort())', ctx)), hub, 'the browser\'s list is the hub\'s');
  const f = vm.runInContext('voiceTagsFilter()', ctx);
  const out = ['Sure. [whis', 'pers] Quiet', ' now. [1] and [', 'x] ok'].map(c => f.push(c)).join('') + f.rest();
  assert.equal(out, 'Sure. Quiet now. [1] and [x] ok');
});

test('the language of a sentence is told to a voice that needs it, and left to it when unsure', () => {
  const { guess } = require('../modules/speech-language');
  assert.equal(guess('Vuoi che spenga anche le luci in cucina?'), 'Italian');
  assert.equal(guess('Do you want me to turn off the lights in the kitchen too?'), 'English');
  assert.equal(guess('OK.'), null);
  assert.equal(guess('こんにちは', ['English', 'Japanese']), 'Japanese');
  assert.equal(guess('Vuoi che spenga le luci?', ['English']), null, 'only a language the voice speaks');
});

test('the service row: GPU only, its memory worked out for the card, the token never shown', () => {
  const speech = require('../modules/speech-services');
  assert.ok(row && row.speech && !row.cpuImage);
  const a16 = speech.args({ hfCache: '/cache/hub', hfToken: '', modelId: '', totalGB: 16 });
  assert.ok(a16.includes(speech.IMAGE) && a16.includes(speech.MODEL) && a16.includes('qwen3-tts') && a16.includes('--omni'));
  assert.ok(a16.includes('/cache/hub:/hf') && a16.includes('HF_HUB_CACHE=/hf'), 'the hub cache itself: a model already here is not fetched again');
  const o16 = JSON.parse(a16[a16.indexOf('--stage-overrides') + 1]);
  assert.deepEqual([o16[0].gpu_memory_utilization, o16[1].gpu_memory_utilization], [0.33, 0.1]);
  const a24 = speech.args({ hfCache: '/c', totalGB: 24 });
  assert.equal(JSON.parse(a24[a24.indexOf('--stage-overrides') + 1])[0].gpu_memory_utilization, 0.22, 'the same gigabytes on a bigger card');
  assert.equal(speech.share(5.2, null), 0.33, 'a card that cannot be read counts as 16 GB');
  assert.match(require('../modules/services').diagnose('RuntimeError: Failed to infer device type'), /only on a GPU/);
  assert.equal(require('../modules/harness/installs').KINDS.service.validate('qwentts'), null, 'an install proposal can name it');
});

test('a screen chooses the expressive voice beside the hive\'s; its tags turn into words there and nowhere else', async () => {
  await H.api(null, 'GET', '/api/screen');
  const voices = (await H.api(null, 'GET', '/api/chat/voices?engine=qwentts')).body;
  assert.deepEqual(voices.voices, ['ryan', 'serena', 'vivian']);
  assert.equal(voices.default, 'serena');
  assert.deepEqual(voices.engines.map(e => [e.id, e.tags]), [['', false], ['qwentts', true]], 'listed while it answers');

  await H.api(null, 'POST', '/api/chat/synthesize', { text: '[whispers] Quiet, the baby is asleep.' });
  assert.deepEqual(heard.hive.at(-1), { model: 'kokoro', input: 'Quiet, the baby is asleep.', voice: 'af_heart', response_format: 'mp3', speed: 1 }, 'Kokoro: no tags, nothing new');

  const set = await H.api(null, 'POST', '/api/screen/settings', { voice: { engine: 'qwentts', ttsVoice: 'Ryan' } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  await H.api(null, 'POST', '/api/chat/synthesize', { text: '[whispers] Piano, il bambino dorme.' });
  const sent = heard.expressive.at(-1);
  assert.deepEqual([sent.model, sent.voice, sent.input, sent.language], ['qwen3-tts', 'ryan', 'Piano, il bambino dorme.', 'Italian']);
  assert.match(sent.instructions, /Whisper/);
  assert.equal((await H.api(null, 'POST', '/api/chat/synthesize', { text: '[laughs]' })).status, 204, 'a tag alone has nothing to say');

  const client = require('../modules/harness/turn/client');
  const spoken = { name: 'Dashboard console', mode: 'call', formFactor: 'desktop' };
  assert.match(client.clientBlock({ ...spoken, voiceTags: true }), /\[whispers\]/);
  assert.doesNotMatch(client.clientBlock(spoken), /\[whispers\]/, 'a voice without tags: the agent is not told of them');
  await H.api(null, 'POST', '/api/screen/settings', { voice: null });

  // The hive's own voice pointed at the expressive service (Settings → Voice) is that voice: it takes tags too.
  const u = require('../modules/utils'), was = u.loadPrefs().voiceServices;
  u.savePrefs({ ...u.loadPrefs(), voiceServices: { ...was, ttsUrl: `http://localhost:${row.port}` } });
  assert.equal(require('../modules/tts-engines').hive().tags, 'instructions');
  u.savePrefs({ ...u.loadPrefs(), voiceServices: was });
  assert.equal(require('../modules/tts-engines').hive().tags, null);
});

test('the call pipeline speaks the tags and shows the words', async () => {
  const pipeline = require('../modules/realtime/pipeline');
  const said = [], shown = [];
  const p = pipeline.connect({ transcribe: async () => '', synth: async s => { said.push(s); return Buffer.alloc(4800); } });
  p.on('agent', t => shown.push(t));
  const done = new Promise(r => p.on('turn', r));
  p.say('[laughs] That is funny. [sighs]');
  await done; p.close();
  assert.deepEqual(said, ['[laughs] That is funny.']);
  assert.deepEqual(shown, ['That is funny. ']);
});

test('the guided set-up suggests the expressive voice only to whoever asks for it, and Kokoro when it does not fit', () => {
  const doc = require('../modules/guided/suggestions').load();
  const { pickRole } = require('../modules/guided/pick');
  const big = { gpuGB: 15.9, ramGB: 64, diskGB: 200 }, small = { gpuGB: 4, ramGB: 16, diskGB: 200 };
  assert.equal(pickRole('tts', big, doc).local.id, 'kokoro', 'not asked: the voice stays Kokoro');
  assert.equal(pickRole('tts', big, doc, { want: ['expressive'] }).local.id, 'qwentts');
  assert.equal(pickRole('tts', small, doc, { want: ['expressive'] }).local.id, 'kokoro', 'asked, and it does not fit: Kokoro');
  const plan = require('../modules/guided/plan');
  assert.ok(plan.USES.expressive.roles.includes('tts'));
  const steps = plan.plan({ uses: ['expressive'] }, { ...big, gpus: [], runtimes: { docker: true } }, doc).steps;
  assert.ok(steps.some(s => s.type === 'install' && s.id === 'qwentts'), JSON.stringify(steps));
});
