'use strict';

/**
 * MCP servers the agent prepared, waiting for a person (asked 2026-10-06: set up Fusion 360 or any tool "in an
 * organic way … without having to change parts of the code"). The catalogue covers the servers DOCA knows; for any
 * other, the agent finds how it runs (research_docs) and drafts it here: name, how it is reached (a command, or an
 * address), its arguments, the names of the secrets it needs, and on which machine it belongs. A draft is not a
 * server: nothing here starts, and nothing is written to `mcpServers`. The MCP tab lists the drafts; "Open in the form"
 * fills the ordinary add-server form with it, the person reads the exact command, pastes the secrets and presses
 * Save — exactly what they could have typed. The rule "the agent never supplies a command that runs" still holds: a
 * command only runs once a person saved it themselves.
 */
const crypto = require('crypto');
const docs = () => require('../db/docs');
const KEY = 'mcp-drafts';
const MAX = 20;
const SECRET = /pass|token|secret|key|bearer|authori[sz]ation|credential|cookie/i;

const all = () => docs().getDoc(KEY, { drafts: [] }).drafts || [];
const keep = list => docs().setDoc(KEY, { drafts: list.slice(-MAX) });
const bad = msg => Object.assign(new Error(msg), { status: 400 });

/** The agent's draft, checked into the shape the form takes. Secret values are never kept: only their names. */
function draft({ name, transport = 'stdio', command, args, url, env, headers, where, why, docs: source }, by = {}) {
  name = String(name || '').trim().slice(0, 40);
  if (!/^[A-Za-z0-9][\w .-]*$/.test(name)) throw bad('A draft needs a name: letters, digits, spaces, dots and dashes.');
  transport = transport === 'http' ? 'http' : 'stdio';
  if (transport === 'stdio' && !String(command || '').trim()) throw bad('A stdio server needs its command (npx, uvx, python, a path).');
  if (transport === 'http') { try { new URL(String(url || '')); } catch { throw bad('An http server needs its address, like http://localhost:8123/mcp.'); } }
  const names = v => (Array.isArray(v) ? v : Object.keys(v || {})).map(String).filter(k => /^[\w.-]{1,60}$/.test(k)).slice(0, 20);
  // A value for a setting that is not a secret is kept (a path, a port); a secret's value never is.
  const envVals = Object.fromEntries(Object.entries(env && !Array.isArray(env) && typeof env === 'object' ? env : {})
    .filter(([k, v]) => /^[\w.-]{1,60}$/.test(k) && !SECRET.test(k) && ['string', 'number'].includes(typeof v)).map(([k, v]) => [k, String(v).slice(0, 300)]));
  const d = {
    id: `draft_${crypto.randomBytes(4).toString('hex')}`, name, transport,
    command: transport === 'stdio' ? String(command).trim().slice(0, 200) : '',
    args: transport === 'stdio' ? (Array.isArray(args) ? args : String(args || '').split(/\r?\n/)).map(a => String(a).trim()).filter(Boolean).slice(0, 30).map(a => a.slice(0, 300)) : [],
    url: transport === 'http' ? String(url).slice(0, 300) : '',
    env: { ...Object.fromEntries(names(env).map(k => [k, ''])), ...envVals },
    headers: names(headers),
    where: String(where || 'this hub').slice(0, 80),
    why: String(why || '').slice(0, 300), docs: String(source || '').slice(0, 300),
    by: by.sessionId || null, at: new Date().toISOString(),
  };
  keep([...all().filter(x => x.name.toLowerCase() !== name.toLowerCase()), d]);
  return d;
}

function remove(id) { const before = all(); keep(before.filter(d => d.id !== id)); return { removed: before.length !== all().length }; }

module.exports = { all, draft, remove };
