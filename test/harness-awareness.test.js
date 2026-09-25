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

test('applying needs a browser, so a tool call cannot accept its own proposal', async () => {
  // The propose/click split is the load-bearing invariant of this surface, and
  // legacy /api/* has no auth in front of it (ISSUES.md H-7). The agent has
  // http_fetch, which takes any URL and any method and cannot set a request
  // header, so before this guard one tool call was enough to apply its own
  // proposal and the whole mechanism was advisory.
  const wasVms = JSON.stringify(loadPrefs().vms || {});
  await callTool('settings_propose', {
    reason: 'a change the agent should not be able to accept by itself',
    changes: [{ path: 'vms.libvirtUri', value: 'qemu:///session' }],
  });
  const p = (await get('/api/harness/proposals')).body.pending.at(-1);
  assert.ok(p, 'the proposal was not filed');

  try {
    // What http_fetch looks like: no Origin, no Sec-Fetch-Site.
    const bare = await H.api(null, 'POST', `/api/harness/proposals/${p.id}/apply`, undefined,
      { 'Sec-Fetch-Site': '' });
    assert.equal(bare.status, 403, 'an unauthenticated POST applied a proposal');
    assert.equal(bare.body.code, 'browser_only');

    // And nothing moved.
    assert.equal(JSON.stringify(loadPrefs().vms || {}), wasVms, 'the settings changed anyway');
    assert.equal((await get('/api/harness/proposals')).body.pending.some(x => x.id === p.id), true,
      'a refused apply must leave the proposal pending');

    // The same for installs.
    const i = await H.api(null, 'POST', '/api/harness/installs/i_nonexistent/apply', undefined,
      { 'Sec-Fetch-Site': '' });
    assert.equal(i.status, 403, 'the install apply route is not guarded');

    // A forged header is not a boundary and the comment on requireBrowser says
    // so — `shell` has curl, and curl sets whatever it likes. What this pins is
    // that the tool layer cannot reach the route, which is the path the agent
    // actually found and used on 2026-09-13.
  } finally {
    // Always clean up: a leaked pending proposal is read by the next test, and
    // that is how one failure turns into a confusing second one.
    await H.api(null, 'POST', `/api/harness/proposals/${p.id}/reject`, { reason: 'test cleanup' });
  }
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
  const block = budget.block(p);

  assert.match(block, /# Your limits/);
  // Every limit that can stop a turn names the setting that sets it, because
  // "propose a change" needs the dotted path and the user needs the words.
  assert.match(block, /harness\.config\.doca\.maxSteps/);
  assert.match(block, /harness\.config\.doca\.maxTokens/);
  assert.match(block, /harness\.config\.doca\.historyTurns/);
  assert.match(block, /harness\.config\.doca\.compactTokens/);
  assert.match(block, /harness\.config\.doca\.memoryLimit/);
  // With no window declared it says so rather than implying one.
  assert.match(block, /context window: not declared/);
  assert.match(budget.block({ ...p, contextWindow: 32768 }), /context window: 32768 tokens/);

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

test('the ring has a window, a used share, a fold point and a rate — or says nothing', () => {
  // What both chats draw. Each number is either a measurement or null; there
  // is deliberately no "sensible default" anywhere in here, because a ring
  // drawn against an invented window is a measurement nobody made.
  const p = { contextWindow: 1000, compactAt: 60 };

  const c = budget.context(p, 400);
  assert.equal(c.contextWindow, 1000);
  assert.equal(c.contextPercent, 40);
  assert.equal(c.compactAt, 600, 'compactAt is a percentage of the window, in tokens');
  assert.equal(c.compactPercent, 60, 'and the share of the ring past which folding starts');

  // The lower trigger wins, and it is reported as a share of the window even
  // though `compactTokens` is not a percentage of anything.
  const byTokens = budget.context({ ...p, compactTokens: 250 }, 400);
  assert.equal(byTokens.compactAt, 250);
  assert.equal(byTokens.compactPercent, 25);

  // Nobody has said how big the window is, so there is no ring to draw.
  assert.equal(budget.context({ contextWindow: 0 }, 400), null);

  // The rate is model time, not wall-clock: `ms` is measured around the
  // provider call so a turn that spent a minute in a shell command is not
  // reported as a slow model. Unmeasured stays null rather than becoming 0.
  const l = budget.ledger();
  budget.record(l, { usage: { prompt_tokens: 400, completion_tokens: 120 }, ms: 2000 });
  assert.equal(budget.report(l, p).tokensPerSecond, 60);
  assert.equal(budget.report(l, p).compactPercent, 60, 'the report carries the fold point too');

  const untimed = budget.ledger();
  budget.record(untimed, { usage: { prompt_tokens: 400, completion_tokens: 120 } });
  assert.equal(budget.report(untimed, p).tokensPerSecond, null, 'no clock, no rate');
});

test('the environment block is entirely facts: two calls a second apart are identical', async () => {
  const args = { provider: 'ollama', model: 'qwen3', toolCount: 12, disabledCount: 1 };
  const a = environment.block(args);
  await new Promise(r => setTimeout(r, 1100));   // past the clock's resolution
  const b = environment.block(args);

  // The whole block, not just the part before "## Right now".
  //
  // This test used to check only the head — `a.slice(0, a.indexOf('## Right
  // now'))` — and that is why it passed while the provider's cache was stopped
  // dead. The block is the third of thirteen in the system prompt, so a stable
  // head of *this* block proves nothing about the head of the *request*: the
  // clock it was protecting still sat ahead of the transcript, and the cache
  // matched 1,152 tokens and not one more (ISSUES.md H-9). The invariant worth
  // pinning is "nothing that changes between steps lives in here at all".
  assert.equal(a, b, 'nothing in this block may differ between steps');
  assert.equal(/## Right now/.test(a), false, 'the readings belong to live()');
  assert.match(a, /# Environment/);
  assert.match(a, /you are running on: ollama \/ qwen3, 12 tools available, 1 switched off/);
});

test('the readings are still sent — moved out of the block, not dropped', async () => {
  const a = environment.live();
  await new Promise(r => setTimeout(r, 1100));
  const b = environment.live();

  assert.notEqual(a, b, 'the clock is still in there somewhere');
  assert.match(b, /## Right now/);
  // Every reading that used to end the block is still here. The fix is
  // position, not content: dropping them would have been a silent behaviour
  // change dressed up as a cache optimisation.
  assert.match(b, /time: \d{4}-\d{2}-\d{2}T/);
  assert.match(b, /memory: .* free of /);
  assert.match(b, /uptime: host .* panel /);
});

test('the whole system prompt is byte-identical between steps — the invariant the cache needs', async () => {
  const agentMod = require('../modules/harness/agent');
  const a = agentMod.preview({ message: 'hello' });
  await new Promise(r => setTimeout(r, 1100));   // past the clock's resolution
  const b = agentMod.preview({ message: 'hello' });

  // This is the assertion that was missing, and its absence is why H-9 shipped.
  // A provider's prefix cache stops at the first byte that differs, so *every*
  // line ahead of the history has to hold still — not just the head of the
  // environment block. The clock and the running ledger used to live in here,
  // and everything after them was re-sent uncached on every step.
  assert.equal(a, b, 'nothing in the system prompt may change between steps');
  assert.equal(/## Right now/.test(a), false, 'readings must not be in the system prompt');
  assert.equal(/this turn so far/.test(a), false, 'the ledger must not be in the system prompt');

  // Still assembled in reading order: the charter first, so the panel's rules
  // are the first thing in context and the last thing anybody can edit away.
  assert.ok(a.indexOf('# Safety') < a.indexOf('# Environment'),
    'the charter still comes first');
});

test('the readings travel after the history, as the last thing the model reads', () => {
  const agentMod = require('../modules/harness/agent');
  const p = require('../modules/harness/catalog').configFor('doca');

  const l = budget.ledger();
  budget.record(l, { usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_cache_hit_tokens: 900 } });

  const live = agentMod.liveBlock(p, l);
  assert.match(live, /## Right now/);
  assert.match(live, /time: \d{4}-\d{2}-\d{2}T/);
  assert.match(live, /this turn so far: 1 model call/);

  // It is a trailing system message, not a rewrite of the leading one: the
  // system message the model was given is still the system message it gets.
  assert.equal(/## Right now/.test(agentMod.preview({ message: 'hi' })), false);
});

test('the limits block separates standing settings from the running ledger', () => {
  const p = require('../modules/harness/catalog').configFor('doca');

  // The settings half must not carry the step counter, or it reintroduces the
  // same per-step byte one level up.
  assert.equal(/this turn so far/.test(budget.block(p)), false,
    'the running ledger belongs to live()');

  // With no ledger there is nothing to say, and it says nothing rather than
  // printing a zero.
  assert.equal(budget.live(null, p), '');

  // With one, it reports the turn and names nothing it cannot know.
  const l = budget.ledger();
  budget.record(l, { usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_cache_hit_tokens: 900 } });
  const line = budget.live(l, p);
  assert.match(line, /this turn so far: 1 model call/);
  assert.match(line, /1010 tokens \(provider\)/);
  assert.match(line, /90% of this step's prompt came from cache/);
});

test('the cache is reported per step as well as per turn', () => {
  const p = require('../modules/harness/catalog').configFor('doca');
  const l = budget.ledger();

  // Step 1: nothing before it, so it can only match a prefix warmed elsewhere.
  budget.record(l, { usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_cache_hit_tokens: 100 } });
  let r = budget.report(l, p);
  assert.equal(r.stepCachedTokens, 100);
  assert.equal(r.stepCachePercent, 10);
  assert.equal(r.cachePercent, 10);

  // Step 2: same prompt size, but now almost all of it is a prefix the
  // provider has seen. The turn figure barely moves — which is exactly why it
  // could not show a broken prefix, and why the step figure exists (H-9).
  budget.record(l, { usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_cache_hit_tokens: 950 } });
  r = budget.report(l, p);
  assert.equal(r.stepCachedTokens, 950, 'the step figure is this step alone');
  assert.equal(r.stepCachePercent, 95);
  assert.equal(r.cachedTokens, 1050, 'the turn figure still accumulates');
  assert.equal(r.cachePercent, 53, 'and is dragged down by the first step');

  // A growing step figure is what a warm prefix looks like; a flat one is a
  // prefix being broken. Nothing in the turn figure distinguishes them.
  assert.ok(r.stepCachedTokens > 100, 'the cached region grew');

  // A provider that says nothing about caching reports null, not zero.
  const silent = budget.ledger();
  budget.record(silent, { usage: { prompt_tokens: 500, completion_tokens: 5 } });
  assert.equal(budget.report(silent, p).stepCachePercent, null);
  assert.equal(budget.report(silent, p).cachePercent, null);
});

test('every harness parameter has a box in the panel to type it into', () => {
  // A parameter added to defaultParams() does something the moment it exists,
  // and is unreachable until somebody also adds a field for it. contextWindow
  // shipped that way: read on every turn, settable only by editing the prefs
  // file by hand. This is the check that would have caught it.
  const fs   = require('node:fs');
  const path = require('node:path');
  const src  = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'harness.js'), 'utf8');

  const table = src.match(/const HARNESS_PARAMS = \[([\s\S]*?)\n\];/);
  assert.ok(table, 'HARNESS_PARAMS is what the config form renders from');
  const fields = [...table[0].matchAll(/key: '([A-Za-z]+)'/g)].map(m => m[1]);

  // These have their own controls rather than a number box: provider and model
  // are selects, systemPrompt a textarea, disabledTools the tool checkboxes, and
  // fallbackChain the repeatable provider/model rungs beside them. Each is in
  // the same config strip — the point of this list is that nothing is reachable
  // only by editing the prefs file, not that everything is a number box.
  const elsewhere = ['provider', 'model', 'systemPrompt', 'disabledTools', 'fallbackChain'];
  for (const key of Object.keys(providers.defaultParams())) {
    if (elsewhere.includes(key)) continue;
    assert.ok(fields.includes(key), `${key} has no field in the harness config panel`);
  }

  // Every field explains itself on screen, because the panel is meant to be
  // usable by somebody who did not write it.
  for (const m of table[0].matchAll(/key: '([A-Za-z]+)'[\s\S]{0,400}?hint: '/g))
    assert.ok(m[1], 'each parameter carries a hint');
  assert.equal((table[0].match(/hint:/g) || []).length, fields.length, 'a parameter is missing its description');

  // And the ranges are not still written for an 8k model.
  assert.match(table[0], /key: 'maxSteps'[\s\S]{0,200}?max="1000"/);
  assert.match(table[0], /key: 'historyTurns'[\s\S]{0,200}?max="5000"/);
});

test('the fallback rungs read back exactly what the form is showing', () => {
  // The form sits between the user's intent and the thing that decides who
  // answers. A rung it drops is a chain the user believes they configured and
  // does not have — and they would find out during the outage the chain was
  // meant to survive. So `_fallbacksRead` is run here, against a stub of just
  // the parts of the DOM it touches, rather than trusted.
  const fs   = require('node:fs');
  const path = require('node:path');
  const src  = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'harness.js'), 'utf8');
  const fn   = src.match(/const HARNESS_MAX_FALLBACKS = \d+;/)[0] + '\n'
             + src.match(/function _fallbacksRead[\s\S]*?\n\}/)[0];
  const { _fallbacksRead } = new Function(`${fn}; return { _fallbacksRead };`)();

  // One rung as the DOM presents it: a provider select and a model box, both
  // reachable only through `[data-role=…]`.
  const rung = (provider, model, contextWindow = '') => ({
    querySelector: sel => sel === '[data-role=provider]' ? { value: provider }
                          : sel === '[data-role=model]'   ? { value: model }
                          : sel === '[data-role=context-window]' ? { value: contextWindow }
                          : null,
  });

  const read = (...rungs) => {
    const prev = global.document;
    global.document = { getElementById: id => (id === 'hcfg-fallbacks-doca' ? { querySelectorAll: () => rungs } : null) };
    try { return _fallbacksRead('doca'); } finally { global.document = prev; }
  };

  // What was saved is what the form was built from, so opening ⚙ and pressing
  // Save without touching anything cannot quietly change the chain.
  const chain = [{ provider: 'ds', model: 'deepseek-flash' }, { provider: 'dsfb', model: 'deepseek-v4-pro' }];
  assert.deepEqual(read(...chain.map(e => rung(e.provider, e.model))), chain);
  assert.deepEqual(read(rung('local', 'small', '40960')),
    [{ provider: 'local', model: 'small', contextWindow: 40960 }]);
  assert.deepEqual(read(rung('local', 'small', '0')), [{ provider: 'local', model: 'small' }]);

  // A rung with a provider and no model is still a rung: the engine reads that
  // as "the same model, at that provider". Checked against the engine rather
  // than against a comment — on a primary of ollama/qwen3 a bare ollama rung
  // resolves to exactly that pair, so it must be dropped as a rung that would
  // only ever wait for itself.
  assert.deepEqual(read(rung('dsfb', '')), [{ provider: 'dsfb', model: '' }]);
  const agent = require('../modules/harness/agent');
  agent.forgetDegraded();
  const rungs = agent.rungsFor({
    ep: providers.endpoint('ollama'), model: 'qwen3',
    p: { firstTokenTimeoutMs: 1, failoverAfterMs: 1, fallbackChain: read(rung('ollama', '')) },
  });
  assert.equal(rungs.length, 1, 'a bare rung on the primary provider is the primary, not a second try');

  // A rung nobody chose a provider on is skipped rather than saved as a hole in
  // the chain — including the one the "+ Add another fallback" button leaves
  // sitting there when the user adds it and changes their mind.
  assert.deepEqual(read(rung('dsfb', 'deepseek-v4-pro'), rung('', ''), rung('ds', 'flash')),
    [{ provider: 'dsfb', model: 'deepseek-v4-pro' }, { provider: 'ds', model: 'flash' }]);

  // The same pair twice is a chain that waits for itself.
  assert.deepEqual(read(rung('ds', 'flash'), rung('ds', 'flash')), [{ provider: 'ds', model: 'flash' }]);
  assert.deepEqual(read(rung('ds', 'flash'), rung('ds', '')), [{ provider: 'ds', model: 'flash' }, { provider: 'ds', model: '' }],
    'but two different models on one provider are two different rungs');

  // A model id with a slash in it is now just a string in a box — the thing the
  // text parser had to be careful about is no longer expressible as an error.
  assert.deepEqual(read(rung('openrouter', 'meta-llama/llama-3')),
    [{ provider: 'openrouter', model: 'meta-llama/llama-3' }]);

  // Whitespace is trimmed, because a pasted model id arrives with it.
  assert.deepEqual(read(rung(' ds ', ' flash ')), [{ provider: 'ds', model: 'flash' }]);

  // Nothing filled in means nothing configured, which is the inert default.
  assert.deepEqual(read(), []);
  assert.deepEqual(read(rung('', 'flash')), []);

  // And a chain is bounded, because every rung is time the user waits. The
  // panel hides its own add button at the cap; this is the belt to that braces.
  assert.equal(read(...'abcdef'.split('').map(c => rung(c, 'm'))).length, 5);

  // The other half of the round trip: the box has to still *say* the provider
  // that was saved. A rung on a provider deleted from Settings → API Keys since
  // would otherwise fall back to the dropdown's first entry, and the next Save
  // would write that instead — the chain changed by opening ⚙ and pressing Save.
  const optsFor = new Function(
    '_harnessMeta', 'escHtml',
    src.match(/function _harnessProviderOpts[\s\S]*?\n\}/)[0] + '; return _harnessProviderOpts;',
  )({ providers: [{ id: 'ollama', label: 'Ollama', hasKey: true }] }, s => String(s));

  assert.match(optsFor('ghost'), /<option value="ghost" selected>/, 'a deleted provider is still shown as chosen');
  assert.equal(/selected/.test(optsFor('ollama').split('<option')[2]), false, 'and a live one is not double-chosen');
});

test('a saved fallback window survives being opened and saved again', () => {
  // The test above runs `_fallbacksRead` alone, and that is why it could not see
  // this: the reader was always correct, and the defect was in the function that
  // *feeds* it. `_harnessFallbacksMount` rebuilt each rung from `{provider,
  // model}` only, so opening ⚙ showed every served limit as 0 — and the Save
  // that followed wrote that 0 away, across the whole chain, without a word.
  //
  // "Save changes the chain" is the one thing this form must never do, so the
  // mount is run here rather than trusted. It draws into a stub box and calls
  // two spied dependencies: `harnessFallbackAdd` (one call per saved rung) and
  // `harnessRungProbe`, which the mount calls for every rung it finds and which
  // would otherwise reach for the network.
  const fs     = require('node:fs');
  const path   = require('node:path');
  const js     = f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
  const { fn } = require('./frontend');
  const src    = js('harness.js');
  const helper = fn, from = fn;

  const source = [
    src.match(/const HARNESS_MAX_FALLBACKS = \d+;/)[0],
    helper('escHtml'), helper('jsArg'),
    from('_harnessProviderOpts'), from('_harnessRungHtml'), from('_fallbacksRead'),
    from('_harnessFallbacksMount'),
  ].join('\n');

  // A fresh form each time: its own box, its own record of what was added.
  const build = () => {
    const rungs = [], added = [];
    let probes = 0;
    const box = { textContent: '', querySelectorAll: sel => (sel === '[data-rung]' ? rungs : []) };
    const made = new Function('harnessFallbackAdd', 'harnessRungProbe', '_harnessMeta', source
      + '; return { _harnessFallbacksMount, _fallbacksRead, _harnessRungHtml };')(
      // Stands in for the real add: it renders nothing, but it appends the rung
      // the mount then asks to have checked, which is the part the mount sees.
      (id, preset) => { added.push(preset); rungs.push({
        querySelector: sel => (sel === '[data-role=model]' ? { value: preset.model } : null) }); },
      () => { probes++; },
      { providers: [{ id: 'ds', label: 'DeepSeek', hasKey: true },
                    { id: 'local', label: 'llama.cpp', hasKey: true }] });
    return { ...made, box, added, probes: () => probes };
  };

  const opened = build();
  const realDocument = global.document;
  const showing = box => { global.document = { getElementById: id => (id === 'hcfg-fallbacks-doca' ? box : null) }; };
  try {
    const chain = [{ provider: 'ds', model: 'flash', contextWindow: 65536 },
                   { provider: 'local', model: 'small' }];
    showing(opened.box);
    opened._harnessFallbacksMount('doca', chain);

    assert.deepEqual(opened.added, chain,
      'every field of a saved rung reaches the form — a dropped window is a deleted one');
    assert.equal(opened.probes(), 2, 'and each configured rung is still checked as the panel opens');

    // The rest of the round trip, through the real renderer: what the rung puts
    // in the box, and what the reader takes back out of it. Pulling the value out
    // of the rendered attribute is what the browser does with `value="…"` — the
    // number is read from the real markup, and no DOM behaviour is invented.
    const shown = e => opened._harnessRungHtml('doca', e)
      .match(/data-role="context-window"[\s\S]*?value="([^"]*)"/)[1];
    showing({ querySelectorAll: () => opened.added.map(e => ({
      querySelector: sel => (sel === '[data-role=provider]' ? { value: e.provider }
        : sel === '[data-role=model]' ? { value: e.model }
        : sel === '[data-role=context-window]' ? { value: shown(e) } : null),
    })) });
    assert.deepEqual(opened._fallbacksRead('doca'), chain,
      'so opening ⚙ and pressing Save writes back the chain that was already there');

    // A chain longer than the cap is still trimmed on the way in, as before.
    const capped = build();
    showing(capped.box);
    capped._harnessFallbacksMount('doca', Array(9).fill({ provider: 'ds', model: 'm' }));
    assert.equal(capped.added.length, 5);
  } finally { global.document = realDocument; }
});

test('the MCP call timeout is a setting the agent can see and propose, and says so when it fires', async () => {
  const { McpClient } = require('../modules/mcp/client');

  // Visible without anything being saved first, the same way paths are.
  const listed = settings.readable().map(r => r.path);
  assert.ok(listed.includes('mcpSettings.callTimeoutMs'));
  assert.ok(listed.includes('mcpSettings.listTimeoutMs'));
  assert.equal(settings.refuse('mcpSettings.callTimeoutMs', 300000), null, 'it is proposable');

  // And the neighbouring key that holds a spawnable command still is not.
  assert.match(settings.refuse('mcpServers.evil', { command: 'sh' }), /not a setting the agent may change/);

  // Proposing it reaches the prefs file only after the click.
  const p = settings.propose({ reason: 'renders take longer than two minutes',
    changes: [{ path: 'mcpSettings.callTimeoutMs', value: 300000 }] });
  assert.equal(McpClient.timeoutFor('call'), 120000, 'nothing changed yet');
  assert.equal((await post(`/api/harness/proposals/${p.id}/apply`)).status, 200);
  assert.equal(McpClient.timeoutFor('call'), 300000, 'and the client reads it live');

  // A nonsense value falls back rather than making every call fail instantly.
  const prefs = loadPrefs();
  prefs.mcpSettings.callTimeoutMs = 5;
  require('../modules/utils').savePrefs(prefs);
  assert.equal(McpClient.timeoutFor('call'), 120000);
});

test('an oversized tool result is clipped and spilled so the model can read_file it', () => {
  const { toApiMessages } = require('../modules/harness/agent');
  const fs = require('node:fs');
  // Over TOOL_MAX_CHARS, so the clip applies. This used to be 8,000 — under the
  // cap — because the old rule clipped every result older than the newest no
  // matter how small, and this test was written against that. The rule is now
  // per row, so a fixture has to actually be oversized to exercise it.
  const big = 'X'.repeat(20000);
  const rows = [
    { role: 'user', content: 'look' },
    // The call travels with its results or neither does (`pairedRows`), so the
    // assistant row belongs in the fixture even though this is about clipping.
    { role: 'assistant', content: '', tool_calls: ['c1', 'c2', 'c3'].map(id => ({ id, function: { name: 'shell', arguments: '{}' } })) },
    { role: 'tool', tool_call_id: 'c1', name: 'shell', content: `old-${big}` },
    { role: 'tool', tool_call_id: 'c2', name: 'shell', content: `mid-${big}` },
    { role: 'tool', tool_call_id: 'c3', name: 'read_file', content: `new-${big}` },
  ];
  const results = toApiMessages(rows, { sessionId: 's_clip' }).filter(m => m.role === 'tool');
  assert.equal(results.length, 3, 'every result still travels');
  assert.match(results[2].content, /full output:/, 'the newest is clipped too, and on its own size');
  assert.match(results[0].content, /full output:/, 'an older one is replaced by a pointer');
  assert.match(results[0].content, /read_file/);
  const m = results[0].content.match(/full output: (.+?) —/);
  assert.ok(m, 'the pointer names a path');
  assert.equal(fs.readFileSync(m[1], 'utf8'), rows[2].content, 'the spilled file is the original text');
});

test('a result under the cap keeps the whole text, however much later output arrives', () => {
  const { toApiMessages } = require('../modules/harness/agent');
  // The other half of the rule, and the half that used to be wrong: the old
  // budget clipped older results whatever their size, so a small result's
  // serialization changed as the prompt filled up. Now a row under the cap is
  // never touched, which is what makes the prefix append-only (ISSUES.md H-9b).
  const small = 'Y'.repeat(4000);
  const round = i => ([
    { role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, function: { name: 'shell', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: `c${i}`, name: 'shell', content: `r${i}-${small}` },
  ]);

  const alone = toApiMessages([...round(1)], { sessionId: 's_small' }).filter(m => m.role === 'tool');
  const later = toApiMessages([...round(1), ...round(2), ...round(3)], { sessionId: 's_small' })
    .filter(m => m.role === 'tool');
  assert.equal(alone[0].content, later[0].content, 'the first result is byte-identical later on');
  assert.equal(later[0].content.length, 4003, 'and still whole');
});

test('a thinking model is given its own reasoning back, and no one else is', () => {
  const { toApiMessages } = require('../modules/harness/agent');
  // DeepSeek's thinking mode returns `reasoning_content` beside `content` and,
  // for any request carrying tools, refuses the turn when an assistant message
  // of that conversation is missing the field (ISSUES.md H-10). So the row keeps
  // it, filed under the provider that produced it, and it goes back on the wire
  // for that provider only: a field another provider never asked for is a
  // refusal from a strict endpoint, and it means nothing there anyway.
  const rows = [
    { role: 'user', content: 'why?' },
    { role: 'assistant', content: 'Because.', reasoning: { provider: 'ds', text: 'weighing it up' } },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'shell', arguments: '{}' } }],
      reasoning: { provider: 'ds', text: 'checking before I speak' } },
    { role: 'tool', tool_call_id: 'c1', name: 'shell', content: 'ok' },
    { role: 'assistant', content: 'Done.' },
  ];

  const toDs = toApiMessages(rows, { sessionId: 's_reason', provider: 'ds' });
  assert.equal(toDs[1].reasoning_content, 'weighing it up', 'the answer keeps its reasoning');
  assert.equal(toDs[1].content, 'Because.', 'and is still the answer');
  assert.equal(toDs[2].reasoning_content, 'checking before I speak', 'a row that called a tool travels too');
  assert.equal(toDs[2].tool_calls.length, 1);
  assert.equal(toDs[4].reasoning_content, undefined, 'a row with no reasoning gains no field');
  assert.equal(toDs[3].reasoning_content, undefined, 'and neither does a tool result');

  const toOther = toApiMessages(rows, { sessionId: 's_reason', provider: 'ollama' });
  assert.equal(toOther[1].reasoning_content, undefined, "another provider is not handed this one's reasoning");
  assert.equal(toOther[2].reasoning_content, undefined);
  assert.equal(toOther[1].content, 'Because.', 'though the text it does own still travels whole');

  // No provider named — a caller that has not thought about providers — echoes
  // nothing rather than everything.
  assert.equal(toApiMessages(rows, { sessionId: 's_reason' })[1].reasoning_content, undefined);
});

test('folding fires on an absolute token budget even with no window declared', () => {
  const p = { contextWindow: 0, compactTokens: 40000, compactAt: 60 };
  assert.equal(budget.shouldCompact(p, 39999), false);
  assert.equal(budget.shouldCompact(p, 40000), true);
  assert.equal(budget.shouldCompact({ contextWindow: 0, compactTokens: 0, compactAt: 60 }, 200000), false,
    'without a budget or a window nothing percentage-based can fire');
  assert.equal(budget.shouldCompact({ contextWindow: 100000, compactTokens: 0, compactAt: 60 }, 60000), true);
});

test('a fold names the setting that caused it, so "47688 of 1000000" stops reading as a bug', () => {
  const p = { contextWindow: 1000000, compactTokens: 40000, compactAt: 60 };
  assert.deepEqual(budget.compactReason(p, 47688), { setting: 'compactTokens', at: 40000 },
    'both triggers are live and the lower one wins');
  assert.deepEqual(budget.compactReason({ ...p, compactTokens: 0 }, 600000), { setting: 'compactAt', at: 600000 });
  assert.equal(budget.compactReason({ ...p, compactTokens: 0 }, 47688), null);
  const { text } = require('../modules/logs').fromHarness({ type: 'compacted', at: 6, contextTokens: 47688,
    contextWindow: 1000000, setting: 'compactTokens', threshold: 40000 });
  assert.match(text, /reached compactTokens \(40000\), window 1000000/);
  assert.match(text, /this one kept word for word/);
});

test('an empty memory search returns pinned facts only, and the prompt stays token-capped', async () => {
  assert.equal(memory.memSearch('', 50).length, 0, 'nothing pinned, nothing injected');
  await callTool('memory_write', { key: 'always-on', value: 'this one is pinned', pinned: true });
  await callTool('memory_write', { key: 'noise-a', value: 'unrelated unpinned fact A' });
  const empty = memory.memSearch('', 50);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].key, 'always-on');

  for (let i = 0; i < 12; i++)
    await callTool('memory_write', { key: `blob-${i}`, value: `zzzz shared ${'W'.repeat(900)}` });
  const prompt = require('../modules/harness/agent').preview({ message: 'zzzz shared' });
  const start = prompt.indexOf('# What you remember');
  const rest = prompt.slice(start + 1);
  const end = rest.search(/\n# /);
  const mem = end < 0 ? rest : rest.slice(0, end);
  assert.ok(mem.length < 9000, `memory block should stay near 2k tokens, got ${mem.length} chars`);
  assert.match(mem, /always-on/);
});


test('the standing rules name tools that exist, and the agent is offered the ones they name', () => {
  // The charter told the agent to use `show_image` for months after the tool it
  // should reach for became `show_media` — a standing instruction pointing at a
  // deprecated alias, which nothing checked because prose is not code. Any
  // backticked snake_case name in the charter is a claim about the tool list.
  const names = new Set(tools.TOOLS.map(t => t.name));
  const offered = new Set(tools.schemas([]).map(s => s.function.name));

  const claimed = [...providers.SAFETY_CHARTER.matchAll(/`([a-z][a-z0-9_]{3,})`/g)].map(m => m[1]);
  assert.ok(claimed.length >= 3, 'the charter names tools; if it stopped, this test is watching nothing');

  for (const name of claimed) {
    assert.ok(names.has(name), `the charter tells the agent to use "${name}", which is not a tool`);
    assert.ok(offered.has(name),
      `the charter names "${name}", which is not in the tool list the agent is given by default`);
    // Existing is not enough, and this is the half that was actually wrong:
    // `show_image` was kept as an alias so old transcripts still worked, and the
    // charter went on naming it — a standing rule pointing at the tool nobody
    // should reach for now.
    const tool = tools.TOOLS.find(t => t.name === name);
    assert.equal(/deprecated/i.test(tool.description), false,
      `the charter tells the agent to use "${name}", which its own description calls deprecated`);
  }

  // And the one that was pointed at the old name: both exist, and the rules
  // name the one that can do all three kinds of media.
  assert.ok(names.has('show_media') && names.has('show_image'));
  assert.match(providers.SAFETY_CHARTER, /show_media/);
});

test('a specialist is told to keep the plan it is always given', () => {
  // `mission_plan` is forced into every specialist's allowlist, and nothing in
  // its prompt asked it to use one — so plans stayed empty and a watch drew
  // "STEP 0" until the mission was over.
  const def = require('../modules/agents/registry').get('archivist');
  const prompt = require('../modules/harness/agent').preview({
    message: 'anything',
    profile: { id: def.id, label: def.label, systemPrompt: def.role, tools: def.tools,
               memory: def.memory, environment: def.environment },
  });
  assert.match(prompt, /mission_plan/, 'the specialist is never told about the plan it maintains');
  assert.match(prompt, /tick/i);
});
