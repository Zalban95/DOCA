'use strict';

/**
 * The panel's roster of what a type holds is what its turns are given (turn/tool-shape.js; audit 2026-10-06, TODO B3).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H        = require('./helpers');
const tools    = require('../modules/harness/tools');
const roster   = require('../modules/harness/tool-roster');
const { disabledFor } = require('../modules/harness/turn/prompt');
const params   = require('../modules/harness/turn/params');
const registry = require('../modules/agents/registry');

test.before(() => H.start());
test.after(async () => { registry.setEnabled(false); await H.stop(); });

function given(type) {
  const profile = type === 'orchestrator' ? require('../modules/harness/organization').profileFor({ kind: 'orchestrator' })
    : type === 'work' ? null : { ...require('../modules/agents/missions').profileOf(registry.get(type)), level: 'specialist' };
  return tools.schemas(disabledFor(profile, params.turnParams(profile))).map(s => s.function.name).filter(n => !n.startsWith('mcp__')).sort();
}

for (const on of [false, true]) {
  test(`roster equals the turn's tools for every type (specialists ${on ? 'on' : 'off'})`, () => {
    registry.setEnabled(on);
    const types = ['orchestrator', 'work', ...registry.list().filter(a => !a.broken).map(a => a.id)];
    for (const type of types) {
      const held = roster.roster(type).held.map(t => t.name).sort();
      assert.deepEqual(held, given(type), type);
    }
  });
}

test('mission tools only on a mission; no alias offered; no computer_login without a computer', () => {
  registry.setEnabled(true);
  for (const type of ['orchestrator', 'work']) {
    const names = given(type);
    for (const n of ['mission_plan', 'scout_report', 'show_image', 'computer_login']) assert.ok(!names.includes(n), `${type}: ${n}`);
  }
  const r = roster.roster('orchestrator');
  assert.match(r.refused.find(t => t.name === 'mission_plan')?.why || '', /specialist on a mission/);
  registry.setEnabled(false);
  assert.match(roster.roster('orchestrator').refused.find(t => t.name === 'agent_dispatch')?.why || '', /specialists are switched off/);
});
