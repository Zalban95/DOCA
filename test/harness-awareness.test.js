'use strict';

/**
 * What the built-in harness knows, and what it is allowed to change.
 *
 * Three things are being pinned down here, and they are the ones that would be
 * expensive to get wrong: the standing rules are in every prompt and cannot be
 * edited away, a settings change reaches the prefs file only after somebody
 * accepts it, and the memory rules can be rewritten by either side.
 *
 * No model is called. The prompt is assembled and inspected directly, which is
 * the only way to assert "the charter is in there" without an inference server.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const providers   = require('../modules/harness/providers');
const environment = require('../modules/harness/environment');
const settings    = require('../modules/harness/settings');
const memory      = require('../modules/harness/memory');
const tools       = require('../modules/harness/tools');
const budget      = require('../modules/harness/budget');
const { loadPrefs } = require('../modules/utils');

before(H.start);
after(H.stop);

const get  = p => H.api(null, 'GET', p);
const post = (p, body) => H.api(null, 'POST', p, body);
const del  = p => H.api(null, 'DELETE', p);

/** The tool the agent would call, by name, with its arguments. */
const callTool = (name, args) => tools.call(name, args);

test('the environment block states where the panel is and what it manages', async () => {
  const block = environment.block({ provider: 'ollama', model: 'qwen3', toolCount: 12, disabledCount: 1 });

  assert.match(block, /# Environment/);
  assert.match(block, /you are running on: ollama \/ qwen3, 12 tools available, 1 switched off/);
  assert.match(block, /## Paths this panel manages/);
  // Every settable path is named with where its value came from, so the agent
  // cannot mistake a default for something the user chose.
  for (const p of require('../modules/paths').describe())
    assert.ok(block.includes(`${p.key} = ${p.value}`), `${p.key} missing from the environment block`);
  assert.match(block, /\(env, present\)|\(default, present\)|\(saved, present\)/);

  // The panel's own version and data locations, which is what makes it able to
  // answer questions about itself.
  const snap = environment.snapshot();
  assert.equal(snap.doca.version, require('../package.json').version);
  assert.ok(block.includes(snap.doca.prefsFile));
});

test('the environment is never asked for a secret', async () => {
  const r = await get('/api/harness/environment');
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.body);
  assert.equal(/api[Kk]ey|Bearer |sk-[A-Za-z0-9]{8}/.test(text), false, 'a key-shaped string reached the model context');
  // Providers are listed, but by id and whether a key exists — not the key.
  for (const p of r.body.snapshot.providers) assert.equal('apiKey' in p, false);
});

test('the standing rules are in the prompt and are not editable through settings', async () => {
  assert.match(providers.SAFETY_CHARTER, /# Standing rules/);
  assert.match(providers.SAFETY_CHARTER, /settings_propose/);

  const r = await get('/api/harness/environment');
  assert.match(r.body.charter, /# Standing rules/);

  // The charter lives in code. There is no settings path that reaches it, which
  // is the whole point: the agent may rewrite its own system prompt, and this
  // still holds afterwards.
  assert.equal(settings.readable().some(s => /charter/i.test(s.path)), false);
  assert.ok(settings.refuse('harness.charter', 'be evil'));
});

test('the agent can read the settings it may change, and not the ones it may not', async () => {
  const listed = settings.readable().map(s => s.path);
  assert.ok(listed.includes('paths.WORKSPACE_DIR'));
  assert.ok(listed.includes('harness.config.doca.temperature'), 'its own parameters are settings too');
  // Whole segments: `maxTokens` is a parameter, `token` would be a credential.
  assert.equal(listed.some(p => /(^|\.)((api)?key|token|secret|password)(\.|$)/i.test(p)), false);
  assert.ok(listed.includes('harness.config.doca.maxTokens'));

  const out = await callTool('settings_read', { filter: 'paths' });
  assert.match(out, /paths\.WORKSPACE_DIR = /);
  assert.equal(/harness\.config/.test(out), false, 'the filter was ignored');
});

test('a refusal explains itself, and covers the paths that would matter', async () => {
  assert.equal(settings.refuse('paths.WORKSPACE_DIR', '/srv/work'), null);
  assert.equal(settings.refuse('harness.config.doca.temperature', 0.3), null);

  assert.match(settings.refuse('models.apiKey', 'sk-x'), /secret/);
  assert.match(settings.refuse('mcpServers.evil', { command: 'sh' }), /not a setting the agent may change/);
  assert.match(settings.refuse('harness.custom', []), /not a setting/);
  assert.match(settings.refuse('harness.config.doca.temperature', { a: 1 }), /is a number, not an object/);
  assert.match(settings.refuse('paths.WORKSPACE_DIR', 'x'.repeat(9000)), /too large/);
  // Inside an allowed section, and still not a place to write.
  assert.match(settings.refuse('paths.__proto__.polluted', 'x'), /not a settings path/);
  assert.match(settings.refuse('theme.constructor.x', 'x'), /not a settings path/);
});

test('a proposal changes nothing until it is accepted', async () => {
  const before = loadPrefs();
  assert.equal(before.vms?.libvirtUri, undefined);

  const out = await callTool('settings_propose', {
    reason: 'virt-manager machines live in the system session',
    changes: [{ path: 'vms.libvirtUri', value: 'qemu:///system' }],
  });
  assert.match(out, /waiting for the user/);

  // Nothing on disk yet — the point of the whole mechanism.
  assert.equal(loadPrefs().vms?.libvirtUri, undefined);

  const pending = (await get('/api/harness/proposals')).body.pending;
  assert.equal(pending.length, 1);
  const p = pending[0];
  assert.equal(p.changes[0].path, 'vms.libvirtUri');
  assert.equal(p.changes[0].from, null);
  assert.equal(p.changes[0].to, 'qemu:///system');
  assert.match(p.reason, /virt-manager/);

  const applied = await post(`/api/harness/proposals/${p.id}/apply`);
  assert.equal(applied.status, 200);
  assert.equal(applied.body.restartNeeded, false);
  assert.equal(loadPrefs().vms.libvirtUri, 'qemu:///system');

  // Accepting twice is the double-click case, and must not re-apply.
  assert.equal((await post(`/api/harness/proposals/${p.id}/apply`)).status, 409);
  assert.equal((await get('/api/harness/proposals')).body.pending.length, 0);
});

test('a declined proposal is remembered, with the reason, so it is not repeated', async () => {
  await callTool('settings_propose', {
    reason: 'faster replies',
    changes: [{ path: 'harness.config.doca.temperature', value: 0.1 }],
  });
  const p = (await get('/api/harness/proposals')).body.pending[0];

  const r = await post(`/api/harness/proposals/${p.id}/reject`, { reason: 'I like it creative' });
  assert.equal(r.status, 200);
  assert.equal(r.body.proposal.status, 'rejected');
  // Untouched — still whatever it was, which on a fresh install is the shipped
  // default the catalog seeds.
  assert.equal(loadPrefs().harness.config.doca.temperature,
    require('../modules/harness/providers').defaultParams().temperature);

  // And it is in the agent's context, verdict and reason both.
  const block = settings.block();
  assert.match(block, /REJECTED: harness\.config\.doca\.temperature → 0\.1/);
  assert.match(block, /I like it creative/);
});

test('a path change says it needs a restart, and applies through the paths registry', async () => {
  await callTool('settings_propose', {
    reason: 'the workspace moved',
    changes: [{ path: 'paths.WORKSPACE_DIR', value: `${H.tmp}/moved` }],
  });
  const p = (await get('/api/harness/proposals')).body.pending[0];
  assert.match(p.changes[0].note, /restart/i);

  const applied = await post(`/api/harness/proposals/${p.id}/apply`);
  assert.equal(applied.body.restartNeeded, true);
  assert.equal(loadPrefs().paths.WORKSPACE_DIR, `${H.tmp}/moved`);

  // Settings → Paths reads the same value back, and knows this process is not
  // using it yet.
  const row = require('../modules/paths').describe().find(x => x.key === 'WORKSPACE_DIR');
  assert.equal(row.value, `${H.tmp}/moved`);
  assert.equal(row.source, 'saved');
  assert.equal(row.pending, true);
});

test('a proposal cannot be smuggled past the allowlist by the browser either', async () => {
  // The apply route re-checks, because a pending proposal is a file and the
  // request to accept it comes from outside.
  const p = settings.propose({ reason: 'x', changes: [{ path: 'theme', value: 'amber' }] });
  const store = require('../modules/store');
  const doc = store.readJson('harness/proposals', { proposals: [] });
  doc.proposals.find(x => x.id === p.id).changes[0].path = 'models.apiKey';
  store.writeJson('harness/proposals', doc);

  const r = await post(`/api/harness/proposals/${p.id}/apply`);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /secret/);
  assert.equal(loadPrefs().models?.apiKey, undefined);

  assert.equal((await post('/api/harness/proposals/p_nope/apply')).status, 404);
});

test('memory has rules, and both sides can change them', async () => {
  const shipped = (await get('/api/harness/memory/rules')).body;
  assert.equal(shipped.rules.source, 'default');
  assert.ok(shipped.rules.categories.some(c => c.id === 'machine'));
  assert.ok(shipped.rules.rules.some(r => /secret/i.test(r)), 'the shipped rules say not to store secrets');

  // The agent rewrites them itself.
  const out = await callTool('memory_rules_write', {
    rules: ['One fact per entry.', 'Never store a secret.', 'Prefer the user\'s own words.'],
  });
  assert.match(out, /3 rules/);
  const afterAgent = memory.rules();
  assert.equal(afterAgent.source, 'agent');
  assert.equal(afterAgent.categories.length, shipped.rules.categories.length, 'categories were left alone');

  // The user edits them from the console.
  const saved = await post('/api/harness/memory/rules', {
    categories: [{ id: 'machine', description: 'this host' }, { id: 'quirks', description: 'things that surprised us' }],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.rules.categories.length, 2);
  assert.equal(saved.body.rules.rules.length, 3, 'the rules were left alone');
  assert.equal(saved.body.rules.source, 'user');

  // Emptying either list would leave the prompt saying nothing at all.
  assert.equal((await post('/api/harness/memory/rules', { rules: [] })).status, 400);

  const reset = await del('/api/harness/memory/rules');
  assert.equal(reset.body.rules.source, 'default');
  assert.deepEqual(reset.body.rules.rules, memory.DEFAULT_RULES.rules);
});

test('a remembered fact can be filed under a category', async () => {
  const out = await callTool('memory_write', {
    key: 'gpu', value: 'Two 16 GB cards, both usually busy with Ollama.', category: 'machine', tags: ['nvidia'],
  });
  assert.match(out, /under machine/);
  const entry = memory.memList().find(e => e.key === 'gpu');
  assert.equal(entry.category, 'machine');
  assert.equal(entry.source, 'agent');

  // An unknown category is still stored: the taxonomy is the agent's own and
  // losing the fact to enforce it would be the wrong trade.
  await callTool('memory_write', { key: 'odd', value: 'Something.', category: 'not-a-category' });
  assert.equal(memory.memList().find(e => e.key === 'odd').category, 'not-a-category');
});

test('the agent can see its own clients, and which of them are reachable', async () => {
  const empty = await callTool('doca_clients', {});
  assert.match(empty, /No devices are paired/, 'a fresh hub says so rather than inventing a list');

  const phone = H.mkDevice('desk', 'phone', H.PHONE_CAPS);
  const watch = H.mkDevice('wrist', 'watch', H.WATCH_CAPS);
  const agent = H.mkDevice('sim', 'agent');

  // The watch is asleep with something waiting for it; the phone is connected.
  await H.api(agent.token, 'POST', '/api/v1/agent/alerts', { title: 'ping', targets: [watch.device.id] });
  const stream = H.sse(phone.token);
  await stream.ready;

  const out = await callTool('doca_clients', {});
  assert.match(out, /3 paired, 1 connected right now/);
  assert.match(out, new RegExp(`${phone.device.id}\\s+desk\\s+phone\\s+ONLINE`));
  assert.match(out, new RegExp(`${watch.device.id}\\s+wrist\\s+watch\\s+offline\\s+queued=1`));
  assert.match(out, /sim\s+agent/, 'an agent client is listed as what it is');
  // What each can do, so the agent does not offer a watch a route it cannot take.
  assert.match(out, /can=chat,prompts,commands,sensors/);   // phone
  assert.match(out, /can=chat,prompts,sensors/);            // watch: no command:*
  assert.match(out, /Sockets and tailnet peers are a different question/);

  stream.close();

  // A revoked device is not a client any more.
  await H.api(phone.token, 'DELETE', `/api/v1/devices/${watch.device.id}`);
  assert.match(await callTool('doca_clients', {}), /2 paired/);
});

test('the new tools are offered to the model and switchable like the rest', async () => {
  const names = tools.describe().map(t => t.name);
  for (const t of ['settings_read', 'settings_propose', 'memory_rules_write', 'doca_clients']) assert.ok(names.includes(t), t);

  const off = tools.schemas(['settings_propose']).map(s => s.function.name);
  assert.equal(off.includes('settings_propose'), false);
  assert.equal(await tools.call('settings_propose', {}, ['settings_propose']), 
    'Error: the "settings_propose" tool is switched off for this harness.');

  // And the ⚙ panel is told about them by the same route it always reads.
  const meta = (await get('/api/harness/providers')).body;
  assert.ok(meta.tools.some(t => t.name === 'settings_propose'));
});

/* ── What memory protects, and from whom ──────────────── */

test('a locked fact cannot be overwritten or deleted by the agent, only disputed', async () => {
  await post('/api/harness/memory', { key: 'blender-port', value: 'Blender listens on 9876 on the DocaDesk box.' });
  const locked = await post('/api/harness/memory/blender-port/lock', { locked: true });
  assert.equal(locked.status, 200);
  assert.equal(locked.body.entry.locked, true);

  // The agent's two ways of destroying it are both refused, with the reason and
  // with what it should do instead.
  const over = await callTool('memory_write', { key: 'blender-port', value: 'Nothing listens on 9876.' });
  assert.match(over, /locked/);
  assert.match(over, /memory_flag/);
  assert.equal(memory.memFind('blender-port').value, 'Blender listens on 9876 on the DocaDesk box.');

  const gone = await callTool('memory_forget', { key: 'blender-port' });
  assert.match(gone, /locked/);
  assert.ok(memory.memFind('blender-port'));

  // Disputing it is allowed, and keeps the fact.
  const flagged = await callTool('memory_flag', {
    key: 'blender-port',
    note: 'Connected from DocaDesk: nothing is listening on 9876, the addon server is not started.',
  });
  assert.match(flagged, /Flagged/);
  const entry = memory.memFind('blender-port');
  assert.equal(entry.value, 'Blender listens on 9876 on the DocaDesk box.', 'the fact survives the dispute');
  assert.match(entry.disputed.note, /nothing is listening/);
  assert.equal(entry.disputed.by, 'agent');

  // And the dispute reaches the prompt, where it is the only thing that stops
  // the agent leaning on the fact again next turn.
  const block = require('../modules/harness/agent').preview({ message: 'what port is blender on' });
  assert.match(block, /blender-port/);
  assert.match(block, /contradicted/);
  assert.match(block, /nothing is listening/);
  assert.match(block, /\(locked\)/);

  // The user is not the agent: the console can still delete it.
  assert.equal((await del('/api/harness/memory/blender-port')).status, 200);
  assert.equal(memory.memFind('blender-port'), null);
});

test('an overwrite keeps the value it replaced, and answers an open dispute', async () => {
  await callTool('memory_write', { key: 'models-dir', value: '/srv/models' });
  await callTool('memory_flag',  { key: 'models-dir', note: 'ls says that path does not exist.' });
  assert.ok(memory.memFind('models-dir').disputed);

  await callTool('memory_write', { key: 'models-dir', value: '/var/lib/models, moved after the disk swap.' });
  const e = memory.memFind('models-dir');
  assert.equal(e.disputed, undefined, 'a new value settles the dispute it answers');
  assert.equal(e.history[0].value, '/srv/models', 'the value it replaced is recoverable');
});

test('the agent can change one memory rule without deleting the other twenty-nine', async () => {
  const before = memory.rules().rules.length;

  const out = await callTool('memory_rules_write', { add: ['Prefer the user\'s own words for anything they asked for.'] });
  assert.match(out, /in place/);
  const after = memory.rules().rules;
  assert.equal(after.length, before + 1, 'the existing rules were kept');
  assert.ok(after.some(r => /own words/.test(r)));

  // Replace and remove address one rule each, by number.
  await callTool('memory_rules_write', { replace: [{ index: 1, text: 'One fact per entry, keyed as you would search for it.' }] });
  assert.match(memory.rules().rules[0], /keyed as you would search/);
  assert.equal(memory.rules().rules.length, before + 1);

  await callTool('memory_rules_write', { remove: [before + 1] });
  assert.equal(memory.rules().rules.length, before);

  // A rule number that does not exist is refused rather than guessed at.
  assert.match(await callTool('memory_rules_write', { remove: [999] }), /no rule 999/);

  // The wholesale form still exists, and now says what it did.
  const replaced = await callTool('memory_rules_write', { rules: ['Only this one.'] });
  assert.match(replaced, /replaced/);
  assert.match(replaced, /is gone/);
  assert.equal(memory.rules().rules.length, 1);
  await del('/api/harness/memory/rules');
});

/* ── Limits, and whose they are ───────────────────────── */

test('the agent is told its own limits, by name and by settings path', async () => {
  const p = require('../modules/harness/catalog').configFor('doca');
  const block = budget.block(p, null);

  assert.match(block, /# Your limits/);
  // Every limit that can stop a turn names the setting that sets it, because
  // "propose a change" needs the dotted path and the user needs the words.
  assert.match(block, /harness\.config\.doca\.maxSteps/);
  assert.match(block, /harness\.config\.doca\.maxTokens/);
  assert.match(block, /harness\.config\.doca\.historyTurns/);
  assert.match(block, /harness\.config\.doca\.memoryLimit/);
  // With no window declared it says so rather than implying one.
  assert.match(block, /context window: not declared/);
  assert.match(budget.block({ ...p, contextWindow: 32768 }, null), /context window: 32768 tokens/);

  // And the charter makes naming the limit a standing rule, not a nicety.
  assert.match(providers.SAFETY_CHARTER, /name which limit it was and whose it is/);
});

test('a provider refusal says which limit it was and who set it', async () => {
  const ep = { id: 'stub' };
  const p  = { ...require('../modules/harness/catalog').configFor('doca'), contextWindow: 8192 };

  const ctx = budget.explain({ status: 400, detail: 'This model\'s maximum context length is 8192 tokens', ep, p });
  assert.match(ctx, /context window/);
  assert.match(ctx, /historyTurns/, 'it names the DOCA settings that decide how much is sent');
  assert.match(ctx, /maximum context length is 8192/, 'the provider\'s own words survive');

  const rate = budget.explain({ status: 429, detail: 'Rate limit reached', ep, p });
  assert.match(rate, /not a DOCA setting/);

  const auth = budget.explain({ status: 401, detail: 'invalid api key', ep, p });
  assert.match(auth, /API Keys/);
});

test('the ledger counts what the provider reports, and says when it guessed', () => {
  const p = { contextWindow: 1000, warnAt: 80 };

  const measured = budget.ledger();
  budget.record(measured, { usage: { prompt_tokens: 400, completion_tokens: 50 }, promptEstimate: 999 });
  assert.equal(budget.report(measured, p).totalTokens, 450, 'the estimate is ignored when a real number arrived');
  assert.equal(budget.report(measured, p).source, 'provider');
  assert.equal(budget.report(measured, p).contextPercent, 40);
  assert.equal(budget.warning(measured, p), null, 'nothing to warn about at 40%');

  // A provider that reports nothing still produces a usable ledger, marked.
  const guessed = budget.ledger();
  budget.record(guessed, { usage: null, promptEstimate: 850, completionEstimate: 20 });
  assert.equal(budget.report(guessed, p).source, 'estimated');
  const warn = budget.warning(guessed, p);
  assert.equal(warn.percent, 85);
  assert.equal(warn.estimated, true);
  assert.match(warn.text, /estimated/);

  // With no window configured there is no percentage to warn on, and it does
  // not invent one.
  assert.equal(budget.warning(guessed, { contextWindow: 0 }), null);
  assert.equal(budget.report(guessed, { contextWindow: 0 }).contextPercent, null);
});

test('the environment block keeps its volatile readings last, so the prefix is cacheable', async () => {
  const args = { provider: 'ollama', model: 'qwen3', toolCount: 12, disabledCount: 1 };
  const a = environment.block(args);
  await new Promise(r => setTimeout(r, 1100));   // past the clock's resolution
  const b = environment.block(args);

  assert.notEqual(a, b, 'the clock is still in there somewhere');
  assert.match(a, /## Right now/);
  // Everything before "## Right now" is identical between steps: that head is
  // the prefix a provider's cache and a local prefill match on.
  const head = t => t.slice(0, t.indexOf('## Right now'));
  assert.equal(head(a), head(b));
  assert.ok(head(a).length > 300, 'the stable head is the bulk of the block');
  // The readings themselves did not go missing on the way down.
  assert.match(b, /time: \d{4}-\d{2}-\d{2}T/);
  assert.match(b, /memory: .* free of /);
});
