'use strict';

/**
 * Finding hubs on the tailnet (TODO H6.4): Tailscale already knows every peer, so `doca-client find` asks it
 * (`tailscale status --json`) and knocks on each online peer's DOCA port for `/api/branding` — the one route a hub
 * answers to anyone, with its name. A hub on a tailnet is not announced on the LAN, and needs no mDNS to be found.
 * Discovery only: the certificate is not trusted here; pairing pins it (doca-client.js tlsFor).
 */
const https = require('https');
const { spawn } = require('child_process');

const PORT = Number(process.env.DOCA_PORT) || 4242;

function tailscalePeers() {
  return new Promise(resolve => {
    let out = '';
    let child;
    try { child = spawn('tailscale', ['status', '--json'], { windowsHide: true }); } catch { return resolve(null); }
    child.stdout.on('data', d => { out += d; });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try {
        const s = JSON.parse(out);
        const node = (n, self) => ({ name: String(n.DNSName || n.HostName || '').replace(/\.$/, ''), ip: (n.TailscaleIPs || []).find(a => a.includes('.')), online: self || n.Online !== false, self });
        resolve([node(s.Self || {}, true), ...Object.values(s.Peer || {}).map(p => node(p, false))].filter(p => p.ip && p.online));
      } catch { resolve(null); }
    });
  });
}

/** A DOCA hub at this address, or null: its name from /api/branding. */
function knock(host, timeoutMs = 2500) {
  return new Promise(resolve => {
    const req = https.get({ host, port: PORT, path: '/api/branding', rejectUnauthorized: false, timeout: timeoutMs }, res => {
      let body = '';
      res.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
      res.on('end', () => { try { const b = JSON.parse(body); resolve(b && b.product ? { product: b.product, panel: b.panel || null } : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** Every hub on the tailnet: [{ name, ip, url, product }], or null when Tailscale is not there to ask. */
async function find({ peers = tailscalePeers } = {}) {
  const list = await peers();
  if (!list) return null;
  const found = await Promise.all(list.map(async p => { const b = await knock(p.ip); return b && { name: p.name || p.ip, ip: p.ip, self: p.self, url: `https://${p.name || p.ip}:${PORT}`, product: b.product }; }));
  return found.filter(Boolean);
}

module.exports = { find, knock, tailscalePeers, PORT };
