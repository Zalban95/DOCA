'use strict';

/**
 * The Orchestrator's prompt is built from what it holds (turn/orchestrator-prompt.js; audit 2026-10-06, TODO B1):
 * who it is once, one routing table, the specialists it may dispatch, the MCP servers `mcp_connect` points at.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');

const H         = require('./helpers');
const agent     = require('../modules/harness/agent');
const memory    = require('../modules/harness/memory');
const providers = require('../modules/harness/providers');
const paths     = require('../modules/paths');
const specialists = require('../modules/agents/registry');
const mcp       = require('../modules/mcp/registry');

test.before(() => H.start());
test.after(async () => { specialists.setEnabled(false); await H.stop(); });

const main = () => agent.preview({ message: 'x', sessionId: memory.mainSession().id });
const occurrences = (text, re) => (text.match(re) || []).length;

test('it is told who it is once, and routes by one table', () => {
  const t = main();
  assert.equal(occurrences(t, /You are the Orchestrator/g), 1);
  assert.doesNotMatch(t, /You are the DOCA harness/, 'the worker\'s default identity is not the Orchestrator\'s');
  assert.match(t, /# How to route a request/);
  assert.match(t, /\d\. A work chat/);
  const steps = Number(agent.params().orchestratorWorkSteps);
  assert.match(t, new RegExp(`After ${steps} steps of real work`), 'the number is the setting\'s');
  assert.doesNotMatch(t, /\d\. A specialist/, 'no specialist row while specialists are off');
});

test('the owner\'s own harness prompt is kept, as theirs', () => {
  const prefs = JSON.parse(fs.readFileSync(paths.PREFS_FILE, 'utf8') || '{}');
  const doca = { ...(prefs.harness?.config?.doca || {}), systemPrompt: 'Always answer in Italian.' };
  fs.writeFileSync(paths.PREFS_FILE, JSON.stringify({ ...prefs, harness: { ...(prefs.harness || {}), config: { ...(prefs.harness?.config || {}), doca } } }));
  try { assert.match(main(), /# Your owner's instructions\nAlways answer in Italian\./); }
  finally { fs.writeFileSync(paths.PREFS_FILE, JSON.stringify(prefs)); }
  assert.ok(providers.DEFAULT_SYSTEM_PROMPT.startsWith('You are the DOCA harness'));
});

test('with specialists on, every one it may dispatch is named, with the roster', () => {
  specialists.setEnabled(true);
  try {
    const t = main();
    const ids = specialists.list().filter(a => !a.broken).map(a => a.id);
    assert.ok(ids.length);
    for (const id of ids) assert.match(t, new RegExp(`- ${id} \\(`), id);
    assert.match(t, /\d\. A specialist/);
    assert.match(t, /# Specialists you can dispatch/);
  } finally { specialists.setEnabled(false); }
});

test('the MCP servers mcp_connect points at are listed, with whose machine', () => {
  mcp.upsert({ id: 'blender-here', command: process.execPath, args: ['-e', ''] });
  require('../modules/harness/environment').invalidate();   // its 5 s cache
  try {
    const t = main();
    assert.match(t, /## MCP servers\n- blender-here: stopped, on this host/);
  } finally { mcp.remove('blender-here'); }
});
