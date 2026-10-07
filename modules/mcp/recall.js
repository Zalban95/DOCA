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
    const store = require('../store'), doc = store.readJson(CONNECTED, { ids: [] });
    const ids = new Set(doc.ids), stopped = new Set(doc.stopped || []);
    if (on === undefined) return ids;
    if (on) { ids.add(id); stopped.delete(id); } else { ids.delete(id); stopped.add(id); }
    store.writeJson(CONNECTED, { ids: [...ids], stopped: [...stopped] });
  } catch { /* a record is a convenience, never a failure */ }
  return new Set();
}

/** Whether a person or an agent stopped this server on purpose (until it is started again): a device coming back
 *  does not undo that. */
function stoppedOnPurpose(id) {
  try { return (require('../store').readJson(CONNECTED, { ids: [] }).stopped || []).includes(id); } catch { return false; }
}

module.exports = { rememberTools, lastTools, connected, stoppedOnPurpose };
