'use strict';

/**
 * What the registry remembers about its servers between runs (moved out of registry.js, which is at its size limit).
 */

/**
 * The tool names a server offered when it last ran, kept so the agent knows what a stopped one would give it (the
 * environment block names them, and `mcp_connect` starts it). Names only — never schemas or results.
 */
const LAST_TOOLS = 'mcp-last-tools';
function rememberTools(id, tools) {
  try {
    const store = require('../store');
    store.writeJson(LAST_TOOLS, { ...store.readJson(LAST_TOOLS, {}), [id]: { names: (tools || []).map(t => t.name).slice(0, 400), at: new Date().toISOString() } });
  } catch { /* a cache */ }
}
function lastTools(id) { try { return require('../store').readJson(LAST_TOOLS, {})[id] || null; } catch { return null; } }

/**
 * What was connected when DOCA last stopped (2.269.0): a version switch or a restart dropped every server that is not
 * "start with DOCA", so a phone's tools vanished from the agent at each update until someone reconnected it. A start
 * records the server and a stop by a person or an agent forgets it; shutting down does neither. `on` undefined reads.
 */
const CONNECTED = 'mcp-connected';
function connected(id, on) {
  try {
    const store = require('../store'), ids = new Set(store.readJson(CONNECTED, { ids: [] }).ids);
    if (on === undefined) return ids;
    if (on) ids.add(id); else ids.delete(id);
    store.writeJson(CONNECTED, { ids: [...ids] });
  } catch { /* a record is a convenience, never a failure */ }
  return new Set();
}

module.exports = { rememberTools, lastTools, connected };
