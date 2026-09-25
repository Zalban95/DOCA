'use strict';

/**
 * The tools the built-in harness can call.
 *
 * Each entry is an OpenAI-style function declaration plus a `run` that returns
 * a string for the model. Output is always bounded — one `find /` would
 * otherwise blow the context window on a single call.
 *
 * Reach is deliberately the same as the rest of the panel already gives a
 * browser session (a shell, the file manager's roots, system status), and every
 * tool can be switched off individually in the harness ⚙ panel.
 */

// The tools live in ./toolbox, one group per file. Their order here is the order
// the model sees them in, which is part of the cached prompt prefix: do not
// reorder without a reason.
const mcp      = require('../mcp/tools');
const { clip } = require('./toolbox/common');

const TOOLS = [
  ...require('./toolbox/work'),
  ...require('./toolbox/files'),
  ...require('./toolbox/repo'),
  ...require('./toolbox/memory'),
  ...require('./toolbox/settings'),
  ...require('./toolbox/agents'),
  ...require('./toolbox/status'),
  ...require('./toolbox/devices'),
  ...require('./toolbox/web'),
];


/** Metadata for the ⚙ panel's per-tool switches, built-in ones then MCP's. */
function describe() {
  return [
    ...TOOLS.map(t => ({ name: t.name, description: t.description.split('.')[0], danger: !!t.danger })),
    ...mcp.describe(),
  ];
}

/** The tool declarations to send to the model, minus anything switched off. */
/**
 * The tool list, minus anything switched off.
 *
 * The dispatch pair is not in it while specialist agents are off — the list is
 * rebuilt every step, so a flag nobody has turned on costs nothing and offers
 * nothing. That is also what makes rolling the feature back a settings change
 * rather than a release.
 */
function schemas(disabled = []) {
  const off = require('../agents/registry').enabled()
    ? disabled
    : [...disabled, 'agent_dispatch', 'agent_results', 'agent_resume'];
  return [
    ...TOOLS
      .filter(t => !off.includes(t.name))
      .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    ...mcp.schemas(off),
  ];
}

/**
 * Run one tool call. Errors come back as text rather than throwing: a model
 * that gets "no such file" can correct itself, whereas a dead turn cannot.
 * @returns {Promise<string>}
 */
async function call(name, args, disabled = [], ctx = {}) {
  if (disabled.includes(name)) return `Error: the "${name}" tool is switched off for this harness.`;
  if (mcp.isMcpTool(name))     return mcp.call(name, args);

  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return `Error: no tool named "${name}".`;
  try {
    return String(await tool.run(args || {}, ctx));
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

module.exports = { TOOLS, describe, schemas, call, clip };
