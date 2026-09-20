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

/**
 * Where the server actually runs.
 *
 * `server` is this host — a stdio child of the panel, or a URL the panel
 * happens to reach. `client` is a paired device hosting its own MCP server on
 * the tailnet, and it names that device so revoking the device is visible here
 * and so the agent can tell "a tool on my host" from "a tool on Al's PC".
 *
 * A client can only be reached over HTTP: there is no stdio to a machine the
 * panel is not running on. And the deviceId has to be one we know, otherwise
 * the label is a note-to-self rather than a fact.
 */
function normalizeOrigin(input, transport) {
  const raw = input && typeof input === 'object' ? input : {};
  if (raw.kind !== 'client') return { kind: 'server', deviceId: null };

  if (transport !== 'http')
    throw Object.assign(new Error('A server hosted on a client is reached over http — a stdio command would run here, not there'), { status: 400 });

  const deviceId = String(raw.deviceId || '').trim();
  if (!deviceId)
    throw Object.assign(new Error('Which client hosts it? Pick a paired device'), { status: 400 });
  if (!require('../api-v1/devices').get(deviceId))
    throw Object.assign(new Error(`No paired device "${deviceId}" — pair it first, or set this server to run on the DOCA host`), { status: 400 });

  return { kind: 'client', deviceId };
}

/** The device behind a client origin, when it still exists. */
function originDevice(origin) {
  if (origin?.kind !== 'client' || !origin.deviceId) return null;
  try { return require('../api-v1/devices').get(origin.deviceId); } catch { return null; }
}

/** The definition a device hosts itself, if a human has pointed one at it. */
function forDevice(deviceId) {
  if (!deviceId) return null;
  return load().find(s => s.origin?.kind === 'client' && s.origin.deviceId === deviceId) || null;
}

/**
 * A device correcting its own address.
 *
 * The narrowest useful thing a client can be allowed to do, and the reason it
 * is safe: the row already exists because a human created it and named this
 * device, so consent is a fact rather than an assumption. Only the address is
 * writable — never the transport, never a command, never which device owns it,
 * never autostart. A client that could set `command` would be an
 * unauthenticated way to run code on this host, which is the whole reason
 * `mcpServers` is kept out of the agent's reach.
 *
 * This exists because the address genuinely changes: a client that regenerates
 * the secret in its URL on restart would otherwise leave a dead row until
 * somebody re-pasted it by hand.
 */
function updateFromDevice(deviceId, patch) {
  const spec = forDevice(deviceId);
  if (!spec) return null;

  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...spec };

  if (p.url !== undefined) {
    const url = String(p.url || '').trim();
    if (!/^https?:\/\//.test(url))
      throw Object.assign(new Error('url must start with http:// or https://'), { status: 400 });
    next.url = url;
  }
  if (p.headers !== undefined) {
    if (!p.headers || typeof p.headers !== 'object' || Array.isArray(p.headers))
      throw Object.assign(new Error('headers must be an object of name/value pairs'), { status: 400 });
    next.headers = unmaskValues(Object.fromEntries(
      Object.entries(p.headers).slice(0, 20).map(([k, v]) => [String(k).slice(0, 128), String(v).slice(0, 2048)])),
    spec.headers);
  }

  save(load().map(s => (s.id === spec.id ? next : s)));
  return next;
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
    // A value that comes back as the mask is one the caller never saw, so it
    // means "leave it alone" rather than "set it to dots".
    env:       unmaskValues(env, existing?.env),
    cwd:       String(input.cwd || '').trim(),
    url:       String(input.url || '').trim(),
    headers:   unmaskValues(input.headers && typeof input.headers === 'object' ? input.headers : {}, existing?.headers),
    autostart: !!input.autostart,
    // Absent on every definition written before this existed, which is exactly
    // what `server` means, so nothing has to be migrated.
    origin:    normalizeOrigin(input.origin !== undefined ? input.origin : existing?.origin, transport),
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
/**
 * Secrets do not leave this module in a readable form.
 *
 * `env` is where a stdio server's tokens live and `headers` is where a
 * client-hosted server's bearer token lives, and `GET /api/mcp` — which has no
 * auth in front of it, so any tailnet peer can call it — used to answer with
 * both in full, because `status()` spread the whole stored spec. The agent found
 * this before anybody else did: it curled the panel to work around a stale tool
 * list and the token came back in the listing. `environment.js` was already
 * careful never to put these in the prompt; that care was worth nothing while
 * another route handed them over.
 *
 * Names are kept and values replaced, so the panel can still show that a header
 * or a variable exists without showing what it is. The live client is built from
 * `get()`, not from here, so nothing masked ever reaches a connection, and
 * `export.js` reads `load()` for the same reason.
 */
const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

function maskValues(obj) {
  if (!obj || typeof obj !== 'object') return {};
  return Object.fromEntries(Object.keys(obj).map(k => [k, MASK]));
}

/**
 * Put back what a mask stands for.
 *
 * Anything that reads a definition and writes it back — the dashboard form, a
 * client correcting its own address — would otherwise save the mask over the
 * real secret the first time somebody edited an unrelated field. So a value that
 * comes back as the mask means "unchanged", and the stored one survives. This is
 * what makes masking safe to do everywhere rather than only on the one route
 * that leaked.
 */
function unmaskValues(next, previous) {
  if (!next || typeof next !== 'object') return next;
  const prev = previous && typeof previous === 'object' ? previous : {};
  return Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v === MASK ? (prev[k] ?? '') : v]));
}

function status(spec) {
  const c = _clients.get(spec.id);
  const origin = spec.origin || { kind: 'server', deviceId: null };
  const device = originDevice(origin);
  return {
    ...spec,
    env:     maskValues(spec.env),
    headers: maskValues(spec.headers),
    origin,
    // Resolved here so a row can say "on Al's PC" without the page fetching the
    // device list per server. A revoked or deleted device leaves the id visible
    // rather than silently reading as if it were still paired.
    originLabel: origin.kind === 'client'
      ? (device ? `${device.name}${device.revokedAt ? ' (revoked)' : ''}` : `${origin.deviceId} (unknown device)`)
      : 'DOCA host',
    state:      c?.state || 'stopped',
    // MCP connection state and evidence about a downstream app are separate.
    // No generic MCP handshake or successful tool proves that backend is healthy.
    ...(c?.backendStatus() || { backend: 'unknown', backendObservedAt: null }),
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
  MASK,
  PREFS_KEY,
  load, list, get, client, status, slug, normalize, normalizeOrigin, originDevice,
  forDevice, updateFromDevice,
  start, stop, restart, upsert, remove, startAutostart, stopAll,
};
