'use strict';

/**
 * The cheap readings busy.js decides from (asked 2026-10-08: "shouldn't we see in the harness or in the workstream if
 * something is working?"). Each is one command by argv, or one request, and each fails alone to nothing:
 *   containers  `docker stats --no-stream` — every running container's CPU (percent of one core) and memory, the
 *               agents' computers among them (`doca-computer-<id>`)
 *   vms         `virsh domstats --cpu-total --balloon` for the running libvirt machines: CPU time and memory, which
 *               busy.js turns into a share between two looks (other hypervisors give no reading here)
 *   processes   a computer's own process list, from its control server's hidden `processes` tool (clients/computer/
 *               procs.js) — a computer built before it has none, and is judged by its CPU alone
 * Readings only: no model is asked anything, here or in busy.js — what the pages show is data in fixed words.
 */
const { execFile } = require('child_process');

const pct = s => { const n = parseFloat(String(s || '').replace('%', '')); return Number.isFinite(n) ? n : null; };

function exec(bin, args, env = {}) {
  return new Promise((resolve, reject) => execFile(bin, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...env } },
    (err, stdout) => (err ? reject(err) : resolve(String(stdout)))));
}

/** name → { cpu, mem } for every running container; an empty map when there is no container CLI. */
async function containers() {
  const out = new Map();
  let text = '';
  try { text = await exec(require('../containers').cli(), ['stats', '--no-stream', '--format', '{{json .}}']); } catch { return out; }
  for (const line of text.split('\n')) {
    let s;
    try { s = JSON.parse(line); } catch { continue; }
    const name = String(s.Name || s.Names || '').replace(/^\//, '');
    if (name) out.set(name, { cpu: pct(s.CPUPerc ?? s.CPU), mem: String(s.MemUsage || '').split('/')[0].trim() || null });
  }
  return out;
}

/** `virsh domstats` printed as blocks of `Domain: 'name'` and `  key=value`. */
function parseDomstats(text) {
  const out = new Map();
  let cur = null;
  for (const line of String(text).split('\n')) {
    const d = /^Domain:\s*'(.+)'/.exec(line);
    if (d) { cur = { cpuTime: null, rssKiB: null }; out.set(d[1], cur); continue; }
    const kv = /^\s+([\w.]+)=(\S+)/.exec(line);
    if (!cur || !kv) continue;
    if (kv[1] === 'cpu.time') cur.cpuTime = Number(kv[2]);
    if (kv[1] === 'balloon.rss') cur.rssKiB = Number(kv[2]);
    else if (kv[1] === 'balloon.current' && cur.rssKiB === null) cur.rssKiB = Number(kv[2]);
  }
  return out;
}

/** name → { cpuTime (ns), rssKiB } for the running libvirt machines named. */
async function vms(names) {
  if (!names.length) return new Map();
  try {
    const flags = require('../vms').virshFlags?.() || [];
    return parseDomstats(await exec('virsh', [...flags, 'domstats', '--cpu-total', '--balloon', ...names], { LC_ALL: 'C', LANG: 'C' }));
  } catch { return new Map(); }
}

/** A computer's process list (its raw record: mcpPort and token), or null when it cannot say. */
async function processes(c) {
  try {
    const r = await fetch(`http://127.0.0.1:${c.mcpPort}/mcp`, { method: 'POST', signal: AbortSignal.timeout(4000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'processes', arguments: {} } }) }).then(x => x.json());
    if (!r?.result || r.result.isError) return null;
    const d = JSON.parse(r.result.content?.[0]?.text || 'null');
    return d && Array.isArray(d.procs) ? d : null;
  } catch { return null; }
}

/**
 * A command line as it may be shown: the value after a secret-named flag, a `--token=…`, a `NAME_TOKEN=…` assignment,
 * a bearer value, a secret-looking piece of an address — each as MASK (mcp/masking.js's rules, and the same MASK).
 */
function maskCommand(args = []) {
  const { maskArgs, maskUrl } = require('../mcp/masking');
  const { MASK } = require('../secrets-mask');
  const list = maskArgs(args.map(String)).map(a => (/^\w+:\/\//.test(a) ? maskUrl(a) : a))
    .map(a => a.replace(/^([A-Za-z_][\w]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD)[\w]*=).+$/i, `$1${MASK}`));
  return list.map((a, i) => (i > 0 && /^bearer$/i.test(list[i - 1]) ? MASK : a.replace(/(\bbearer\s+)\S+/ig, `$1${MASK}`)
    .replace(/(\b(?:token|key|secret|password|passwd)\s*[=:]\s*)[^\s'"]+/ig, `$1${MASK}`)));
}

module.exports = { containers, vms, processes, parseDomstats, maskCommand, pct };
