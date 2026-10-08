'use strict';

/**
 * A VM's console through the hub, the way a computer's screen is (computers/vnc.js): when the VM's VNC display listens
 * on this machine — loopback, every address, or one of this machine's own (a tailnet address included) — the panel
 * opens it in a noVNC page and the hub carries the bytes, so a phone watches a VM it could not reach itself. A VNC on
 * another machine, SPICE or RDP is named with where it is, for a viewer.
 *
 *   GET /api/machines/vms/:hypervisor/:name/console   the page (noVNC from jsDelivr, as the editor's Monaco is)
 *   WS  /ws/vm/:hypervisor/:name                      its VNC stream; the upgrade router (terminal.js) has already
 *                                                     demanded the host right, a recent sign-in and this panel's page
 */
const net = require('net');
const os = require('os');

const NOVNC = 'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.7.0/core/rfb.js';

function ownAddress(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '::', os.hostname().toLowerCase()].includes(h)) return true;
  return Object.values(os.networkInterfaces()).flat().some(i => i && i.address.toLowerCase() === h);
}

/**
 * How a VM's screen can be opened. libvirt's `domdisplay` writes a VNC display as its number (vnc://host:2 is port
 * 5902), as VNC viewers read it; VirtualBox's VRDE gives the port itself.
 */
function where(vm) {
  const d = vm?.display;
  if (!vm || vm.state !== 'running') return { how: 'none', why: 'Not running.' };
  if (!d) return { how: 'none', why: 'No remote display is configured for it.' };
  if (d.protocol !== 'vnc') return { how: 'viewer', where: d.uri, why: `A ${d.protocol.toUpperCase()} display: open ${d.uri} in a viewer.` };
  const port = vm.hypervisor === 'libvirt' && d.port != null && d.port < 5900 ? 5900 + d.port : d.port;
  if (!port) return { how: 'none', why: 'Its VNC display has no port yet.' };
  if (!ownAddress(d.host)) return { how: 'viewer', where: d.uri, why: `Its VNC display is on another machine (${d.host}): open ${d.uri} in a viewer there.` };
  const host = ['0.0.0.0', '::', 'localhost'].includes(d.host) ? '127.0.0.1' : d.host.replace(/^\[|\]$/g, '');
  return { how: 'hub', host, port, url: `/api/machines/vms/${encodeURIComponent(vm.hypervisor)}/${encodeURIComponent(vm.name)}/console` };
}

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const page = vm => pageFor(vm.name, `ws/vm/${encodeURIComponent(vm.hypervisor)}/${encodeURIComponent(vm.name)}`);

/** The noVNC page for a socket path the hub carries (a VM's here, a VNC target's in vnc-targets/routes.js). */
function pageFor(title, ws) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — console</title>
<style>html,body{margin:0;height:100%;background:#000;color:#ccc;font:13px system-ui,sans-serif}#screen{position:absolute;inset:0}
#note{position:absolute;left:0;right:0;top:40%;text-align:center;padding:16px}</style></head>
<body><div id="screen"></div><div id="note">Connecting to ${esc(title)}…</div>
<script type="module">
const note = document.getElementById('note');
const say = t => { note.textContent = t; note.style.display = t ? '' : 'none'; };
let RFB;
try { RFB = (await import(${JSON.stringify(NOVNC)})).default; } catch { say('The console viewer could not be loaded (no connection to cdn.jsdelivr.net?).'); throw 0; }
const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/' + ${JSON.stringify(ws)};
const rfb = new RFB(document.getElementById('screen'), url, { shared: true });
rfb.scaleViewport = true; rfb.resizeSession = false;
rfb.viewOnly = new URLSearchParams(location.search).get('view') === '1';
rfb.addEventListener('connect', () => say(''));
rfb.addEventListener('disconnect', e => say(e.detail.clean ? 'The console closed.' : 'The console could not be reached — is it still running?'));
rfb.addEventListener('credentialsrequired', () => { const password = prompt('Its VNC password:'); if (password != null) rfb.sendCredentials({ password }); });
</script></body></html>`;
}

/** Pipe an authorised upgrade to the VM's VNC port: binary WebSocket messages one way, TCP bytes the other. */
async function upgrade(req, socket, head) {
  const m = /^\/ws\/vm\/([\w-]+)\/([^/?]+)/.exec(req.url);
  const vm = m && await require('./vm-list').find(m[1], decodeURIComponent(m[2]));
  const at = vm && where(vm);
  if (!at || at.how !== 'hub') return socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ noServer: true, handleProtocols: p => (p.has('binary') ? 'binary' : [...p][0] || false) });
  wss.handleUpgrade(req, socket, head, ws => {
    const tcp = net.connect(at.port, at.host);
    const close = () => { try { ws.close(); } catch { /* closed */ } tcp.destroy(); };
    tcp.on('data', d => { if (ws.readyState === 1) ws.send(d); });
    tcp.on('error', close); tcp.on('close', close);
    ws.on('message', d => tcp.write(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    ws.on('close', close); ws.on('error', close);
  });
}

function mount(app) {
  app.get('/api/machines/vms/:hypervisor/:name/console', async (req, res) => {
    const vm = await require('./vm-list').find(req.params.hypervisor, req.params.name);
    const at = vm && where(vm);
    if (!at) return res.status(404).type('text/plain').send('No such VM.');
    if (at.how !== 'hub') return res.status(409).type('text/plain').send(at.why);
    res.type('html').set('Cache-Control', 'no-store').send(page(vm));
  });
}

module.exports = { mount, upgrade, where, ownAddress, pageFor };
