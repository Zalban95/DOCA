'use strict';

/**
 * One "Add a service" box for anything outside (asked 2026-10-10): the hub tells a chat-model endpoint from an API
 * service and says why (api-services/classify.js); an id and a secret are typed apart and kept as before (id:secret);
 * a draft the agent prepares raises a notice linking to it and a badge; providers kept twice at one address are merged
 * into the one with the key; a server kept without its /v1 is offered the fix; this hub's own tailnet name is local.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

let stub, base;
const hits = [];
test.before(async () => {
  await H.start();
  // One server playing three parts: a chat-model server answering only under /v1, a docs site publishing an OpenAPI
  // document, and hitem3d's token address (which must get the scope in its form).
  stub = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/llm/v1/models') return json(200, { data: [{ id: 'qwen3.8-27b' }, { id: 'tiny' }] });
      if (req.url === '/docs/openapi.json') return json(200, { openapi: '3.1.0', info: { title: 'Weather' }, servers: [{ url: `${base}/api` }],
        components: { securitySchemes: { k: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } }, security: [{ k: [] }],
        paths: { '/forecast': { get: { operationId: 'forecast', parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }] } } } });
      if (req.url === '/oauth/token') return json(200, { access_token: `tok:${body}`, expires_in: 600 });
      if (req.url.startsWith('/api/echo')) return json(200, { headers: req.headers });
      json(404, { error: 'no' });
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${stub.address().port}`;
});
test.after(async () => { stub?.close(); await H.stop(); });

const classify = q => H.api(null, 'POST', '/api/connectors/services/classify', { q });

test('the box tells a chat-model endpoint from an API service, a ready-made one and a known provider, and says why', async () => {
  const llm = (await classify(`${base}/llm`)).body;
  assert.equal(llm.kind, 'provider', JSON.stringify(llm));
  assert.equal(llm.provider.baseUrl, `${base}/llm/v1`, 'found under /v1');
  assert.deepEqual(llm.provider.models, ['qwen3.8-27b', 'tiny']);
  assert.match(llm.why, /chat-model server: 2 models/);

  const tpl = (await classify('hi3d')).body;
  assert.equal(tpl.kind, 'service'); assert.equal(tpl.template, 'hi3d'); assert.match(tpl.why, /not a chat model/);
  assert.equal((await classify('https://docs.hi3d.ai/en/api')).body.template, 'hi3d', 'a docs link finds the ready-made one');

  const groq = (await classify('groq')).body;
  assert.equal(groq.kind, 'provider'); assert.equal(groq.provider.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal((await classify('https://console.mistral.ai')).body.provider?.name, 'mistral', 'a known provider by its address');

  const docs = (await classify(`${base}/docs/openapi.json`)).body;
  assert.equal(docs.kind, 'service', JSON.stringify(docs));
  assert.equal(docs.found.definition.actions[0].name, 'forecast');
  assert.ok(docs.found.openapi, 'the document for the form');
  assert.match(docs.why, /OpenAPI document/);

  const nothing = (await classify('frobnicator')).body;
  assert.equal(nothing.kind, 'service'); assert.equal(nothing.unknown, true); assert.match(nothing.why, /prepare it/);

  const empty = (await classify('')).body;
  assert.equal(empty.kind, null);
  assert.ok(empty.templates.some(t => t.id === 'hi3d') && empty.presets.some(p => p.id === 'groq'), 'suggestions with nothing typed');
});

test('a draft the agent prepares: a notice linking to it, first in the box, and its ready-made actions', async () => {
  const tools = require('../modules/harness/tools');
  const out = await tools.call('service_draft', { name: 'hi3d', origin: 'https://api.hitem3d.ai', place: 'exchange', field: 'https://api.hitem3d.ai/open-api/v1/auth/token', note: '3D models' }, [], { sessionId: 's1' });
  assert.match(out, /notice/);
  const notice = (await H.api(null, 'GET', '/api/notices')).body.notices.find(n => /hi3d is ready to finish/.test(n.title));
  assert.ok(notice, 'a notice for the admins');
  assert.match(notice.link.href, /^#connectors\?draft=svc_[0-9a-f]+$/);
  const r = (await classify('hi3d')).body;
  assert.equal(r.kind, 'service'); assert.equal(r.draft.name, 'hi3d', 'the draft wins over the ready-made one');
  assert.equal((await classify('')).body.drafts[0].template, 'hi3d');
  assert.equal((await H.api(null, 'GET', '/api/connectors/drafts/all')).body.drafts[0].template, 'hi3d', 'opened with the ready-made actions');
  // a link elsewhere is never kept on a notice
  const n = require('../modules/notices').post({ title: 'x', link: { label: 'go', href: 'https://evil.example/' } }).notice;
  assert.equal(n.link, undefined);
});

/** The panel's script in a sandbox, with just enough of a page for it. */
function sandbox(files, els) {
  const document = { getElementById: id => els[id] || null, querySelectorAll: () => [], documentElement: { style: { setProperty(k, v) { this[k] = v; } }, dataset: {} } };
  const ctx = vm.createContext({ document, escHtml: s => String(s), jsArg: s => JSON.stringify(s), _svcForm: { keyHint: '', hasKey: false }, _svcDrafts: [] });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public/js', f), 'utf8'), ctx);
  return ctx;
}

test('an id and a secret are typed in two boxes and kept as before, id:secret', async () => {
  const el = v => ({ value: v, hidden: false, placeholder: '', title: '' });
  const els = { 'sk-place': el('exchange'), 'sk-key': el(''), 'sk-id': el('AK123'), 'sk-secret': el('SK456'), 'sk-tokenurl': el(`${base}/oauth/token`) };
  const ctx = sandbox(['settings/service-auth.js'], els);
  assert.equal(ctx.serviceKeyTyped(), 'AK123:SK456');
  els['sk-secret'].value = '';
  assert.match(ctx.serviceKeyTyped().message, /secret/i, 'both are asked for');
  els['sk-place'].value = 'header';
  els['sk-key'].value = 'plain';
  assert.equal(ctx.serviceKeyTyped(), 'plain');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.serviceHeadersOf('X-Client: doca\nbad line\nX-Two: 2'))), { 'X-Client': 'doca', 'X-Two': '2' });

  // Saved as the form saves it: the key file holds id:secret, exactly as a key pasted before did.
  const save = await H.api(null, 'POST', '/api/connectors/services/all', { name: 'tokens', server: `${base}/api`, key: 'AK123:SK456', who: 'host', note: 'n',
    auth: { type: 'oauth2', tokenUrl: `${base}/oauth/token`, tokenBody: 'form', scope: 'read write' }, openapi: '', headers: { 'X-Client': 'doca' }, rate: { perMinute: 30 } });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const keys = JSON.parse(fs.readFileSync(require('../modules/paths').SERVICE_KEYS_FILE, 'utf8'));
  assert.equal(keys.tokens.key, 'AK123:SK456');
  assert.equal(keys.tokens.place, 'exchange'); assert.equal(keys.tokens.scope, 'read write');
  const view = save.body.service;
  assert.deepEqual(view.headers, { 'X-Client': 'doca' }); assert.deepEqual(view.rate, { perMinute: 30 }); assert.equal(view.auth.scope, 'read write');
  // The scope goes in the token request, the extra header with every call, and both round-trip through OpenAPI.
  const store = require('../modules/api-services/store');
  const def = store.get('tokens');
  const sent = await require('../modules/api-services/call').send({ ...def, actions: [] }, { name: 'echo', method: 'GET', path: '/echo' });
  assert.equal(sent.json.headers['x-client'], 'doca');
  assert.ok(hits.some(h => h === 'POST /oauth/token'));
  const oa = require('../modules/api-services/openapi');
  const back = oa.fromDoc(oa.toDoc(def)).definition;
  assert.equal(back.auth.scope, 'read write'); assert.deepEqual(back.headers, { 'X-Client': 'doca' }); assert.deepEqual(back.rate, { perMinute: 30 });
  const refused = await H.api(null, 'POST', '/api/connectors/services/all', { name: 'tokens2', server: `${base}/api`, key: 'k', auth: { type: 'bearer' }, openapi: '', headers: { Authorization: 'x' } });
  assert.equal(refused.status, 400, 'the key\'s header is never an extra header');
});

test('a waiting draft puts a count on the pages that finish it', () => {
  const els = { 'providers-drafts': { innerHTML: '' } };
  const ctx = sandbox(['settings/service-add.js'], els);
  ctx.serviceDraftBadge([{ id: 'svc_1', name: 'hi3d', origin: 'https://api.hitem3d.ai' }]);
  const root = ctx.document.documentElement;
  assert.equal(root.dataset.svcDrafts, '1'); assert.equal(root.style['--svc-drafts'], '"1"');
  assert.match(els['providers-drafts'].innerHTML, /hi3d.*ready to finish/s);
  ctx.serviceDraftBadge([]);
  assert.equal(root.dataset.svcDrafts, undefined);
  const css = fs.readFileSync(path.join(__dirname, '../public/css/service-add.css'), 'utf8');
  assert.match(css, /data-svc-drafts.*nav-tab\[data-tab="connectors"\].*nav-tab\[data-tab="apikeys"\]/s);
});

test('the same provider twice at one address is merged into the one with the key; a missing /v1 is offered', async () => {
  const keys = require('../modules/provider-keys');
  const utils = require('../modules/utils');
  keys.set('Mistral', { baseUrl: 'https://api.mistral.ai/v1', apiKey: 'mk-1234567890abcdef', models: [{ id: 'large' }] });
  keys.set('mistral', { baseUrl: 'https://api.mistral.ai/v1/', apiKey: '', models: [{ id: 'small' }] });
  keys.set('other', { baseUrl: 'https://api.mistral.ai/v1', apiKey: 'another-key-0000000' });   // a second account: left alone
  const prefs = utils.loadPrefs(); prefs.vision = { provider: 'mistral', model: 'small' }; utils.savePrefs(prefs);
  const pc = require('../modules/provider-checks');
  assert.deepEqual(pc.duplicates(keys.all()).filter(g => /mistral/i.test(g.keep)), []);   // three at one address, two keys: none offered
  keys.remove('other');
  const g = pc.duplicates(keys.all()).find(x => /mistral/i.test(x.keep));
  assert.deepEqual({ keep: g.keep, drop: g.drop }, { keep: 'Mistral', drop: ['mistral'] });
  const r = await H.api(null, 'POST', '/api/keys/merge', { keep: 'Mistral', drop: ['mistral'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(keys.get('mistral'), null);
  assert.equal(keys.resolve('mistral'), 'Mistral', 'the old name still finds it');
  assert.equal(keys.get('Mistral').apiKey, 'mk-1234567890abcdef');
  assert.deepEqual(keys.get('Mistral').models.map(m => m.id), ['large', 'small']);
  assert.equal(utils.loadPrefs().vision.provider, 'Mistral');
  assert.equal((await H.api(null, 'POST', '/api/keys/merge', { keep: 'Mistral', drop: ['groq'] })).status, 400);

  keys.set('desk', { baseUrl: `${base}/llm`, apiKey: '' });
  const c = (await H.api(null, 'GET', '/api/keys/checks')).body;
  const v = c.versions.find(x => x.name === 'desk');
  assert.equal(v.fix, `${base}/llm/v1`); assert.match(v.said, /lists 2 models/);
  assert.equal(c.versions.find(x => x.name === 'Mistral'), undefined, 'an address with its version is not asked');
});

test('this hub\'s own tailnet name is local; another machine on the tailnet is not', () => {
  const was = process.env.DOCA_TAILNET;
  process.env.DOCA_TAILNET = 'tail1234.ts.net';
  try {
    const { isLocalUrl } = require('../modules/harness/providers');
    assert.equal(isLocalUrl(`https://${require('os').hostname().toLowerCase()}.tail1234.ts.net/llama/v1`), true);
    assert.equal(isLocalUrl('https://another-box.tail1234.ts.net/v1'), false);
    assert.equal(isLocalUrl('https://tail1234.ts.net/v1'), false);
  } finally { if (was === undefined) delete process.env.DOCA_TAILNET; else process.env.DOCA_TAILNET = was; }
});
