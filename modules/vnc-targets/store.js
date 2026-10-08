'use strict';

/**
 * VNC targets: screens a person with host added by address (asked 2026-10-08, the VNC section of Machines) — a name, a
 * host, a port and, when the server asks for one, a password. Kept in DATA_DIR/keys/vnc.json (0600, PROTECTED_FILES,
 * so the agent's file tools never read it); `view()` is all that leaves this module towards a browser or a prompt —
 * `hasPassword`, never the password. The hub signs in with it itself (rfb.js, proxy.js).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = () => require('../paths').VNC_KEYS_FILE;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const all = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; } catch { return {}; } };
function write(d) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(d, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file(), 0o600); } catch { /* Windows */ }
}

const view = t => ({ id: t.id, name: t.name, host: t.host, port: t.port, hasPassword: !!t.password, savedAt: t.savedAt });
const list = () => Object.values(all()).map(view).sort((a, b) => a.name.localeCompare(b.name));

// A host is a name or an address — never something a connect call would read as more (a space, a scheme, a path).
const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[?[0-9A-Fa-f:.]{2,45}\]?)$/;

/** Add one, or change one (`id`): an absent or masked password keeps the one kept; '' or null forgets it. */
function save({ id, name, host, port, password } = {}) {
  const d = all();
  const was = id ? d[id] : null;
  if (id && !was) throw bad('No such VNC target.', 404);
  host = String(host ?? was?.host ?? '').trim().replace(/^\[|\]$/g, '');
  if (!HOST.test(host)) throw bad('The host is a name or an address, like 192.168.1.20 or desk.local.');
  port = Number(port ?? was?.port ?? 5900);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad('The port is a number from 1 to 65535 (VNC\'s first display is 5900).');
  name = String(name ?? was?.name ?? '').trim().slice(0, 60) || `${host}:${port}`;
  if (Object.values(d).some(t => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) throw bad(`A VNC target is already called "${name}".`, 409);
  const MASK = require('../secrets-mask').MASK;
  const keep = password === undefined || password === MASK;
  if (!keep && password != null && typeof password !== 'string') throw bad('The password is text.');
  const key = was?.id || `vnc_${crypto.randomBytes(5).toString('hex')}`;
  d[key] = { id: key, name, host, port, password: keep ? was?.password || '' : String(password || '').slice(0, 256), savedAt: new Date().toISOString() };
  write(d);
  return view(d[key]);
}

function remove(id) { const d = all(); if (!d[id]) throw bad('No such VNC target.', 404); delete d[id]; write(d); return { removed: id }; }

/** By id, or by name (any case): what the agent and the routes name a target by. */
const find = ref => all()[String(ref || '')] || Object.values(all()).find(t => t.name.toLowerCase() === String(ref || '').trim().toLowerCase()) || null;

/** For the hub's own connection only (rfb.js, proxy.js, shots.js): where, and the password. */
const connection = ref => { const t = find(ref); return t ? { id: t.id, name: t.name, host: t.host, port: t.port, password: t.password || '' } : null; };

/** Every kept password, so typing one (vnc_input) can be refused and a result scrubbed of one. */
const passwords = () => Object.values(all()).map(t => t.password).filter(Boolean);

module.exports = { list, save, remove, find: ref => (find(ref) ? view(find(ref)) : null), connection, passwords, view };
