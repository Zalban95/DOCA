'use strict';

/**
 * Tools sent by tier (turn/tool-tiers.js; TODO B2, graduated 2026-10-09): core tools sent in full, the rest named and
 * loaded when needed — what is held never changes. `harness.config.doca.toolsLoading: all` sends everything, as before.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H           = require('./helpers');
const agent       = require('../modules/harness/agent');
const tools       = require('../modules/harness/tools');
const catalog     = require('../modules/harness/catalog');
const tiers       = require('../modules/harness/turn/tool-tiers');
const { disabledFor, systemPrompt } = require('../modules/harness/turn/prompt');

test.before(() => H.start());
test.after(() => H.stop());

const held = id => tools.schemas(disabledFor(null, {}, id));
const work = title => require('../modules/harness/organization').create({ title });
const names = list => list.map(s => s.function.name);

test('by default: core in full, the rest named by kit; a message, a call or tools_more loads one for the conversation', async () => {
  assert.equal(agent.params().toolsLoading, 'tiers', 'tiers are the default');
  const w = work('tiers on');
  let { offered, named } = tiers.split(held(w.id), { sessionId: w.id });
  const sent = names(offered);
  assert.ok(sent.includes('read_file') && sent.includes('tools_more') && !sent.includes('memory_rules_write'));
  assert.ok(named.some(s => s.function.name === 'memory_rules_write'));
  const prompt = agent.preview({ message: 'x', sessionId: w.id });
  assert.match(prompt, /More tools you hold, not loaded yet — call one by name, or tools_more [^\n]*\n(  [^\n]*\n)*?  Memory: [^\n]*memory_rules_write/);
  assert.ok(!/\n  memory_rules_write: /.test(prompt), 'a named tool is not described as if it were sent');

  tiers.split(held(w.id), { sessionId: w.id, text: 'please use canvas for this' });
  assert.ok(tiers.attached(w.id).has('canvas'), 'named in the message');

  assert.match(await tools.call('tools_more', { names: ['schedule', 'nonsense'] }, [], { sessionId: w.id }), /Loaded from your next step: schedule\. Not tools you hold: nonsense/);
  ({ offered } = tiers.split(held(w.id), { sessionId: w.id }));
  assert.ok(offered.some(s => s.function.name === 'schedule'));

  assert.equal(tiers.heldNotSent('memory_flag', []), true, 'held but not sent still runs when called');
  tiers.afterCall(w.id, null, 'memory_flag', 'ok', []);
  assert.ok(tiers.attached(w.id).has('memory_flag'), 'and stays loaded');
  tiers.afterCall(w.id, null, 'skill', 'android-app: … uses computer …', [], { action: 'list' });
  assert.ok(!tiers.attached(w.id).has('computer'), 'a list of skills loads nothing: the prompt stays the same bytes');
  tiers.afterCall(w.id, null, 'skill', 'Step 2: keep it with `pack` {save}.', [], { action: 'read' });
  assert.ok(tiers.attached(w.id).has('pack'), 'a skill read that names a tool loads it');
  tiers.afterCall(w.id, null, 'recipe', 'Steps: 1. remind {at}', [], { action: 'show' });
  assert.ok(tiers.attached(w.id).has('remind'), 'a recipe shown that names a tool loads it');

  const specialist = { id: 'x', level: 'specialist', tools: ['read_file'] };
  assert.equal(tiers.split(held(w.id), { sessionId: w.id, profile: specialist }).named.length, 0, 'specialists keep their own lists');
});

test('an old name is never sent as a schema: show_image runs as show_media, unoffered', () => {
  const w = work('aliases');
  for (const how of ['tiers', 'all']) {
    catalog.saveConfig(catalog.BUILTIN_ID, { toolsLoading: how });
    try {
      const all = names(tools.schemas(disabledFor(null, agent.params(), w.id)));
      for (const alias of Object.keys(tools.ALIASES)) assert.ok(!all.includes(alias), `${alias} sent as a schema (${how})`);
    } finally { catalog.saveConfig(catalog.BUILTIN_ID, { toolsLoading: 'tiers' }); }
  }
});

test('a spoken turn sends its front kit whole and describes only that kit; the rules follow what it holds', () => {
  const front = require('../modules/harness/turn/front');
  const w = work('front');
  const p = agent.params();
  const disabled = front.offOutside(disabledFor(null, p, w.id));
  const kit = tools.schemas(disabled);
  const client = { name: 'Watch', kind: 'phone', formFactor: 'watch', mode: 'assistant', front: true };
  const { offered, named } = tiers.split(kit, { sessionId: w.id, client });
  assert.deepEqual(names(offered).sort(), names(kit).filter(n => !n.startsWith('mcp__')).sort(), 'every built-in of the kit is sent');
  assert.equal(named.filter(s => !s.function.name.startsWith('mcp__')).length, 0);
  const prompt = systemPrompt({ p, userText: 'what time is it', client, sessionId: w.id, disabled, toolCount: offered.length, disabledCount: disabled.length });
  assert.match(prompt, new RegExp(`# Your tools — ${offered.length}, by kit`), 'the prompt describes the kit, not every tool');
  assert.ok(!/\n  shell: /.test(prompt), 'a tool outside the kit is not described');
  assert.ok(!prompt.includes('## Working on a repository'), 'no repository rules for a turn that holds no repository tool');
  const full = systemPrompt({ p, userText: 'x', sessionId: w.id, toolCount: 1, disabledCount: 0 });
  assert.ok(full.includes('## Working on a repository'), 'a turn holding shell keeps them');
});

test('toolsLoading all: every held tool in full, nothing named, and tools_more is not offered', () => {
  catalog.saveConfig(catalog.BUILTIN_ID, { toolsLoading: 'all' });
  try {
    const w = work('tiers off');
    const { offered, named } = tiers.split(held(w.id), { sessionId: w.id });
    assert.equal(named.length, 0);
    assert.ok(!offered.some(s => s.function.name === 'tools_more'));
    assert.ok(names(offered).includes('memory_rules_write'));
  } finally { catalog.saveConfig(catalog.BUILTIN_ID, { toolsLoading: 'tiers' }); }
});

test('the system prompt is byte-identical across steps and turns when nothing changed (the cached prefix holds)', () => {
  const w = work('prefix');
  const p = agent.params();
  const a = systemPrompt({ p, userText: 'what is in the workspace?', sessionId: w.id, toolCount: 1, disabledCount: 0 });
  const b = systemPrompt({ p, userText: 'what is in the workspace?', sessionId: w.id, toolCount: 1, disabledCount: 0 });
  assert.equal(a, b, 'two steps of one turn');
  const main = require('../modules/harness/memory').mainSession().id;
  assert.equal(agent.preview({ message: 'hello', sessionId: main }), agent.preview({ message: 'hello', sessionId: main }), 'two turns of the Orchestrator');
});
