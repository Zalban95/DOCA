'use strict';

/**
 * The pass a panel page gives its service frame: one token per person and service, made when the page opens it,
 * good for TTL_S and checked on every request the frame makes (proxy.js) — the person must still see the service
 * (index.sees, by their role now, not then). In memory: a restart asks the page to open the frame again.
 */
const crypto = require('crypto');

const TTL_S = 12 * 3600;
const _tokens = new Map();   // token → { id, person: {id, role}, until }

function make(id, person) {
  const now = Date.now();
  for (const [t, v] of _tokens) if (v.until < now) _tokens.delete(t);
  const token = crypto.randomBytes(24).toString('base64url');
  _tokens.set(token, { id, person: { id: person.id, role: person.role, orgId: person.orgId || null }, until: now + TTL_S * 1000 });
  return token;
}

/** The token's record when it is for this service, unexpired, and its person still sees the service; else null. */
function check(token, id) {
  const v = token && _tokens.get(token);
  if (!v || v.id !== id || v.until < Date.now()) return null;
  const s = require('./index').get(id);
  if (!s) return null;
  // The person's role now: a person demoted since keeps no service an admin's page showed them.
  const store = require('../auth/store');
  const user = (() => { try { return store.userById(v.person.id); } catch { return null; } })();
  if (!user || user.suspendedAt) return null;
  const m = (() => { try { return v.person.orgId ? store.membership(v.person.orgId, user.id) : null; } catch { return null; } })();
  if (v.person.orgId && (!m || m.status === 'suspended')) return null;
  return require('./index').sees(s, { id: user.id, role: m?.role || v.person.role }) ? v : null;
}

module.exports = { make, check, TTL_S, _tokens };
