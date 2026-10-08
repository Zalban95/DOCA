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
const untrusted = require('./untrusted');

const TOOLS = [
  ...require('./toolbox/work'),
  ...require('./toolbox/files'),
  ...require('./toolbox/repo'),
  ...require('./toolbox/memory'),
  ...require('./toolbox/settings'),
  ...require('./toolbox/panel'),
  ...require('./toolbox/spending'),
  ...require('./toolbox/agents'),
  ...require('./toolbox/scout'),
  ...require('./toolbox/status'),
  ...require('./toolbox/setup'),
  ...require('./toolbox/hub'),
  ...require('./toolbox/devices'),
  ...require('./toolbox/day'),
  ...require('./toolbox/web'),
  ...require('./toolbox/services'),
  ...require('./toolbox/canvas'),
  ...require('./toolbox/project'),
  ...require('./toolbox/skills'),
  ...require('./toolbox/computers'),
  ...require('./toolbox/vnc'),
  ...require('./toolbox/recipes'),
  ...require('./toolbox/packs'),
  ...require('./toolbox/schedules'),
  ...require('./toolbox/features'),
  ...require('./toolbox/screens'),
  ...require('./toolbox/chronicle'),
];


/** Metadata for the ⚙ panel's per-tool switches, built-in ones then MCP's. */
function describe() {
  return [
    // The first sentence, by the rule the prompt uses: a split on '.' cut "AGENTS.md" and "e.g." in half.
    ...TOOLS.map(t => ({ name: t.name, description: require('./turn/tools-section').firstSentence(t.description, 400).replace(/\.$/, ''), danger: !!t.danger })),
    ...mcp.describe(),
    ...require('../connectors/tools').describe(),
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
/** Old names that still run as their new ones, never offered (turn/tool-shape.js). */
const ALIASES = { show_image: 'show_media', scout: 'model_scout' };

function schemas(disabled = []) {
  // What a switch has off is off for every caller, with or without a profile (turn/tool-shape.js says why).
  const off = [...disabled, ...require('./turn/tool-shape').switches().map(x => x.name)];
  // Each tool's accepted note from this install is added to its description (tool-notes.js).
  return require('./tool-notes').annotate([
    ...TOOLS
      .filter(t => !off.includes(t.name))
      .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    ...mcp.schemas(off),
    ...require('../connectors/tools').schemas(off),   // a connected account is a tool (connectors/tools.js)
  ]);
}

/**
 * Run one tool call. Errors come back as text rather than throwing: a model
 * that gets "no such file" can correct itself, whereas a dead turn cannot.
 * @returns {Promise<string>}
 */
async function call(name, args, disabled = [], ctx = {}) {
  // Counted by the name called, so an old alias's use shows (features/review.js); built-in names only — a computer's
  // or a server's tools would add keys for every computer ever made.
  if (ALIASES[name] || TOOLS.some(t => t.name === name)) require('../features/usage').count(`tool:${name}`);
  name = ALIASES[name] || name;   // an old name: old transcripts and recipes still run
  if (disabled.includes(name)) return `Error: the "${name}" tool is switched off for this harness.`;
  if (ctx.signal?.aborted) return 'Not run: the turn was stopped before this call.';
  const isMcp = mcp.isMcpTool(name);
  const held = isMcp && require('../computers/takeover').before(name);   // a person is driving that computer: DOCA's words, not framed
  if (held) return held;
  const conn = !isMcp && require('../connectors/tools').is(name);
  const tool = isMcp ? { run: a => mcp.call(name, a) } : conn ? { run: (a, c) => require('../connectors/tools').call(name, a, c) } : TOOLS.find(t => t.name === name);
  if (!tool) return `Error: no tool named "${name}".`;
  let out;
  try {
    out = String(await tool.run(args || {}, ctx));
  } catch (e) {
    out = `Error: ${e.message}`;
  }
  audit(name, args, ctx, out);
  // An airlock agent's reading passes the guards before it reads it (guard/airlock.js).
  if (ctx.airlock && ['http_fetch', 'research_docs', 'read_file'].includes(name) && !out.startsWith('Error:')) {
    try { out = await require('./guard/airlock').screenIn(name, args, out); } catch (e) { out = `Error: the guards could not screen this (${e.message}); it was not passed on.`; }
  }
  // Somebody else's words arrive labelled as such (harness/untrusted.js).
  // A paired device's own tools are trusted like the host's: not framed, no re-check (devices-as-hands §3).
  const source = out.startsWith('Error:') || (isMcp && mcp.isTrusted(name)) ? null : untrusted.sourceOf(name, args, isMcp);
  if (source) untrusted.arrived(ctx.signal, name, isMcp);
  const framed = source ? untrusted.frame(source, out) : out;
  return isMcp ? require('../computers/takeover').after(name, framed) : framed;   // a hand-back note, above the frame
}

// Tools that only read (DOCA's own store, files, the web): not audited. Every
// other call a signed-in person's turn makes is, as theirs (docs/design/auth.md §6).
const READS = new Set(['read_file', 'list_dir', 'search_files', 'http_fetch', 'research_docs', 'skill', 'repo_rules']);

/**
 * Whether this call only reads. http_fetch is a read only as GET/HEAD: with a
 * method and a body it sends data out, and counting it as a read skipped the
 * audit and the "ask again after outside text" check — the defence against a
 * page telling the agent to POST its notes somewhere (audit 2026-10-04).
 */
function isRead(name, args = {}) {
  if (!READS.has(name)) return false;
  if (name === 'http_fetch') return ['GET', 'HEAD'].includes(String(args.method || 'GET').toUpperCase());
  return true;
}

function audit(name, args, ctx, out) {
  const approval = require('./approval');
  if (!ctx.user?.id || isRead(name, args) || approval.FREE.has(name)) return;
  try {
    require('../auth/store').audit({ orgId: ctx.user.orgId, actorId: ctx.user.id, via: 'harness', sessionId: ctx.sessionId || null,
      action: `tool ${name}`, detail: approval.summarize(name, args), ok: !out.startsWith('Error:') });
  } catch { /* the audit is a record, not a gate */ }
}

module.exports = { ALIASES, TOOLS, describe, schemas, call, clip, READS, isRead };
