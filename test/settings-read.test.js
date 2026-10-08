'use strict';

/**
 * settings_read shows every section the agent may propose (deep test B, R13: 14 of 26 were never shown on a fresh
 * install), reads one section by name, and says why a search found nothing (C7: "approv" → "No settings match").
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const tools = require('../modules/harness/tools');
const settings = require('../modules/harness/settings');
const schema = require('../modules/settings-schema');

test('every proposable section is listed, set or not', () => {
  const rows = settings.readable();
  for (const s of schema.settable()) {
    assert.ok(rows.some(r => r.path === s.prefix || r.path.startsWith(`${s.prefix}.`)), `${s.prefix} (${s.label}) is not shown`);
  }
  const theme = rows.find(r => r.path === 'theme');
  assert.match(theme.detail, /Not set yet/);
});

test('a section is read by its name or its path, grouped under its heading', async () => {
  const byName = await tools.call('settings_read', { section: 'MCP timeouts' }, []);
  assert.match(byName, /## MCP timeouts\nmcpSettings\.callTimeoutMs = 120000/);
  assert.match(byName, /mcpSettings\.listTimeoutMs = 20000/);
  assert.doesNotMatch(byName, /^computers\./m);
  const byPath = await tools.call('settings_read', { section: 'computers' }, []);
  assert.match(byPath, /computers\.maxRunning = 4/);
  const words = await tools.call('settings_read', { filter: 'timeout' }, []);
  assert.match(words, /computers\.callTimeoutMs/);
  assert.match(words, /mcpSettings\.callTimeoutMs/);
});

test('nothing found: the sections, and what is the person\'s alone', async () => {
  const out = await tools.call('settings_read', { filter: 'zqxv' }, []);
  assert.match(out, /No settings match "zqxv"/);
  assert.match(out, /The sections are: .*MCP timeouts/);
  assert.match(out, /approval mode \(the Auto \/ Manual switch on Agents → Harness; Approvals beside it\)/);
  // A switch of the person's own is found by its words, with where it is (settings-find.test.js has the rest).
  assert.match(await tools.call('settings_read', { filter: 'approv' }, []), /Approval mode[\s\S]*Theirs to switch, with their password/);
});
