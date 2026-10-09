'use strict';

/**
 * MCP servers this panel knows how to add (TODO H5.1): each a fixed command the panel owns, so adding one
 * is a click — or the agent's install proposal (harness/installs.js, kind `mcp`), which names an id from
 * here and never a command. What it adds is an ordinary stdio server in the registry, off until started.
 *
 * Browser control first: the quick path to "the agent uses a page as a person would" on this host, beside
 * the computers (modules/computers), whose Chromium runs in a container.
 */
const CATALOG = [
  { id: 'playwright', label: 'Playwright — a browser the agent drives',
    about: 'Microsoft\'s server: open pages, read them as an accessibility snapshot, click and type by reference, take screenshots, '
      + 'handle tabs and downloads. Headless, with a fresh profile each start. Needs Node; adding it downloads its browser (~150 MB).',
    command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated', '--browser', 'chromium'], needs: ['npx'],
    setup: ['npx', '-y', '@playwright/mcp@latest', 'install-browser', 'chrome-for-testing'] },
  { id: 'chrome-devtools', label: 'Chrome DevTools — inspect and drive Chrome',
    about: 'Google\'s server: drive a Chrome over the DevTools protocol — navigate, click, fill forms, read the console and network, '
      + 'record performance traces. Headless and isolated. Needs Node and an installed Chrome.',
    command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest', '--headless', '--isolated'], needs: ['npx'] },
  // A server at an address rather than a command: the building's own (skills/smart-home). Added with its default address
  // and its token named as a key for services (`home-assistant`, since 2.266.0): the person pastes it once in Field →
  // Connectors → Keys for services, where the Home page reads it too; the hub adds it when it connects (registry.withKey).
  { id: 'home-assistant', label: 'Home Assistant — the building: lights, climate, covers, sensors, scenes',
    about: 'Home Assistant\'s own MCP server (Settings → Devices & services → Add "Model Context Protocol Server" in Home Assistant): '
      + 'the entities you expose to Assist become tools — turn on and off, set lights and climate, read sensors, run scripts and scenes. '
      + 'Set its address in the MCP tab, and paste a long-lived access token (your Home Assistant profile → Security) as the key '
      + '"home-assistant" for that address in Field → Connectors → Keys for services.',
    transport: 'http', url: 'http://homeassistant.local:8123/api/mcp', headers: {}, key: 'home-assistant', needs: [] },
];

const get = id => CATALOG.find(c => c.id === id) || null;

/** The catalogue with what is already added and what this host lacks to run each. */
function list() {
  const have = new Set(require('./registry').load().map(s => s.id));
  const { which } = require('../shell');
  return CATALOG.map(c => ({ id: c.id, label: c.label, about: c.about, transport: c.transport || 'stdio', command: c.transport === 'http' ? c.url : [c.command, ...c.args].join(' '),
    added: have.has(c.id), missing: c.needs.filter(n => !which(n)) }));
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
  if (c.transport === 'http') return require('./registry').upsert({ id: c.id, label: c.label, transport: 'http', url: c.url, headers: { ...c.headers }, ...(c.key ? { key: c.key } : {}), autostart: false });
  return require('./registry').upsert({ id: c.id, label: c.label, transport: 'stdio', command: c.command, args: c.args, autostart: false });
}

module.exports = { CATALOG, get, list, add, setup };
