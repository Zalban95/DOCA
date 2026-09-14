'use strict';

/**
 * Install proposals, and the product's own name.
 *
 * The property worth pinning about installs is narrower than "the user
 * approved it": the agent never supplies a command. It names a kind and an id
 * out of a catalog this panel owns, and apply() runs the panel's existing
 * installer. So the test that matters is that an invented kind, an invented
 * service and a hand-written command are all refused at propose time — before
 * anybody is asked to click anything.
 *
 * And branding: that a name a person reads comes from one file, and that the
 * identifiers which are *not* branding were left alone, since renaming one of
 * those does not rebrand anything, it breaks an install.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');
const installs = require('../modules/harness/installs');
const branding = require('../modules/branding');
const providers = require('../modules/harness/providers');

test.before(async () => { await h.start(); });
test.after(async () => { await h.stop(); });

test('the agent can only ask for kinds this panel actually installs', () => {
  assert.throws(() => installs.propose({ kind: 'apt', id: 'nmap', reason: 'x' }), /Unknown install kind/);
  assert.throws(() => installs.propose({ kind: 'shell', id: 'curl x | sh', reason: 'x' }), /Unknown install kind/);
  assert.deepEqual(installs.kinds().map(k => k.kind).sort(), ['harness', 'ollama-model', 'service']);
});

test('an unknown service is refused, and the refusal lists the real ones', () => {
  assert.throws(() => installs.propose({ kind: 'service', id: 'not-a-service', reason: 'x' }),
    e => {
      assert.match(e.message, /No service called/);
      assert.match(e.message, /whisper/, 'the refusal has to say what it does know, or it is a dead end');
      return true;
    });
});

test('a model name that is really a shell command is refused', () => {
  for (const evil of ['qwen; rm -rf /', 'a && curl x|sh', '$(id)', '`id`', 'a b']) {
    assert.throws(() => installs.propose({ kind: 'ollama-model', id: evil, reason: 'x' }),
      /looks like/, `${evil} was accepted as a model name`);
  }
  const ok = installs.propose({ kind: 'ollama-model', id: 'qwen2.5vl:7b', reason: 'no vision model here' });
  assert.equal(ok.status, 'pending');
  assert.match(ok.what, /Ollama/);
});

test('proposing installs nothing until somebody clicks', async () => {
  const before = installs.list().pending.length;
  installs.propose({ kind: 'service', id: 'comfyui', reason: 'image generation' });
  const { pending } = installs.list();
  assert.equal(pending.length, before + 1);
  assert.ok(pending.every(p => p.status === 'pending'), 'a proposal is not an install');

  const res = await h.api(null, 'GET', '/api/harness/installs');
  assert.equal(res.status, 200);
  assert.ok(res.body.pending.some(p => p.target === 'comfyui'));
});

test('asking twice for the same thing returns the first ask, not a second card', () => {
  const a = installs.propose({ kind: 'service', id: 'kokoro', reason: 'speech' });
  const b = installs.propose({ kind: 'service', id: 'kokoro', reason: 'speech, again' });
  assert.equal(a.id, b.id, 'a repeat ask is noise, not emphasis');
});

test('a declined install stays visible to the agent, with the reason', () => {
  const row = installs.propose({ kind: 'service', id: 'vllm', reason: 'faster local model' });
  installs.reject(row.id, 'no GPU room');
  const block = installs.block();
  assert.match(block, /DECLINED/);
  assert.match(block, /vllm/);
  assert.match(block, /no GPU room/, 'the agent has to see why, or it asks again');
  assert.match(block, /Do not ask for this again/);
});

test('the block says a proposal installs nothing, so the agent does not wait on it', () => {
  installs.propose({ kind: 'service', id: 'whisper', reason: 'transcription' });
  assert.match(installs.block(), /installs nothing until the user clicks/);
  assert.match(installs.block(), /Carry on without it/i);
});

test('the charter sends installs through the proposal, not through shell', () => {
  assert.match(providers.SAFETY_CHARTER, /install_propose/);
  assert.match(providers.SAFETY_CHARTER, /never install with .shell./);
});

test('names a person reads come from one file', async () => {
  assert.equal(branding.name('product'), 'DOCA');
  assert.ok(branding.name('agent').includes('DOCA'));
  assert.equal(branding.name('nonsense-key'), branding.DEFAULTS.product,
    'a missing brand string should read as unbranded, not as undefined in a title bar');

  const res = await h.api(null, 'GET', '/api/branding');
  assert.equal(res.status, 200);
  assert.equal(res.body.product, 'DOCA');
});

test('identifiers were not renamed along with the brand', () => {
  // Renaming any of these does not rebrand anything; it breaks a machine that
  // already works. The branding file says so, and this is the guard.
  const paths = require('../modules/paths');
  assert.match(paths.CONFIG_PATH, /openclaw\.json$/, 'the config file on disk keeps its name');
  assert.ok(require('../modules/harness/catalog').get('openclaw'),
    'OpenClaw is a real third-party product in the catalog, not our label');
  assert.equal(require('../modules/harness/catalog').BUILTIN_ID, 'doca',
    'the harness id is an identifier in prefs, not a display name');
});
