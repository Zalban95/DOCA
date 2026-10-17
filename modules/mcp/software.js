'use strict';

/**
 * Software for a job (R2b, the owner's answer of 2026-10-13): what people use for a job, open or proprietary, side by
 * side, each marked by what it is and offered the way that fits here — never one pushed, nobody singled out.
 *   connected  DOCA already reaches it (its MCP server is added, or the account is connected)
 *   connect    it is here, and there is a way in: add its MCP server, or connect the account in Field → Connectors
 *   here       it is installed on the hub, and DOCA has no way into it yet: said, nothing offered
 *   install    absent, and this panel installs it itself (catalog-craft.js, checked against its sums)
 *   download   absent: its maker's own page
 * Ordered by what is here first, then by name. Read only: GET /api/mcp/software[?job=] (the MCP routes, a host's).
 */
const fs = require('fs');
const path = require('path');
const { JOBS, OPTIONS } = require('./software-list');

/** The names of a folder's entries, once per call, lower-cased; [] when it is not there. */
function lister() {
  const seen = new Map();
  return dir => {
    if (!seen.has(dir)) { let n = []; try { n = fs.readdirSync(dir).map(x => x.toLowerCase()); } catch { /* absent */ } seen.set(dir, n); }
    return seen.get(dir);
  };
}

/** Whether a program is installed on this machine, by its row's `find` and this OS. */
function installed(o, { platform = process.platform, which = require('../shell').which, ls = lister(), env = process.env } = {}) {
  const f = o.find || {};
  if (o.mcp && require('./catalog-craft').cliOf(o.mcp, o.name)) return true;
  if ((f.bin || []).some(b => which(b))) return true;
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const under = (root, names) => (names || []).some(n => {
    const parts = n.split('\\');
    const leaf = parts.pop().toLowerCase();
    return ls(join(root, ...parts)).some(e => e.startsWith(leaf));
  });
  if (platform === 'darwin') return under('/Applications', f.mac);
  if (platform === 'win32') return [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean).some(r => under(r, f.win));
  return false;
}

function stateOf(o, opts = {}) {
  const here = !o.web && installed(o, opts);
  if (o.mcp) {
    const added = !!require('./registry').get(o.mcp);
    // Missing: the panel installs only what its catalogue can (the Craft suite); anything else, its maker's page.
    return added ? 'connected' : here ? 'connect' : require('./catalog').get(o.mcp)?.installable ? 'install' : 'download';
  }
  if (o.account) {
    const acc = require('../connectors/vault').view(o.account);
    if (acc.connected) return 'connected';
    return here || o.web ? 'connect' : 'download';
  }
  return here ? 'here' : 'download';
}

const RANK = { connected: 0, connect: 1, here: 2, install: 3, download: 3 };

/** The choices for a job (or every job), each {name, marks, site, state, mcp?, account?}. */
function forJob(job, opts = {}) {
  const platform = opts.platform || process.platform;
  const ls = opts.ls || lister();
  return OPTIONS.filter(o => (!job || o.jobs.includes(job)) && (!o.os || o.os === platform))
    .map(o => ({ name: o.name, jobs: o.jobs, marks: o.marks, site: o.site, state: stateOf(o, { ...opts, ls }),
      ...(o.mcp ? { mcp: o.mcp, transport: require('./catalog').get(o.mcp)?.transport || 'stdio' } : {}), ...(o.account ? { account: o.account } : {}), ...(o.web ? { web: true } : {}) }))
    .sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name));
}

function jobs() { return JOBS.map(([id, label]) => ({ id, label })); }

module.exports = { jobs, forJob, installed };
