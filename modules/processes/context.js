'use strict';

/**
 * What DOCA knows that names a process (group.js reads it): its projects and the workspace, the containers (the
 * agents' computers and DOCA's inference services among them, each with who started it — machines/origin.js), its own
 * pids (this hub, its MCP servers, its llama.cpp servers), the agents' background jobs, and the ports with a page or a
 * tab behind them (a page a job serves, a service's port, a llama.cpp server's). Each part fails alone to nothing; the
 * containers are asked at most every CONTAINERS_MS, so a drawer polling every 3 s does not run `docker ps` each time.
 */
const fs = require('fs');
const path = require('path');

const CONTAINERS_MS = 10000;
let _containers = { at: 0, list: [] };
const _git = new Map();   // folder → repository root or null, kept while the drawer is open (reset in index.js)

const tryOr = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

function projects() {
  const out = tryOr(() => require('../projects/store').list().filter(p => p.root).map(p => ({ name: p.name || path.basename(p.root), root: p.root })), []);
  const ws = tryOr(() => require('../paths').describe().find(p => p.key === 'WORKSPACE_DIR')?.value, null);
  if (ws) out.push({ name: 'Workspace', root: ws, workspace: true });
  return out;
}

const labelsOf = s => Object.fromEntries(String(s || '').split(',').map(kv => kv.split('=')).filter(kv => kv.length >= 2).map(([k, ...v]) => [k, v.join('=')]));

async function containers() {
  if (Date.now() - _containers.at < CONTAINERS_MS) return _containers.list;
  let rows = [];
  try { rows = await require('../containers').ps(); } catch { rows = []; }
  const computers = new Map(tryOr(() => require('../computers').all(), []).map(c => [`doca-computer-${c.id}`, c]));
  const services = new Map(tryOr(() => require('../services').INFERENCE_SERVICES, []).map(s => [`doca-${s.id}`, s]));
  const origin = require('../machines/origin');
  const list = rows.map(r => {
    const name = String(r.Names || '').replace(/^\//, '').split(',')[0];
    const project = labelsOf(r.Labels)['com.docker.compose.project'] || null;
    const c = computers.get(name), s = services.get(name);
    const kind = c ? 'computer' : s ? 'service' : 'container';
    return { id: String(r.ID || ''), name, project, kind, label: c?.name || s?.label || null,
      go: c ? { tab: 'computers' } : s ? { tab: 'models' } : { tab: 'docker' },
      origin: tryOr(() => (c ? origin.of('computer', c.id, { up: true, fallback: origin.computerFallback(c) }) : origin.of('container', name, { up: true, name, project })), null) };
  });
  _containers = { at: Date.now(), list };
  return list;
}

/** DOCA's own processes: pid → { who }. */
function doca(product) {
  const out = new Map([[process.pid, { who: `this hub — ${product} itself` }]]);
  for (const s of tryOr(() => require('../mcp/registry').list(), [])) if (s.pid) out.set(s.pid, { who: `started by ${product}: the MCP server "${s.name || s.id}"` });
  for (const l of tryOr(() => require('../models-llamacpp').getRunningInstances(), [])) if (l.pid) out.set(l.pid, { who: `started by ${product}: the llama.cpp server "${l.name || l.id}"` });
  return out;
}

function jobs() {
  const title = id => tryOr(() => require('../harness/memory').getSession(id)?.title || null, null);
  return tryOr(() => require('../harness/jobs').list().filter(j => j.state === 'running' && j.pid)
    .map(j => ({ pid: j.pid, id: j.id, command: String(j.command || '').slice(0, 120), who: j.sessionId ? title(j.sessionId) || j.sessionId : null, startedAt: j.startedAt || null })), []);
}

/** port → { label, go } for the ports with something of DOCA's behind them. */
function links(conts) {
  const out = new Map();
  for (const s of tryOr(() => require('../machines').served(), [])) out.set(s.port, { label: 'a page an agent serves', go: { tab: 'live' } });
  for (const s of tryOr(() => require('../services').INFERENCE_SERVICES, [])) {
    if (conts.some(c => c.name === `doca-${s.id}`)) out.set(s.port, { label: s.label, go: { tab: 'models' } });
  }
  for (const l of tryOr(() => require('../models-llamacpp').getRunningInstances(), [])) out.set(Number(l.port), { label: `the llama.cpp server "${l.name || l.id}"`, go: { tab: 'models' } });
  return out;
}

/** The repository a folder is in, walking up to the first `.git` (a folder, or a worktree's file); kept per folder. */
function gitRootOf(dir) {
  if (!dir) return null;
  const seen = [];
  let d = path.resolve(String(dir)), found = null;
  for (let n = 0; n < 40; n++) {
    if (_git.has(d)) { found = _git.get(d); break; }
    seen.push(d);
    if (tryOr(() => fs.existsSync(path.join(d, '.git')), false)) { found = d; break; }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  // The home folder and the filesystem's root are never "a repository" a process belongs to (a dotfiles repo at ~).
  if (found && (found === path.parse(found).root || found === require('os').homedir())) found = null;
  for (const s of seen) _git.set(s, found);
  if (_git.size > 5000) _git.clear();
  return found;
}

async function gather() {
  const product = tryOr(() => require('../branding').name('product'), 'DOCA');
  const conts = await containers();
  return { product, projects: projects(), containers: conts, doca: doca(product), hubPid: process.pid, jobs: jobs(), links: links(conts), gitRootOf };
}

module.exports = { gather, gitRootOf, labelsOf, _reset: () => { _containers = { at: 0, list: [] }; _git.clear(); } };
