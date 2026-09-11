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
function mcpServers() {
  try {
    return require('../mcp/registry').list().map(s => ({
      id: s.id, label: s.label, state: s.state, tools: s.toolCount || 0,
      // Which machine its tools act on. A file the agent writes through a
      // client's server lands on that client, not on the host it is reading
      // paths from, and an agent that cannot tell them apart will confuse the
      // two the first time both offer a `read_file`.
      origin: s.origin?.kind === 'client' ? 'client' : 'server',
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
 */
function block({ provider, model, toolCount, disabledCount } = {}) {
  const s = snapshot();
  const out = ['# Environment'];

  out.push(
    `host: ${s.host.hostname} — ${s.host.platform}, ${s.host.cores} cores, `
      + `${gb(s.host.totalMem)} RAM (${gb(s.host.freeMem)} free), up ${duration(s.host.uptime)}`,
    `user: ${s.host.user} (home ${s.host.home})`,
    `now: ${new Date().toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    `panel: DOCA v${s.doca.version} on node ${s.doca.node}, port ${s.doca.port}, pid ${s.doca.pid}, `
      + `up ${duration(s.doca.uptime)}`,
    `panel code: ${s.doca.root} (its own source — read it before answering questions about how DOCA works)`,
    `panel state: prefs ${s.doca.prefsFile}, data ${s.doca.dataDir}`,
  );

  if (provider) {
    out.push(`you are running on: ${provider} / ${model || '(model unset)'}`
      + (toolCount ? `, ${toolCount} tools available${disabledCount ? `, ${disabledCount} switched off` : ''}` : ''));
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

  if (s.mcp.length) {
    out.push('', '## MCP servers');
    for (const m of s.mcp)
      out.push(`- ${m.id}: ${m.state}${m.state === 'running' ? `, ${m.tools} tools (called mcp__${m.id}__*)` : ''}`
        + (m.origin === 'client' ? `, runs on ${m.originLabel} — its tools act on that machine, not this one` : ''));
  }

  return out.join('\n');
}

module.exports = { snapshot, block, invalidate };
