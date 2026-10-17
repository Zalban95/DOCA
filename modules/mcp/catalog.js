'use strict';

/**
 * MCP servers this panel knows how to add (TODO H5.1): each a fixed command the panel owns, so adding one
 * is a click — or the agent's install proposal (harness/installs.js, kind `mcp`), which names an id from
 * here and never a command. What it adds is an ordinary stdio server in the registry, off until started.
 *
 * Browser control first: the quick path to "the agent uses a page as a person would" on this host, beside
 * the computers (modules/computers), whose Chromium runs in a container.
 *
 * A package is pinned, never `@latest` (fit audit 2026-10-14): an install changes what it runs only with a release
 * of this panel, and `checked` is the day the pin was read from the npm registry (`npm view <pkg> version`). A server
 * added before the pin keeps the arguments it was added with; adding it again takes the pin.
 */
const { where } = require('../license/where');

const CATALOG = [
  { id: 'playwright', label: 'Playwright — a browser the agent drives',
    about: 'Microsoft\'s server: open pages, read them as an accessibility snapshot, click and type by reference, take screenshots, '
      + 'handle tabs and downloads. Headless, with a fresh profile each start. Needs Node; adding it downloads its browser (~150 MB).',
    command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--headless', '--isolated', '--browser', 'chromium'], needs: ['npx'],
    setup: ['npx', '-y', '@playwright/mcp@0.0.83', 'install-browser', 'chrome-for-testing'], checked: '2026-10-14' },
  { id: 'chrome-devtools', label: 'Chrome DevTools — inspect and drive Chrome',
    about: 'Google\'s server: drive a Chrome over the DevTools protocol — navigate, click, fill forms, read the console and network, '
      + 'record performance traces. Headless and isolated. Needs Node and an installed Chrome.',
    command: 'npx', args: ['-y', 'chrome-devtools-mcp@1.10.1', '--headless', '--isolated'], needs: ['npx'], checked: '2026-10-14' },
  // A server at an address rather than a command: the building's own (skills/smart-home). Added with its default address
  // and its token named as a key for services (`home-assistant`, since 2.266.0): the person pastes it once in Field →
  // Connectors → Keys for services, where the Home page reads it too; the hub adds it when it connects (registry.withKey).
  { id: 'home-assistant', label: 'Home Assistant — the building: lights, climate, covers, sensors, scenes',
    // Where the token goes is said only where this hive has Keys for services (license/where.js); without them it is the
    // server's own header, which withKey uses when no key of that name is kept.
    get about() {
      return 'Home Assistant\'s own MCP server (Settings → Devices & services → Add "Model Context Protocol Server" in Home Assistant): '
        + 'the entities you expose to Assist become tools — turn on and off, set lights and climate, read sensors, run scripts and scenes. '
        + 'Set its address in the MCP tab, and paste a long-lived access token (your Home Assistant profile → Security) '
        + where('connectors', 'as the key "home-assistant" for that address in Field → Connectors → Keys for services.',
          'in its headers as "Authorization: Bearer <the token>".');
    },
    transport: 'http', url: 'http://homeassistant.local:8123/api/mcp', headers: {}, key: 'home-assistant', needs: [],
    // Home Assistant on this machine (a container on the host network) answers on localhost, and `homeassistant.local`
    // often does not resolve here at all (2026-10-11): the first that answers is the address it is added with.
    near: ['http://localhost:8123/api/mcp'] },
  // A person's own n8n (skills/n8n): a workflow whose "MCP Server Trigger" node gives it an address. Never installed or
  // hosted here (n8n's Sustainable Use License is for their own internal use): only connected, with its Bearer token
  // as the key for services `n8n`, so the secret never sits in the server's headers. The path is each workflow's own.
  { id: 'n8n', label: 'n8n — your own workflows as tools (MCP Server Trigger)',
    get about() {
      return 'A workflow in your own n8n that starts with the "MCP Server Trigger" node offers the tools connected to it. '
        + 'Copy its Production URL (or Test URL while you build it) into the address here, choose Bearer auth on the trigger, '
        + where('connectors', 'and paste the same token in the Token box (kept as the key "n8n" in Field → Connectors → Keys for services). ',
          'and paste the same token in its headers as "Authorization: Bearer <the token>". ')
        + 'This panel does not install n8n.';
    },
    transport: 'http', url: 'http://localhost:5678/mcp/your-workflow-path', headers: {}, key: 'n8n', needs: [] },
  // Suggested, never default: open-source creative apps, each its own server (catalog-craft.js).
  ...require('./catalog-craft').ROWS,
  // Blender, Unity and Unreal — the maker's server and an open one beside it (catalog-engines.js).
  ...require('./catalog-engines').ROWS,
];

/** The first of a server's addresses that answers at all (any HTTP status), else its default. */
async function nearest(c, { timeoutMs = 1500 } = {}) {
  for (const url of [...(c.near || []), c.url]) {
    const answered = await new Promise(resolve => {
      const req = require('http').get(url, { timeout: timeoutMs }, res => { res.resume(); resolve(true); });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    });
    if (answered) return url;
  }
  return c.url;
}

const get = id => CATALOG.find(c => c.id === id) || null;

/** The catalogue with what is already added and what this host lacks to run each. */
function list() {
  const have = new Set(require('./registry').load().map(s => s.id));
  const { which } = require('../shell');
  return CATALOG.map(c => ({ id: c.id, label: c.label, about: c.about, transport: c.transport || 'stdio', command: c.transport === 'http' ? c.url : [c.command, ...c.args].join(' '),
    added: have.has(c.id), missing: c.present ? (c.present() ? [] : [c.missingWhat]) : c.needs.filter(n => !which(n)), ...(c.kit ? { kit: c.kit } : {}), ...(c.installable ? { installable: true } : {}) }));
}

/** A step a server needs once before it can start (Playwright's browser), run the way the server itself is. */
function setup(c, { timeoutMs = 10 * 60000 } = {}) {
  if (!c.setup) return Promise.resolve({ ok: true, log: '' });
  const [cmd, ...args] = c.setup;
  const how = require('./spawn-spec').spawnSpec(cmd, args);
  return new Promise(resolve => {
    let log = '';
    const child = require('child_process').spawn(how.file, how.args, { ...how.opts, windowsHide: true, env: process.env });
    const keep = d => { log = (log + d).slice(-4000); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    const timer = setTimeout(() => { child.kill(); keep('\n(stopped: it took longer than the setup allows)'); }, timeoutMs);
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, log: `${log}\n${e.message}` }); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, log }); });
  });
}

/** Add it to the registry (off), after its one-time setup; a failed setup adds nothing and says why. */
async function add(id) {
  const c = get(id);
  if (!c) throw Object.assign(new Error(`No catalogue server "${id}". The catalogue has: ${CATALOG.map(x => x.id).join(', ')}`), { status: 404 });
  if (c.transport !== 'http' && require('../hosted').on()) throw require('../hosted').refusal(`${c.label}, a command on the hub,`);   // hosted.js
  const done = await module.exports.setup(c);   // through exports, so a test can stand in for the download
  if (!done.ok) throw Object.assign(new Error(`Setting up ${c.label} failed (${(c.setup || []).join(' ')}):\n${done.log.trim().split('\n').slice(-6).join('\n')}`), { status: 500 });
  if (c.transport === 'http') return require('./registry').upsert({ id: c.id, label: c.label, transport: 'http', url: await module.exports.nearest(c), headers: { ...c.headers }, ...(c.key ? { key: c.key } : {}), autostart: false });
  return require('./registry').upsert({ id: c.id, label: c.label, transport: 'stdio', command: c.command, args: c.args, ...(c.env ? { env: { ...c.env } } : {}), autostart: false });
}

module.exports = { CATALOG, get, list, add, setup, nearest };
