'use strict';

/**
 * The sources that read another program's own list rather than the air: catt (Cast All The Things) when it is
 * installed, the tailnet's peers (`tailscale status --json`), and Home Assistant's entities when the hub's link to it
 * has them (modules/home). All read-only, by argv or through the module that already holds the connection.
 */
const { run } = require('./lan');

/** `catt scan` → [{ip, name, maker, model}]: lines "192.168.1.34 - Kitchen speaker - Google Inc. Google Home Mini". */
function parseCatt(text) {
  return String(text || '').split(/\r?\n/).map(l => /^(\d{1,3}(?:\.\d{1,3}){3})\s+-\s+(.+?)\s+-\s+(.+)$/.exec(l.trim())).filter(Boolean).map(m => {
    const rest = m[3].trim();
    const maker = /^(Google Inc\.|Google LLC|[^ ]+ (?:Inc\.|LLC|Ltd\.?|GmbH|Co\.))/.exec(rest)?.[1] || null;
    return { ip: m[1], name: m[2].trim(), maker, model: maker ? rest.slice(maker.length).trim() : rest };
  });
}

/** Where catt is: on PATH, else the user's pip/pipx folder (~/.local/bin) where it is usually installed. */
function cattPath() {
  try {
    const s = require('../shell');
    const found = s.which && s.which('catt');
    if (found) return found;
  } catch { /* no shell module */ }
  const p = require('path').join(require('os').homedir(), '.local', 'bin', process.platform === 'win32' ? 'catt.exe' : 'catt');
  return require('fs').existsSync(p) ? p : null;
}

async function catt({ exec = run } = {}) {
  const bin = cattPath();
  if (!bin) return { list: [], why: 'catt is not installed.' };
  const out = await exec(bin, ['scan'], 20000);
  return out === null ? { list: [], why: 'catt scan did not answer.' } : { list: parseCatt(out), bin };
}

/** `tailscale status --json` → [{id, name, dns, os, ips, online, lastSeen}]: the peers, not this machine. */
function parseTailscale(json) {
  let d;
  try { d = JSON.parse(json); } catch { return []; }
  return Object.values(d?.Peer || {}).map(p => ({ id: String(p.ID || p.PublicKey || ''), name: p.HostName || (p.DNSName || '').split('.')[0], dns: String(p.DNSName || '').replace(/\.$/, ''),
    os: p.OS || '', ips: [].concat(p.TailscaleIPs || []), online: !!p.Online, lastSeen: p.LastSeen && !/^0001/.test(p.LastSeen) ? p.LastSeen : null })).filter(p => p.id);
}

async function tailscale({ exec = run } = {}) {
  const out = await exec('tailscale', ['status', '--json'], 6000);
  return out === null ? { list: [], why: 'tailscale is not installed, or not running.' } : { list: parseTailscale(out) };
}

const HA_DOMAINS = ['media_player', 'light', 'switch', 'fan', 'cover', 'climate', 'lock', 'camera', 'alarm_control_panel', 'vacuum'];

/** Home Assistant's entities of the kinds a person would call a thing, from every home the hub reads (home/index.js). */
async function homeAssistant() {
  let home;
  try { home = require('../home'); } catch { return { list: [], why: 'Home Assistant is not connected.' }; }
  const out = [];
  let why = null;
  for (const h of home.homes()) {
    let raw;
    try {
      raw = h.kind === 'direct' ? await require('../home/direct').snapshot()
        : await require('../home/nodes').snapshot(require('../home/nodes').list().find(n => n.id === h.id));
    } catch (e) { why = e.message; continue; }
    if (!raw?.connected) { why = raw?.error || 'Home Assistant is not connected (Field → Connectors → Keys for services, home-assistant).'; continue; }
    for (const a of raw.areas || []) for (const t of a.tiles || []) {
      if (HA_DOMAINS.includes(t.domain)) out.push({ home: h.id, homeName: h.name, id: t.id, name: t.name, domain: t.domain, area: a.id ? a.name : null, state: t.state, deviceClass: t.attrs?.device_class || t.deviceClass || null });
    }
  }
  return out.length || !why ? { list: out.slice(0, 300) } : { list: [], why };
}

module.exports = { parseCatt, cattPath, catt, parseTailscale, tailscale, homeAssistant, HA_DOMAINS };
