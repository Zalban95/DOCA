'use strict';

/**
 * Pages of connected services (asked 2026-10-15: "like Home, empty until the service is connected — the page, if
 * connected, shows the entire original UI of the new project, and if not connected just does not show up … can it work
 * for other services, adding pages like that?"). A service that has a web UI of its own — DoMac first — is named once
 * by an admin: its address, the key for services the hub sends it (service-keys.js, never the browser), the group its
 * page sits in and who sees it. While its health route answers (health.js), the panel shows a page that is the
 * service's own UI, through the canvas origin under /s/<id>/ (proxy.js): another origin than the panel's, DOCA's
 * cookies and headers never passed on, the key added by the hub. Not answering, the page is not there.
 *
 * Kept in the store (`service-pages`), never prefs: { services: [{ id, name, url, key, health, group, who, icon }] }.
 */
const store = require('../store');

const DOC = 'service-pages';
const GROUPS = ['controls', 'agents', 'machines', 'host', 'intelligence'];
/** One setting of a service changed, the rest kept (the Start with DOCA switch). */
function patch(id, fields) {
  const was = all().find(s => s.id === id);
  if (!was) throw Object.assign(new Error('No such service.'), { status: 404 });
  return save({ ...was, ...fields });
}
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const text = (v, max = 80) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

const all = () => store.readJson(DOC, { services: [] }).services || [];
const get = id => all().find(s => s.id === id) || null;

/** An admin's definition, checked: a name, an http(s) address, a key that exists, a group the panel has. */
function save(input = {}) {
  const id = text(input.id || input.name, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) throw bad('A service needs a name.');
  let url;
  try { url = new URL(String(input.url || '')); } catch { throw bad('Its address is not an address (http://… or https://…).'); }
  if (!/^https?:$/.test(url.protocol)) throw bad('Its address starts with http:// or https://.');
  const key = text(input.key, 60).toLowerCase();
  if (key && !require('../service-keys').list().some(k => k.name === key)) throw bad(`No key for services named "${key}": add it in Field → Connectors → Keys for services first.`);
  const s = {
    id, name: text(input.name || id, 60), url: url.origin + url.pathname.replace(/\/+$/, ''), key: key || null,
    health: text(input.health || '/api/health', 120).replace(/^(?!\/)/, '/'),
    group: GROUPS.includes(input.group) ? input.group : 'intelligence',
    who: input.who === 'everyone' ? 'everyone' : 'admins',
    icon: text(input.icon || '', 4),
    // How its program starts, and whether DOCA starts it at boot (run.js): an admin's, like an MCP server's command.
    run: input.run !== undefined ? require('./run').checkRun(input.run) : (get(id)?.run || null),
    boot: input.boot !== undefined ? input.boot === true : !!get(id)?.boot,
  };
  if (s.boot && !s.run) throw bad('Starting it with DOCA needs how it starts: its command.');
  store.writeJson(DOC, { services: [...all().filter(x => x.id !== id), s] });
  return s;
}

function remove(id) {
  if (!get(id)) throw bad('No such service.', 404);
  store.writeJson(DOC, { services: all().filter(s => s.id !== id) });
  return { removed: id };
}

const isHost = person => require('../auth/rights').can(person?.role, 'host');
/** Whether this person sees the service's page. */
const sees = (s, person) => isHost(person) || s.who === 'everyone';

module.exports = { DOC, GROUPS, all, get, save, patch, remove, sees, isHost };
