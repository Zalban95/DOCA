'use strict';

/**
 * An agents' computer waits longer on a call than any other MCP server, by a setting of its own
 * (computers.callTimeoutMs; self-test 2026-10-08, #6), and a timeout names the setting that set it.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers'); // Isolated data, prefs and provider files.
const { loadPrefs, savePrefs } = require('../modules/utils');
const { timeoutFor, settingFor } = require('../modules/mcp/timeouts');
const { McpClient } = require('../modules/mcp/client');

const set = patch => savePrefs({ ...loadPrefs(), ...patch });

test('a computer\'s tool calls wait ten minutes by default; every other server keeps its two', () => {
  set({ mcpSettings: {}, computers: {} });
  assert.equal(timeoutFor('call', 'computer-4631d4f7'), 600000);
  assert.equal(timeoutFor('call', 'blender'), 120000, 'the global default is left alone');
  assert.equal(timeoutFor('list', 'computer-4631d4f7'), 20000, 'listing tools is not a long job');
  assert.equal(McpClient.timeoutFor('call', 'computer-ab12'), 600000);
});

test('each is its own setting', () => {
  set({ mcpSettings: { callTimeoutMs: 30000 }, computers: { callTimeoutMs: 900000 } });
  assert.equal(timeoutFor('call', 'computer-4631d4f7'), 900000);
  assert.equal(timeoutFor('call', 'desk'), 30000);
  set({ mcpSettings: {}, computers: {} });
});

test('a timeout names the setting that set it', () => {
  assert.equal(settingFor('tools/call', 'computer-4631d4f7'), 'computers.callTimeoutMs');
  assert.equal(settingFor('tools/call', 'desk'), 'mcpSettings.callTimeoutMs');
  assert.equal(settingFor('tools/list', 'computer-4631d4f7'), 'mcpSettings.listTimeoutMs');
});

test('the agent can see and propose it, like the MCP timeouts', () => {
  const settings = require('../modules/harness/settings');
  const row = settings.readable().find(r => r.path === 'computers.callTimeoutMs');
  assert.ok(row, 'listed with its effective value');
  assert.equal(row.value, 600000);
  assert.equal(settings.refuse('computers.callTimeoutMs', 900000), null);
});
