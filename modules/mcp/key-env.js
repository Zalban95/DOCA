'use strict';

/**
 * A command (stdio) server's secrets as keys for services (fit audit 2026-10-14; CONSTITUTION S4): a definition may
 * carry `keyEnv: {ENV_NAME: '<key for services name>'}`, and the hub puts each key's value into that environment
 * variable as it spawns the server — the secret's one home stays keys/services.json (service-keys.js), never the
 * server's `env` in the prefs file, and what `status()` / GET /api/mcp shows is the names alone.
 *
 * The same rule as `registry.withKey` for a server at an address, with one difference said plainly: an address
 * server's key is sent only to the key's own origin, while a program handed a value in its environment may send it
 * wherever it likes. That is what a value typed into `env` already was; only a person who may add a server (host)
 * names a key here, and the agent never writes a server's definition.
 */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * What a form or a body gave as `keyEnv` — an object, or `NAME=key` lines — as the stored map, or undefined when it
 * was not given (the existing one stays). An empty map takes it off. A malformed line is refused, not dropped.
 */
function normalize(input) {
  if (input === undefined || input === null) return undefined;
  const pairs = typeof input === 'object' && !Array.isArray(input) ? Object.entries(input)
    : String(input).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf('='); return i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)]; });
  const out = {};
  for (const [n, k] of pairs) {
    const name = String(n).trim(), key = String(k || '').trim().toLowerCase();
    if (!ENV_NAME.test(name) || !key) throw Object.assign(new Error(`"${name}=${key}" is not NAME=key: a variable name, then the name of a key for services.`), { status: 400 });
    out[name] = key;
  }
  return out;
}

/** The spec the client starts with: each named key's value in the server's environment (never stored, never shown). */
function apply(spec) {
  const map = spec.keyEnv;
  if (!map || !Object.keys(map).length || (spec.transport && spec.transport !== 'stdio')) return spec;
  const env = { ...(spec.env || {}) };
  for (const [name, key] of Object.entries(map)) {
    const k = require('../service-keys').secretOf(key);
    if (!k) throw Object.assign(new Error(`${spec.label || spec.id} needs the key "${key}" (for ${name}), which is not kept: an admin adds it in Field → Connectors → Keys for services.`), { status: 404 });
    env[name] = k.value;
  }
  return { ...spec, env };
}

module.exports = { normalize, apply };
