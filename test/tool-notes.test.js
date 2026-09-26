'use strict';

/**
 * Tool notes (harness/tool-notes.js): proposed by the agent, applied by the
 * person's click, added to the tool's description, flagged when the tool changes.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H        = require('./helpers');
const tools    = require('../modules/harness/tools');
const settings = require('../modules/harness/settings');
const notes    = require('../modules/harness/tool-notes');
const { loadPrefs, savePrefs } = require('../modules/utils');

test.before(() => H.start());
test.after(() => H.stop());

const desc = name => tools.schemas([]).find(s => s.function.name === name).function.description;

test('a note is proposed, waits for the click, and is then in the tool\'s description', async () => {
  const out = await tools.call('tool_note', { action: 'propose', tool: 'shell', note: 'On this host, docker needs sudo -n; use it.', reason: 'docker ps failed with permission denied' });
  assert.match(out, /once the person accepts it/);
  assert.doesNotMatch(desc('shell'), /Note from this install/, 'nothing changes before the click');
  const p = settings.list().pending.at(-1);
  assert.equal(p.changes[0].path, 'toolNotes.shell');
  assert.equal(p.changes[0].section, 'Tool note');

  const r = await H.api(null, 'POST', `/api/harness/proposals/${p.id}/apply`);
  assert.equal(r.status, 200);
  assert.match(desc('shell'), /\nNote from this install: On this host, docker needs sudo -n; use it\.$/);
  assert.match(await tools.call('tool_note', { action: 'list' }), /shell: On this host/);
});

test('a note written before the tool changed is said to be possibly out of date', () => {
  const prefs = loadPrefs();
  prefs.toolNotes.shell.fp = 'something-else';
  savePrefs(prefs);
  assert.match(desc('shell'), /Note from this install \(written before this tool last changed — may be out of date\)/);
});

test('bounded, well-formed, and never a specialist\'s to propose', async () => {
  assert.match(await tools.call('tool_note', { action: 'propose', tool: 'shell', note: 'x'.repeat(notes.MAX + 1) }), /at most 500 characters/);
  assert.match(await tools.call('tool_note', { action: 'propose', tool: 'nope', note: 'x' }), /No tool called "nope"/);
  assert.match(String(settings.propose.length >= 0 && (() => { try { settings.propose({ changes: [{ path: 'toolNotes.shell', value: 'plain string' }] }); } catch (e) { return e.message; } })()), /is \{ text, fp, at \}/);
  assert.ok(require('../modules/agents/registry').NEVER.includes('tool_note'));
});
