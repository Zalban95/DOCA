'use strict';

/**
 * A prompt names only tools its turn holds (audit 2026-10-06, aw 29; TODO B4b): "dispatch the scout", "call
 * research_docs first" or "mcp_connect starts it" in a turn that holds none of them sends a smaller model looking for
 * a tool that is not there. Every backticked tool name in a rendered prompt — outside the charter, which B8 renders
 * per reader — must be one the turn holds, for the Orchestrator and a work chat, with specialists off and on.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H = require('./helpers');
test.before(() => H.start());
test.after(async () => { require('../modules/agents/registry').setEnabled(false); await H.stop(); });

test('every tool a prompt names in backticks is one the turn holds', () => {
  const agent = require('../modules/harness/agent');
  const memory = require('../modules/harness/memory');
  const org = require('../modules/harness/organization');
  const tools = require('../modules/harness/tools');
  const { disabledFor } = require('../modules/harness/turn/prompt');
  const params = require('../modules/harness/turn/params');
  const { promptParts } = require('../modules/harness/turn/introspect');
  const all = new Set(tools.TOOLS.map(t => t.name));
  const bad = [];
  for (const on of [false, true]) {
    require('../modules/agents/registry').setEnabled(on);
    for (const [label, id, profile] of [['orchestrator', memory.mainSession().id, org.profileFor({ kind: 'orchestrator' })], ['work chat', org.create({ title: 'coherence' }).id, null]]) {
      const held = new Set(tools.schemas(disabledFor(profile, params.turnParams(profile), id)).map(s => s.function.name));
      for (const [name, text] of promptParts(agent.preview({ message: 'x', sessionId: id }))) {
        if (name === 'safety charter') continue;
        for (const m of text.matchAll(/`([a-z_]+)`/g)) if (all.has(m[1]) && !held.has(m[1])) bad.push(`${label} (specialists ${on ? 'on' : 'off'}), ${name}: ${m[1]}`);
      }
    }
  }
  assert.deepEqual([...new Set(bad)], []);
});
