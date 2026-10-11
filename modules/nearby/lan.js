'use strict';

/**
 * The neighbours this machine's own network stack already knows (its ARP / neighbour table): `ip -j neigh` on Linux,
 * `arp -a` on macOS and Windows — by argv, read-only, nothing sent to anyone. Each with its MAC (who it is across
 * scans), the maker from a small bundled list (oui.js), and a name by reverse DNS when the network gives one.
 * Containers' and VMs' bridges are left out: they are this machine's own, not the room around it.
 */
const { execFile } = require('child_process');
const oui = require('./oui');
const { VIRTUAL } = require('./mdns');

const run = (cmd, args, ms = 4000) => new Promise(resolve => execFile(cmd, args, { timeout: ms, windowsHide: true, maxBuffer: 2 << 20 },
  (err, stdout) => resolve(err && !stdout ? null : String(stdout || ''))));

const ipv4 = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

/** `ip -j neigh` → [{ip, mac, dev, state}] — IPv4 with an address only, not on a virtual interface. */
function parseIpNeigh(json) {
  let rows;
  try { rows = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.filter(r => ipv4(r.dst) && r.lladdr && !VIRTUAL.test(r.dev || '') && !oui.isGroup(r.lladdr) && ![].concat(r.state || []).some(x => /FAILED|INCOMPLETE/.test(x)))
    .map(r => ({ ip: r.dst, mac: oui.normalize(r.lladdr), dev: r.dev || '', state: [].concat(r.state || [])[0] || '' }));
}

/**
 * `arp -a` → [{ip, mac, dev}]. Two shapes: BSD/macOS and net-tools ("? (192.168.1.1) at d4:35:… on en0 …") and
 * Windows ("Interface: 192.168.1.5 --- 0x7" headers, then "  192.168.1.1   d4-35-…   dynamic").
 */
function parseArp(text) {
  const out = [];
  let iface = '';
  for (const line of String(text || '').split(/\r?\n/)) {
    const bsd = /\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-f:]+)(?:\s+\[\w+\])?\s+on\s+(\S+)/i.exec(line);
    if (bsd) { if (!VIRTUAL.test(bsd[3])) out.push({ ip: bsd[1], mac: oui.normalize(bsd[2]), dev: bsd[3] }); continue; }
    const head = /^Interface:\s+(\S+)/i.exec(line);
    if (head) { iface = head[1]; continue; }
    const win = /^\s+(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\w+)/i.exec(line);
    if (win && /dynamic/i.test(win[3])) out.push({ ip: win[1], mac: oui.normalize(win[2]), dev: iface });
  }
  return out.filter(r => r.mac && !oui.isGroup(r.mac));
}

/** The default gateway's address (Linux `ip -j route show default`): the router, named as such. */
function parseDefaultRoute(json) {
  try { return (JSON.parse(json) || []).map(r => r.gateway).find(ipv4) || null; } catch { return null; }
}

/** A name for an address by reverse DNS, or null after `ms`. */
function reverse(ip, ms = 1500, dns = require('dns').promises) {
  return Promise.race([dns.reverse(ip).then(n => n[0] || null).catch(() => null), new Promise(r => setTimeout(() => r(null), ms).unref?.())]);
}

/** One look at the table: {ip, mac, maker, private, name, gateway}. Same IP on two interfaces of ours counts once. */
async function neighbours({ platform = process.platform, exec = run, dns } = {}) {
  let rows = [], gateway = null;
  if (platform === 'linux') {
    const j = await exec('ip', ['-j', 'neigh']);
    rows = j ? parseIpNeigh(j) : [];
    if (!j) rows = parseArp(await exec('arp', ['-an']) || '');
    gateway = parseDefaultRoute(await exec('ip', ['-j', 'route', 'show', 'default']) || '');
  } else {
    rows = parseArp(await exec('arp', ['-a']) || '');
  }
  const byIp = new Map();
  for (const r of rows) if (!byIp.has(r.ip)) byIp.set(r.ip, r);
  const list = [...byIp.values()].slice(0, 254);
  const names = await Promise.all(list.map(r => reverse(r.ip, 1500, dns)));
  return list.map((r, i) => ({ ...r, ...oui.vendor(r.mac), name: names[i] && !names[i].startsWith(r.ip) ? names[i].replace(/\.$/, '') : null, gateway: r.ip === gateway }));
}

module.exports = { parseIpNeigh, parseArp, parseDefaultRoute, neighbours, run };
