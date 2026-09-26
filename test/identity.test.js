'use strict';

/**
 * Phase 2 of docs/design/agents-and-tools.md: definitions as markdown (ours and
 * Claude Code subagents), and persona.md / human.md.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H        = require('./helpers');
const md       = require('../modules/agents/markdown');
const registry = require('../modules/agents/registry');
const identity = require('../modules/harness/identity');
const agent    = require('../modules/harness/agent');
const memory   = require('../modules/harness/memory');

test.before(() => H.start());
test.after(() => H.stop());

test('a definition is markdown: front matter, then the role — and it survives the round trip', () => {
  const text = `---
name: blender-engineer
label: Blender engineer
description: Builds and renders Blender scenes.
kits: [files, shell, web]
tools:
  - show_media
model: qwen3.8-27b
maxSteps: 9
---
You are the Blender engineer.
You render.`;
  const d = md.parse(text);
  assert.equal(d.id, 'blender-engineer');
  assert.deepEqual(d.kits, ['files', 'shell', 'web']);
  assert.deepEqual(d.tools, ['show_media']);
  assert.equal(d.maxSteps, 9);
  assert.equal(d.role, 'You are the Blender engineer.\nYou render.');
  const again = md.parse(md.format(registry.normalize(d)));
  for (const k of ['id', 'label', 'note', 'role', 'model']) assert.equal(again[k], d[k], k);
  assert.deepEqual(again.kits, d.kits);
});

test('a Claude Code subagent imports as it is: its tools become kits, its model gives way to the panel\'s', () => {
  const d = md.parse(`---
name: code-reviewer
description: Reviews diffs for bugs.
tools: Read, Grep, Glob, Bash, NotebookEdit, mcp__github__search
model: sonnet
---
Review the diff.`);
  assert.deepEqual(d.kits.sort(), ['code', 'files', 'shell']);
  assert.deepEqual(d.tools, []);
  assert.equal(d.model, undefined);
  assert.match(d.imported.join(' '), /mcp__github__search.*left out/);
  assert.match(d.imported.join(' '), /model "sonnet" is Claude Code's/);
});

test('saving writes markdown and moves an older JSON aside; a folder imports without overwriting', async () => {
  const dir = registry.dir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'oldie.json'), JSON.stringify({ id: 'oldie', role: 'Old role.', tools: ['read_file'] }));
  assert.equal(registry.get('oldie').tools[0], 'read_file');
  registry.save({ ...registry.get('oldie'), role: 'New role.', kits: ['files'] });
  assert.ok(fs.existsSync(path.join(dir, 'oldie.md')));
  assert.ok(fs.existsSync(path.join(dir, 'oldie.json.migrated')), 'moved aside, not deleted');
  assert.equal(registry.get('oldie').role, 'New role.');

  const src = fs.mkdtempSync(path.join(H.tmp, 'claude-agents-'));
  fs.writeFileSync(path.join(src, 'writer.md'), '---\nname: writer\ndescription: Writes docs.\ntools: Read, Write\n---\nWrite docs.');
  fs.writeFileSync(path.join(src, 'oldie.md'), '---\nname: oldie\n---\nWould replace.');
  const r = await H.api(null, 'POST', '/api/harness/agent-import', { folder: src });
  assert.equal(r.status, 200);
  const byId = Object.fromEntries(r.body.imported.map(x => [x.id, x]));
  assert.deepEqual(byId.writer.kits, ['files']);
  assert.match(byId.oldie.skipped, /exists/, 'an existing agent is not overwritten unless asked');
  const exp = await H.api(null, 'GET', '/api/harness/agents/writer/export');
  assert.match(String(exp.body), /^---\nname: writer\n/);
});

test('persona.md reaches the Orchestrator, human.md the Orchestrator and work chats — capped, editable', async () => {
  let main = agent.preview({ message: 'x', sessionId: memory.mainSession().id });
  assert.match(main, /# Persona — who you are/);
  assert.match(main, /resident assistant/, 'the shipped persona until one is written');
  assert.match(main, /# The person you work for\nNothing written yet/);

  const r = await H.api(null, 'POST', '/api/harness/identity', { human: 'I build Android apps. Short answers, please.', persona: 'I am calm and brief.' });
  assert.equal(r.status, 200);
  main = agent.preview({ message: 'x', sessionId: memory.mainSession().id });
  assert.match(main, /I am calm and brief\./);
  assert.match(main, /I build Android apps\. Short answers/);
  const work = require('../modules/harness/organization').create({ title: 'W' });
  const w = agent.preview({ message: 'x', sessionId: work.id });
  assert.match(w, /I build Android apps/);
  assert.doesNotMatch(w, /# Persona/, 'the persona is the Orchestrator\'s');
  assert.throws(() => identity.write('human', 'x'.repeat(identity.CAP + 1)), /capped/);
});

test('standard specialists ship as markdown in the repository; a local file of the same id wins; promote writes into the checkout', () => {
  const fs = require('node:fs'), path = require('node:path');
  const shippedIds = fs.readdirSync(registry.SHIPPED_DIR).filter(n => n.endsWith('.md')).map(n => n.replace(/\.md$/, ''));
  assert.deepEqual(shippedIds.sort(), ['archivist', 'coder', 'researcher']);
  for (const id of shippedIds) {
    const a = registry.get(id);
    assert.ok(a && !a.broken && a.builtin, `${id} loads as a shipped definition`);
  }
  assert.deepEqual(registry.get('coder').kits, ['code', 'files', 'shell']);
  // A local override of a shipped type.
  fs.writeFileSync(path.join(registry.dir(), 'researcher.md'), '---\nname: researcher\nkits: [web]\n---\nMy own researcher.');
  assert.equal(registry.get('researcher').role, 'My own researcher.');
  assert.equal(registry.get('researcher').builtin, false);
  // Promote needs a git checkout at DOCA_HOME: this test home is not one, and says so.
  assert.throws(() => registry.promote('researcher'), /not a git checkout/);
});
