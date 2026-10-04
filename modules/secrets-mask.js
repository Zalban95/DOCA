'use strict';

/**
 * Secrets in prefs never leave in a read (found by the live test 2026-10-04:
 * GET /api/prefs and GET /api/models/settings handed the HuggingFace token to
 * anyone holding `read` — a viewer, a member — the same class of leak as
 * GET /api/mcp had before mcp/registry.js masked it).
 *
 * mask(): every non-empty string under a secret-named key (token, key,
 * apiKey, secret, password, credential…) becomes MASK, and so does every value
 * of an MCP server's `env` and `headers`, whose names are anyone's.
 * unmask(): the other half, for the forms that read a settings object and post
 * it back whole — a MASK coming in means "unchanged", so saving an unrelated
 * field never writes dots over the real token.
 */
const MASK = '••••••••';
const SECRET = /^(api[-_]?)?(key|keys|token|secret|password|passwd|credentials?)$|(token|secret|password|api[-_]?key)$/i;
const WHOLE = new Set(['env', 'headers']);   // inside mcpServers: every value

function mask(value, key = '', all = false) {
  if (Array.isArray(value)) return value.map(v => mask(v, key, all));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = mask(v, k, all || WHOLE.has(k));
    return out;
  }
  if (typeof value === 'string' && value && (all || SECRET.test(key))) return MASK;
  return value;
}

function unmask(incoming, stored) {
  if (incoming === MASK) return stored;
  if (Array.isArray(incoming)) return incoming.map((v, i) => unmask(v, Array.isArray(stored) ? stored[i] : undefined));
  if (incoming && typeof incoming === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(incoming)) out[k] = unmask(v, stored && typeof stored === 'object' ? stored[k] : undefined);
    return out;
  }
  return incoming;
}

module.exports = { mask, unmask, MASK };
