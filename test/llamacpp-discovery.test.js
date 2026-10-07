'use strict';

/**
 * How the Models tab finds llama-servers DOCA did not start (audit 2026-10-06 coh F10; TODO B6b): by model-servers.js,
 * the one discovery the sidebar and system_status use, by default — and by each one's /props, the older path, when
 * `llamacpp.discovery` says so (CONSTITUTION W14: kept beside it, counted, never deleted).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

test('model servers by default, /props when chosen; each counted as the feature it is', async () => {
  const servers = require('../modules/model-servers'), external = require('../modules/models-llamacpp-external');
  const usage = require('../modules/features/usage');
  const real = [servers.status, external.find];
  servers.status = async () => ({ servers: [
    { provider: 'llamacpp', label: 'llama.cpp', url: 'http://127.0.0.1:8080/v1', kind: 'llama.cpp router', models: [{ id: 'big', state: 'working' }], doca: [], foreign: true },
    { provider: 'ollama', label: 'Ollama', url: 'http://127.0.0.1:11434', kind: 'Ollama', models: [{ id: 'q', state: 'loaded' }], doca: [] }] });
  external.find = async () => [{ provider: 'llamacpp', label: 'llama.cpp', url: 'http://127.0.0.1:8080', router: true, build: 'b1', ctx: 8192, models: [] }];
  try {
    const before = usage.of('llamacpp-external:servers').n;
    let r = (await H.api(null, 'GET', '/api/models/llamacpp/list')).body;
    assert.equal(r.via, 'servers');
    assert.deepEqual(r.external.map(s => [s.label, s.router, s.foreign, s.models[0].id]), [['llama.cpp', true, true, 'big']], 'llama.cpp only, Ollama has its own section');
    assert.equal(usage.of('llamacpp-external:servers').n, before + 1);

    const prefs = (await H.api(null, 'GET', '/api/prefs')).body;
    await H.api(null, 'POST', '/api/prefs', { llamacpp: { ...(prefs.llamacpp || {}), discovery: 'props' } });
    r = (await H.api(null, 'GET', '/api/models/llamacpp/list')).body;
    assert.equal(r.via, 'props');
    assert.equal(r.external[0].build, 'b1');
    assert.equal(usage.of('llamacpp-external:props').n, 1);
  } finally { [servers.status, external.find] = real; }

  const alt = require('../modules/features').get('llamacpp-props');
  assert.equal(alt.state, 'alternative');
  assert.equal(alt.beside, 'model-servers');
});
