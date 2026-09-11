'use strict';

/**
 * The MCP servers this panel knows about, and the ones currently running.
 *
 * Definitions live in prefs under `mcpServers` so they survive a restart; the
 * processes themselves do not, which is why nothing is started implicitly.
 * `autostart` servers are started by `server.js` when it begins listening, so
 * booting the app does not spawn other people's processes during tests.
 */
const { loadPrefs, savePrefs } = require('../utils');
const { McpClient } = require('./client');

const PREFS_KEY = 'mcpServers';

/** Live clients by server id. Not persisted — a process cannot be. */
const _clients = new Map();

/** OpenAI tool names allow `[a-zA-Z0-9_-]`, so ids are kept to that too. */
function slug(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function load() {
  const list = loadPrefs()[PREFS_KEY];
  return Array.isArray(list) ? list : [];
}

function save(list) {
  const prefs = loadPrefs();
  prefs[PREFS_KEY] = list;
  savePrefs(prefs);
  return list;
}

function get(id) {
  return load().find(s => s.id === id) || null;
}

/**
 * Normalise one definition from the UI.
 *
 * `args` and `env` are accepted either as the arrays/objects they are stored as
 * or as the text the form collects, because a textarea is a friendlier way to
 * type `--flag value` than a JSON array.
 */
function normalize(input, existing) {
  const transport = input.transport === 'http' ? 'http' : 'stdio';
  const id = slug(input.id || input.label);
  if (!id) throw Object.assign(new Error('A name is required'), { status: 400 });

  const args = Array.isArray(input.args)
    ? input.args.map(String)
    : String(input.args || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const env = input.env && typeof input.env === 'object' && !Array.isArray(input.env)
    ? input.env
    : Object.fromEntries(String(input.env || '').split(/\r?\n/)
        .map(l => l.trim()).filter(Boolean)
        .map(l => { const i = l.indexOf('='); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
        .filter(Boolean));

  const spec = {
    id,
    label:     String(input.label || input.id || id).trim(),
    transport,
    command:   String(input.command || '').trim(),
    args,
    env,
    cwd:       String(input.cwd || '').trim(),
    url:       String(input.url || '').trim(),
    headers:   input.headers && typeof input.headers === 'object' ? input.headers : {},
    autostart: !!input.autostart,
  };

  if (transport === 'stdio' && !spec.command)
    throw Object.assign(new Error('A stdio server needs a command'), { status: 400 });
  if (transport === 'http' && !/^https?:\/\//.test(spec.url))
    throw Object.assign(new Error('An HTTP server needs a URL starting with http:// or https://'), { status: 400 });

  return { ...existing, ...spec };
}

/* ── Lifecycle ────────────────────────────────────────── */

function client(id) {
  return _clients.get(id) || null;
}

async function start(id) {
  const spec = get(id);
  if (!spec) throw Object.assign(new Error('Unknown MCP server'), { status: 404 });

  const existing = _clients.get(id);
  if (existing?.state === 'running') return existing;
  if (existing) existing.stop(true);

  const c = new McpClient(spec);
  _clients.set(id, c);
  await c.start();
  return c;
}

function stop(id) {
  const c = _clients.get(id);
  if (!c) return false;
  c.stop();
  return true;
}

async function restart(id) {
  stop(id);
  return start(id);
}

/** Everything a UI needs: the definition plus whatever the live client knows. */
function status(spec) {
  const c = _clients.get(spec.id);
  return {
    ...spec,
    state:      c?.state || 'stopped',
    error:      c?.error || null,
    startedAt:  c?.startedAt || null,
    serverInfo: c?.serverInfo || null,
    pid:        c?.child?.pid || null,
    tools:      (c?.tools || []).map(t => ({ name: t.name, description: t.description })),
    toolCount:  c?.tools?.length || 0,
  };
}

function list() {
  return load().map(status);
}

/* ── Mutations ────────────────────────────────────────── */

function upsert(input) {
  const all      = load();
  const idx      = all.findIndex(s => s.id === slug(input.id || input.label));
  const spec     = normalize(input, idx >= 0 ? all[idx] : {});
  const next     = [...all];
  if (idx >= 0) next[idx] = spec; else next.push(spec);
  save(next);

  // A running server is still running the old definition; say so by leaving it
  // alone rather than restarting something mid-call behind the user's back.
  return status(spec);
}

function remove(id) {
  const all = load();
  if (!all.some(s => s.id === id)) throw Object.assign(new Error('Unknown MCP server'), { status: 404 });
  stop(id);
  _clients.delete(id);
  save(all.filter(s => s.id !== id));
}

/** Start every server marked autostart. Called once, from the listen path. */
async function startAutostart() {
  const results = [];
  for (const spec of load().filter(s => s.autostart)) {
    try { await start(spec.id); results.push({ id: spec.id, ok: true }); }
    catch (e) { results.push({ id: spec.id, ok: false, error: e.message }); }
  }
  return results;
}

/** Stop everything — used on shutdown so no orphan children are left behind. */
function stopAll() {
  for (const [, c] of _clients) c.stop();
  _clients.clear();
}

module.exports = {
  PREFS_KEY,
  load, list, get, client, status, slug, normalize,
  start, stop, restart, upsert, remove, startAutostart, stopAll,
};
