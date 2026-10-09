'use strict';

/**
 * The tool names a client lending a family uses — one name per action, per family (PROTOCOL §22.1; audit 2026-10-06,
 * cl 27; TODO D2b). A skill names a tool once for every client, so this is the contract the apps' MCP servers are held
 * to: docs/api/fixtures/families.json is written from it for their tests, and test/client-fixtures.test.js holds
 * PROTOCOL's table equal to it.
 */
const CANONICAL = {
  shell:     ['shell', 'shell_job'],
  files:     ['files_list', 'files_read', 'files_write', 'files_mkdir', 'files_move', 'files_copy', 'files_delete'],
  screen:    ['screen_capture', 'screen_read', 'screen_press', 'screen_windows'],
  input:     ['input_click', 'input_type', 'input_keys', 'input_move', 'input_swipe'],
  apps:      ['apps_list', 'apps_open'],
  processes: ['processes_list', 'processes_start', 'processes_stop'],
  device:    ['device_info', 'device_notify', 'device_clipboard_read', 'device_clipboard_write', 'device_camera', 'device_location', 'device_sensors'],
  media:     ['media_control'],
  home:      ['home_states', 'home_call', 'home_camera'],   // a home node: Home Assistant kept in the household (§22.4)
};

/** Older names a first-party client still lends, each to be aligned in its next release (§22.1's "→" entries). */
const ALIASES = { input_tap: 'input_click', input_key: 'input_keys', shell_run: 'shell' };

/** Tools that act on what a person sees or types: a decision among them needs `confirm: true` (§22.1, forced-asks.js). */
const DECIDES = ['screen_press', 'input_click', 'input_type', 'input_keys', 'input_swipe'];

/** The family a tool name belongs to, or null. */
const familyOf = name => Object.keys(CANONICAL).find(f => CANONICAL[f].includes(name)) || null;

module.exports = { CANONICAL, ALIASES, DECIDES, familyOf };
