'use strict';

/**
 * A voice from a service (hosted-voices/), against stubs that answer the way each provider's documentation says:
 * offered only once its key is kept, the key kept as a key for services (never in prefs, never back to a browser) and
 * sent by the hub in that provider's own header, the tags written each provider's way, the voices listed by name, and
 * a person without host refused a key the admin did not open. No real key, no network.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const fs     = require('node:fs');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

const heard = [];
const servers = {};
function stub(id) {
  return http.createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
    heard.push({ id, method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (id === 'elevenlabs' && req.url === '/v1/voices') return json({ voices: [{ voice_id: 'v-rachel', name: 'Rachel' }, { voice_id: 'v-adam', name: 'Adam' }] });
    if (id === 'cartesia' && req.url.startsWith('/voices')) return json({ data: [{ id: 'c-1', name: 'Calm Lady' }], has_more: false });
    if (id === 'google') return json({ audioContent: Buffer.from('MP3!').toString('base64') });
    if (req.headers['xi-api-key'] === 'wrong') { res.writeHead(401); return res.end('{"detail":"invalid api key wrong"}'); }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.from('ID3'));
  }); });
}

test.before(async () => {
  for (const id of ['elevenlabs', 'openai', 'cartesia', 'google']) {
    servers[id] = stub(id);
    await new Promise(r => servers[id].listen(0, '127.0.0.1', r));
    process.env[`DOCA_${id.toUpperCase()}_TTS_URL`] = `http://127.0.0.1:${servers[id].address().port}`;
  }
  await H.start();
  await H.api(null, 'GET', '/api/screen');
});
test.after(async () => { await H.stop(); for (const s of Object.values(servers)) await new Promise(r => s.close(r)); });

const keep = async (provider, key, who = 'host') => {
  const h = (await H.api(null, 'GET', '/api/chat/voices')).body.hosted.find(x => x.provider === provider);
  return H.api(null, 'POST', '/api/connectors/keys/all', { ...h.key, key, who });
};
const say = (voice, text) => H.api(null, 'POST', '/api/screen/settings', { voice }).then(() => H.api(null, 'POST', '/api/chat/synthesize', { text }));

test('offered only when asked: every service listed with how to set it up, none in the voices until its key is kept', async () => {
  const v = (await H.api(null, 'GET', '/api/chat/voices')).body;
  assert.deepEqual(v.hosted.map(h => [h.provider, h.hasKey]), [['elevenlabs', false], ['openai', false], ['cartesia', false], ['google', false]]);
  assert.ok(v.hosted.every(h => /^https:\/\//.test(h.keyPage) && h.models.length && h.key.origin.startsWith('https://')));
  assert.ok(!v.engines.some(e => e.hosted), 'nothing pushed');
});

test('ElevenLabs: the key in its own header from the hub, tags passed through to v4, voices by name', async () => {
  assert.equal((await keep('elevenlabs', 'xi-secret-123')).status, 200);
  const prefs = fs.existsSync(process.env.DOCA_PREFS_FILE) ? fs.readFileSync(process.env.DOCA_PREFS_FILE, 'utf8') : '';
  assert.ok(!prefs.includes('xi-secret-123'), 'never in the settings');
  assert.equal(require('../modules/service-keys').secretOf('elevenlabs').origin, 'https://api.elevenlabs.io', 'a key for services, tied to its address');
  const v = (await H.api(null, 'GET', '/api/chat/voices?engine=hosted:elevenlabs')).body;
  assert.deepEqual(v.voices, ['v-rachel', 'v-adam']);
  assert.equal(v.names['v-adam'], 'Adam');
  assert.ok(v.engines.some(e => e.id === 'hosted:elevenlabs' && e.tags));
  assert.ok(!JSON.stringify(v).includes('xi-secret-123'), 'never back to a browser');

  const r = await say({ engine: 'hosted:elevenlabs', ttsVoice: 'v-adam', hosted: { model: 'eleven_v4', stability: 0.5 } }, '[whispers] The baby is asleep. [laughing] Really.');
  assert.equal(r.status, 200);
  const sent = heard.filter(x => x.id === 'elevenlabs' && x.method === 'POST').at(-1);
  assert.equal(sent.headers['xi-api-key'], 'xi-secret-123');
  assert.match(sent.url, /^\/v1\/text-to-speech\/v-adam\?output_format=mp3_44100_128$/);
  assert.equal(sent.body.text, '[whispers] The baby is asleep. [laughs] Really.');
  assert.deepEqual([sent.body.model_id, sent.body.voice_settings.stability], ['eleven_v4', 0.5]);

  await say({ engine: 'hosted:elevenlabs', ttsVoice: 'v-adam', hosted: { model: 'eleven_flash_v2_5' } }, '[whispers] Quiet.');
  assert.equal(heard.filter(x => x.id === 'elevenlabs' && x.method === 'POST').at(-1).body.text, 'Quiet.', 'a model without tags never reads them aloud');

  // The agent is told about tags for a voice that takes them, and not for one that would read them aloud.
  const engines = require('../modules/tts-engines');
  assert.ok(engines.forVoice({ engine: 'hosted:elevenlabs' }).tags);
  assert.equal(engines.forVoice({ engine: 'hosted:elevenlabs', hosted: { model: 'eleven_flash_v2_5' } }).tags, null);
  assert.equal(engines.forVoice({ engine: 'hosted:nobody' }).id, '', 'an unknown service is the hive\'s voice');
});

test('OpenAI, Cartesia and Google: each takes the tone its own way', async () => {
  await keep('openai', 'sk-test-1'); await keep('cartesia', 'sk_car_test'); await keep('google', 'AIza-test');
  await say({ engine: 'hosted:openai', ttsVoice: 'marin', hosted: { style: 'Warm and unhurried.' } }, '[excited] We won!');
  const o = heard.filter(x => x.id === 'openai').at(-1);
  assert.equal(o.headers.authorization, 'Bearer sk-test-1');
  assert.deepEqual([o.body.model, o.body.voice, o.body.input], ['gpt-4o-mini-tts', 'marin', 'We won!']);
  assert.match(o.body.instructions, /^Warm and unhurried\. Excited/);

  await say({ engine: 'hosted:cartesia', ttsVoice: 'c-1' }, '[sad] It is gone. [laughs] Kidding.');
  const c = heard.filter(x => x.id === 'cartesia' && x.method === 'POST').at(-1);
  assert.equal(c.headers['cartesia-version'], '2026-08-14');
  assert.equal(c.body.transcript, '<emotion value="sad"/> It is gone. [laughter] Kidding.');
  assert.deepEqual(c.body.voice, { mode: 'id', id: 'c-1' });

  const g = await say({ engine: 'hosted:google', ttsVoice: 'Kore', hosted: { style: 'Like a radio host.' } }, '[whispers] Psst. [calm] All is well.');
  assert.equal(g.status, 200);
  const gs = heard.filter(x => x.id === 'google').at(-1);
  assert.equal(gs.headers['x-goog-api-key'], 'AIza-test');
  assert.equal(gs.body.input.text, '[whispering] Psst. All is well.');
  assert.match(gs.body.input.prompt, /^Like a radio host\. Calm/);
  assert.deepEqual([gs.body.voice.name, gs.body.voice.modelName, gs.body.voice.languageCode], ['Kore', 'gemini-2.5-flash-tts', 'en-US']);
});

test('a person without host uses a key only when the admin opened it; a refused key says where to fix it', async () => {
  const member = await H.signIn('member');
  const as = { Cookie: member.cookie, 'X-Doca-Password': '' };
  await H.api(null, 'GET', '/api/screen', undefined, as);
  await H.api(null, 'POST', '/api/screen/settings', { voice: { engine: 'hosted:openai', ttsVoice: 'marin' } }, as);
  const before = heard.length;
  const refused = await H.api(null, 'POST', '/api/chat/synthesize', { text: 'Hello.' }, as);
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  assert.equal(heard.length, before, 'nothing was sent');
  assert.ok(!(await H.api(null, 'GET', '/api/chat/voices', undefined, as)).body.engines.some(e => e.hosted));
  assert.equal((await H.api(null, 'POST', '/api/connectors/keys/all', { name: 'openai', origin: 'https://api.openai.com', key: 'x', who: 'everyone' }, as)).status, 403, 'keeping a key is an admin\'s');
  await keep('openai', 'sk-test-1', 'everyone');
  assert.equal((await H.api(null, 'POST', '/api/chat/synthesize', { text: 'Hello.' }, as)).status, 200);

  await keep('elevenlabs', 'wrong');
  const bad = await say({ engine: 'hosted:elevenlabs', ttsVoice: 'v-adam' }, 'Hi.');
  assert.ok(bad.status >= 400 && /Settings → Voice/.test(bad.body.error) && !bad.body.error.includes('wrong'), JSON.stringify(bad.body));
  await H.api(null, 'POST', '/api/screen/settings', { voice: null });
});
