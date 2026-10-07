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

module.exports = { rememberTools, lastTools };
