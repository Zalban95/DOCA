'use strict';

/** The hub's own commands for the agent (toolbox/hub.js; TODO B6b): listed, run, and the confirm ones asked. */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H     = require('./helpers');
const tools = require('../modules/harness/tools');
test.before(() => H.start());
test.after(() => H.stop());

test('list names the commands with what they need and which are asked; restarting the panel is left out', async () => {
  const out = await tools.call('hub_command', { action: 'list' });
  assert.match(out, /- services\.start: Start inference service \(id, gpu, modelId\) — runs as a job/);
  assert.match(out, /- services\.stop: Stop inference service \(id\) — a person is asked/);
  assert.doesNotMatch(out, /panel\.restart/);
  assert.match(await tools.call('hub_command', { action: 'run', id: 'panel.restart' }), /a person's, from the panel/);
  assert.match(await tools.call('hub_command', { action: 'run', id: 'nope' }), /^Error: No command 'nope'/);
});

test('a confirm command is always put to a person, never "always"; a plain one is not forced', () => {
  const approval = require('../modules/harness/approval');
  const g = approval.gate('hub_command', { action: 'run', id: 'services.stop', params: { id: 'whisper' } });
  assert.equal(g?.forced, true);
  assert.equal(g.keys, null);
  assert.ok(!require('../modules/harness/forced-asks').of('hub_command', { action: 'run', id: 'services.start', params: { id: 'whisper' } }, () => ''));
  assert.ok(require('../modules/agents/registry').NEVER.includes('hub_command'), 'a mission never runs one');
});
