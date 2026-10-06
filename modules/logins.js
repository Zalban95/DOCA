'use strict';

/**
 * Logins for the agents' computers (TODO H5.4, the credentials vault): a site, a username and a password the owner
 * keeps here, which an agent can use to sign in on a computer **without ever seeing the password**. `computer_login`
 * (the agent's tool) is asked about every time (approval.gate); the hub checks the computer's page is on the login's
 * own site — a look-alike gets nothing — types the username through the ordinary tool, and the password itself
 * through the computer's hidden `browser_fill_secret`, which only the hub's per-computer key unlocks. The agent's
 * transcript holds the login's name, never its secret. Kept in DATA_DIR/keys/logins.json (0600, PROTECTED_FILES).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = () => require('./paths').LOGIN_KEYS_FILE;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const all = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
function write(d) { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(d, null, 2), { mode: 0o600 }); try { fs.chmodSync(file(), 0o600); } catch { /* Windows */ } }

const view = l => ({ id: l.id, label: l.label, site: l.site, username: l.username, hasPassword: !!l.password, savedAt: l.savedAt });
const list = () => Object.values(all()).map(view);

function save({ id, label, site, username, password }) {
  let origin;
  try { origin = new URL(String(site || '')).origin; } catch { throw bad('The site is its address, like https://github.com.'); }
  if (!/^https?:/.test(origin)) throw bad('The site is an http(s) address.');
  const d = all();
  const key = id && d[id] ? id : `login_${crypto.randomBytes(5).toString('hex')}`;
  const MASK = require('./secrets-mask').MASK;
  d[key] = { id: key, label: String(label || new URL(origin).hostname).slice(0, 60), site: origin, username: String(username || '').slice(0, 200),
    password: typeof password === 'string' && password && password !== MASK ? password : d[key]?.password || '', savedAt: new Date().toISOString() };
  if (!d[key].password) throw bad('A login needs its password.');
  write(d);
  return view(d[key]);
}

function remove(id) { const d = all(); if (!d[id]) throw bad('No such login.', 404); delete d[id]; write(d); return { removed: id }; }

/** Call one of a computer's own tools as the hub (not through the agent's MCP layer). */
async function computerCall(c, name, args) {
  const r = await fetch(`http://127.0.0.1:${c.mcpPort}/mcp`, { method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then(x => x.json()).catch(() => null);
  const text = (r?.result?.content || []).map(x => x.text || '').join('\n');
  if (!r?.result || r.result.isError) throw bad(text || 'The computer is not answering — is it running?', 502);
  return text;
}

/** Sign in on a computer with a stored login: its page must be on the login's site. Returns what to tell the agent. */
async function fill({ computer, login, userRef, passRef }) {
  const c = require('./computers').need(String(computer || ''));
  const l = all()[String(login || '')] || Object.values(all()).find(x => x.label.toLowerCase() === String(login || '').toLowerCase());
  if (!l) throw bad(`No login "${login}". An admin keeps them in Field → Connectors → Logins: ${list().map(x => x.label).join(', ') || 'none yet'}.`, 404);
  if (!c.fillKey) throw bad('This computer was made before logins existed: make a new one (or ask an admin to).', 409);
  const page = await computerCall(c, 'browser_snapshot', {});
  const at = (/^url: (\S+)/m.exec(page) || [])[1] || '';
  let origin = '';
  try { origin = new URL(at).origin; } catch { /* no page */ }
  if (origin !== l.site) throw bad(`The computer's page is ${origin || 'not a web page'}, not ${l.site}: the login for ${l.label} is used only on its own site.`, 409);
  if (userRef !== undefined && userRef !== null && l.username) await computerCall(c, 'browser_type', { ref: Number(userRef), text: l.username });
  await computerCall(c, 'browser_fill_secret', { ref: Number(passRef), value: l.password, key: c.fillKey });
  return `Filled the sign-in for ${l.label} as ${l.username || '(no username)'} on ${l.site}; the password was typed by the hub and is not shown to you. `
    + 'Now click the sign-in button (browser_click with confirm: true — the person is asked).';
}

module.exports = { list, save, remove, fill };
