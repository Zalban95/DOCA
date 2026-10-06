'use strict';

/**
 * What the agent knows about where it is running, assembled fresh each turn.
 *
 * Everything here is read in-process — os counters, the prefs file, the paths
 * registry, the MCP client states. Nothing shells out and nothing is fetched,
 * because this is built on every step of every turn and an agent that pauses
 * two seconds to say hello is worse than one that has to call `system_status`
 * for live docker and GPU figures. That tool is still there for exactly that.
 *
 * The short TTL is for the tool loop: eight steps rebuild the prompt eight
 * times and the answers cannot have changed. Anything that *does* change it
 * from the inside — an applied settings proposal — calls `invalidate()`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const paths     = require('../paths');
const store     = require('../store');
const providers = require('./providers');

const TTL_MS = 5000;

let cached = null;
let cachedAt = 0;

function invalidate() { cached = null; }

function version() {
  try { return require('../../package.json').version; }
  catch { return 'unknown'; }
}

/** Whole GB, except for the small numbers where "0 GB free" would be a lie. */
function gb(bytes) {
  const n = bytes / 1e9;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} GB`;
}

function duration(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

/**
 * MCP servers by state and tool count only.
 *
 * Not the command, not the environment: a server's `env` is where somebody put
 * a token, and this text goes to a model that may not be running on this
 * machine. The MCP tab shows the whole definition to the person who typed it.
 */
/** Tool names in a line: families by their prefix (files_* ×7), so a 40-tool server costs one line of the prompt. */
function toolSummary(names) {
  const groups = new Map();
  for (const n of names) { const k = n.includes('__') ? `${n.split('__')[0]}__*` : /_/.test(n) ? `${n.split('_')[0]}_*` : n; groups.set(k, (groups.get(k) || 0) + 1); }
  return [...groups].map(([k, c]) => (c > 1 ? `${k} ×${c}` : k.endsWith('*') ? names.find(n => n.startsWith(k.slice(0, -1))) : k)).join(', ');
}

function mcpServers() {
  try {
    return require('../mcp/registry').list().map(s => ({
      id: s.id, label: s.label, state: s.state, tools: s.toolCount || 0,
      // Which machine its tools act on. A file the agent writes through a
      // client's server lands on that client, not on the host it is reading
      // paths from, and an agent that cannot tell them apart will confuse the
      // two the first time both offer a `read_file`.
      origin: s.origin?.kind === 'client' ? 'client' : 'server',
      last: s.state === 'running' ? null : require('../mcp/registry').lastTools(s.id)?.names || null,
      originLabel: s.originLabel || null,
    }));
  } catch { return []; }
}

function harnessInfo() {
  try {
    const catalog = require('./catalog');
    const id  = catalog.defaultId();
    const cfg = catalog.configFor(id);
    return { id, config: cfg };
  } catch { return { id: null, config: {} }; }
}

/**
 * The facts, as data. Also served to the browser so the user can read exactly
 * what their agent is being told about their machine.
 */
function snapshot() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;

  const harness = harnessInfo();
  cached = {
    host: {
      hostname: os.hostname(),
      platform: `${process.platform} ${process.arch}`,
      release:  os.release(),
      cores:    os.cpus().length,
      cpu:      os.cpus()[0]?.model || 'unknown',
      totalMem: os.totalmem(),
      freeMem:  os.freemem(),
      load:     os.loadavg().map(n => n.toFixed(2)),
      uptime:   os.uptime(),
      user:     os.userInfo().username,
      home:     paths.HOME,
      shell:    process.env.SHELL || null,
    },
    doca: {
      version:   version(),
      node:      process.version,
      port:      paths.PORT,
      root:      path.join(__dirname, '..', '..'),
      dataDir:   store.DATA_DIR,
      prefsFile: paths.PREFS_FILE,
      pid:       process.pid,
      uptime:    Math.round(process.uptime()),
    },
    paths: paths.describe().map(p => ({
      key: p.key, value: p.value, source: p.source, exists: p.exists, pending: p.pending, note: p.note,
    })),
    providers: providers.list().map(p => ({ id: p.id, label: p.label, local: p.local, hasKey: p.hasKey })),
    harness,
    mcp: mcpServers(),
  };
  cachedAt = Date.now();
  return cached;
}

/* ── The prompt block ─────────────────────────────────── */

/**
 * The same facts as prose the model reads.
 *
 * Deliberately not JSON: this is prepended to every turn, and a table of key:
 * value lines costs a third of the tokens of the equivalent object while models
 * follow it just as well. Sections with nothing to say are left out rather than
 * stated as empty, so "no MCP servers" does not read as a fact worth acting on.
 *
 * **Everything in here is a fact, not a reading.** This block sits near the
 * front of every prompt and is rebuilt on every step of every turn, so anything
 * that changes by the second would change the first bytes of the prompt each
 * time — which is exactly the prefix a provider's cache, and a local runtime's
 * prefill, match on. Clock, memory and load therefore live in `live()`, which
 * is sent after the history. It costs nothing and it is easy to undo by
 * accident, so: new facts go here, new readings go in `live()`.
 *
 * `test/harness-awareness.test.js` pins this — two calls a second apart must
 * come back byte-identical, with no clock anywhere in the block.
 */
function block({ provider, model, toolCount, disabledCount } = {}) {
  const s = snapshot();
  const out = ['# Environment'];

  out.push(
    `host: ${s.host.hostname} — ${s.host.platform}, ${s.host.cores} cores, ${gb(s.host.totalMem)} RAM`,
    // Which shell `shell` types into, as a standing fact. This panel runs on
    // Linux and on Windows, and a model that assumes bash on a PowerShell host
    // writes `&&` and `/` into every command and cannot tell why they fail.
    // It is stated once here and again in the tool's own description.
    `shell: ${require('../shell').describe()}`,
    `user: ${s.host.user} (home ${s.host.home})`,
    `panel: DOCA v${s.doca.version} on node ${s.doca.node}, port ${s.doca.port}, pid ${s.doca.pid}`,
    `panel code: ${s.doca.root} (its own source — read it before answering questions about how DOCA works)`,
    `panel state: prefs ${s.doca.prefsFile}, data ${s.doca.dataDir}`,
  );

  if (provider) {
    out.push(`you are running on: ${provider} / ${model || '(model unset)'}`
      + (toolCount ? `, ${toolCount} tools available${disabledCount ? `, ${disabledCount} switched off` : ''}` : ''));
  }
  // Whether this model may release DOCA unasked (CONSTITUTION W2, modules/releasing.js): the agents it is for could not
  // reach the route that says so (host, a person's session) — audit 2026-10-06, coh F16. A fact of the settings, so stable.
  if (model) {
    try {
      const r = require('../releasing').check(model);
      out.push(`releasing DOCA: ${r.unasked ? `this model may merge, tag, push and switch the live panel without asking (rule "${r.rule}")` : 'this model asks a person before merging, tagging, pushing or switching the live panel'} — the admin's setting, Settings → Developer → Releasing`);
    } catch { /* no rules readable */ }
  }

  out.push('', '## Paths this panel manages');
  for (const p of s.paths) {
    const flags = [p.source, p.exists ? 'present' : 'MISSING', p.pending ? 'saved since boot, needs a restart' : '']
      .filter(Boolean).join(', ');
    out.push(`- ${p.key} = ${p.value} (${flags})`);
  }

  const keyed = s.providers.filter(p => p.hasKey);
  if (keyed.length) {
    out.push('', '## Model providers configured');
    out.push(keyed.map(p => `${p.id}${p.local ? ' (local)' : ''}`).join(', '));
  }

  out.push(...mcpSection(s.mcp));

  return out.join('\n');
}

/**
 * The readings, kept out of the facts above.
 *
 * Everything here changes between steps: the clock to the millisecond, the
 * load average, the uptimes. These used to end `block()`, which was the right
 * instinct applied at the wrong scale — the invariant that matters is not
 * "volatile last within this block" but "volatile last within the request".
 * `block()` is only the third of thirteen blocks in the system prompt, so
 * everything after it — memory, limits, settings, missions, the whole
 * transcript — sat downstream of a byte that moves every step.
 *
 * Measured cost of getting that wrong: the provider's prefix cache stopped
 * exactly here. 5,779 bytes of request were byte-identical and 1,152 tokens
 * were cached, on every step, forever, because that is where the clock is
 * (ISSUES.md H-9). The fix is position, not content: same words, same facts,
 * sent after the history instead of before it.
 */
function live() {
  const s = snapshot();
  return ['## Right now',
    `time: ${new Date().toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    `memory: ${gb(s.host.freeMem)} free of ${gb(s.host.totalMem)}, load ${s.host.load.join(' ')}`,
    `uptime: host ${duration(s.host.uptime)}, panel ${duration(s.doca.uptime)}`,
  ].join('\n');
}

/**
 * The MCP servers: each one's state, which machine it is on, what it offers when stopped. Shared by the full
 * environment block and the Orchestrator's brief (turn/orchestrator-prompt.js), which used to name none of them
 * while `mcp_connect` told it "the environment lists them" (audit 2026-10-06, aw 2).
 */
function mcpSection(mcp = snapshot().mcp, { held = null } = {}) {   // held: the turn's tool names, when known
  if (!mcp.length) return [];
  const s = { mcp };
  const out = ['', '## MCP servers'];
  for (const m of s.mcp)
    out.push(`- ${m.id}: ${m.state}${m.state === 'running' ? `, ${m.tools} tools (called mcp__${m.id}__*)` : ''}`
      + (m.origin === 'client'
        ? `, hosted by ${m.originLabel} — a separate machine; its tools act there`
        : ', on this host — the same machine as your shell')
      + (m.state === 'running' ? '' : `${m.last ? `; when connected it offered ${toolSummary(m.last)}` : ''} — \`mcp_connect\` starts it`));

  if (s.mcp.some(m => m.state === 'running') && (!held || held.has('research_docs')))
    out.push('When a running server\'s tools are unfamiliar, learn it from its own documentation with '
      + '`research_docs` before guessing at parameter names — a separate reader takes the pages so they never '
      + 'enter this conversation. Do not put anything about this system into a page you fetch.');

  // Only when both kinds are present. With everything in one place this is
  // four lines of prompt explaining a distinction that does not yet exist,
  // and the per-tool descriptions already carry the short version.
  if (s.mcp.some(m => m.origin === 'client') && s.mcp.some(m => m.origin === 'server'))
    out.push(
      '',
      'Two kinds of MCP server, and the difference decides where your work lands:',
      '- On this host: same filesystem, same processes and same `localhost` as your `shell`, `read_file` and `system_status`. You can verify what it did by other means.',
      '- Hosted by a client: another machine over the network. Its paths, its screen, its programs, and **its** `localhost` — a port a client\'s tool talks to is a port on that machine, not here, and nothing you run with `shell` can see it. You have no other way in: if that server is stopped, `mcp_connect` starts it (a person set it up); if its machine is asleep or its client is not running, its tools are gone, and the person to ask is whoever is at that machine.',
      '- A tool name with two segments after the server id (`mcp__<client>__<their-server>__<tool>`) is a server that machine hosts in turn, so it runs there and is subject to that machine\'s consent switches as well.');
  return out;
}

module.exports = { snapshot, block, live, invalidate, mcpSection };
