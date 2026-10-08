'use strict';

/**
 * What `POST /api/prefs` does with a body (deep test A, c B1): merges it leaf by leaf into the settings. It used to
 * replace whole top-level keys, so `{"harness":{"config":{"doca":{"temperature":0.3}}}}` wiped the agent's model,
 * prompt and limits beside it. Now:
 *   - a plain object is merged key by key, all the way down — what the body leaves out stays as it is
 *   - `null` deletes that key
 *   - anything else (a value, an array) replaces what is there
 *   - `replace: true` (`?replace=1`) is the old way: each top-level key in the body replaces the stored one whole
 * Secrets posted back masked are unmasked first (secrets-mask.js), so a masked value means "unchanged". The password
 * guard (auth/guarded.js) reads the same result, so it asks exactly when a switch would change.
 */
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

function deep(into, body) {
  const out = plain(into) ? { ...into } : {};
  for (const [k, v] of Object.entries(body)) {
    if (UNSAFE.has(k)) continue;
    if (v === null) delete out[k];
    else if (plain(v)) out[k] = deep(out[k], v);
    else out[k] = v;
  }
  return out;
}

/** The settings after `body` is posted onto `stored`. */
function merged(stored, body, { replace = false } = {}) {
  const incoming = require('./secrets-mask').unmask(plain(body) ? body : {}, stored);
  if (!replace) return deep(stored, incoming);
  const out = { ...stored };
  for (const [k, v] of Object.entries(incoming)) { if (UNSAFE.has(k)) continue; if (v === null) delete out[k]; else out[k] = v; }
  return out;
}

module.exports = { merged };
