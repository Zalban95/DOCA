'use strict';

/**
 * Hub → Admin (the owner's yes of 2026-10-09): one admin-only overview that answers "is everything fine, and what
 * needs me?" — status and links, never a second copy of settings. Five cards, each built from the owning modules' own
 * reads (no store of its own) and worded by fixed templates (words.js; no model):
 *
 *   needs     what waits for an admin                     needs.js
 *   health    version, update, licence, mode, backups, disk, GPUs, machines in trouble, uptime    health.js
 *   people    people by level, active today, devices by kind                                   people.js
 *   security  guarded switches changed, sign-ins from new places, password changes (audit log)  security.js
 *   spending  today against the budgets                                                      spending.js
 *
 * `overview()` is kept a few seconds, so a page open on two screens costs one read. A section that cannot be read says
 * so and the others still answer. GET /api/admin/overview (host; routes.js); the page is public/js/admin.js.
 */
const SECTIONS = ['needs', 'health', 'people', 'security', 'spending'];
const TTL_MS = 5000;

let _cache = null, _pending = null;

async function assemble(now = Date.now()) {
  const out = [];
  for (const id of SECTIONS) {
    const s = require(`./${id}`);
    try { out.push(s.build(await s.read(now), now)); } catch (e) {
      out.push({ id, title: id, lines: [], error: 'This card could not be read just now.' });
      console.warn(`[admin] ${id}: ${e.message}`);
    }
  }
  return { at: new Date(now).toISOString(), mode: require('../edition-mode').mode(), hosted: require('../hosted').on(), sections: out };
}

/** The whole overview, at most TTL_MS old; `fresh` reads again. */
function overview({ fresh = false } = {}) {
  if (!fresh && _cache && Date.now() - Date.parse(_cache.at) < TTL_MS) return Promise.resolve(_cache);
  if (_pending) return _pending;
  _pending = assemble().then(r => (_cache = r)).finally(() => { _pending = null; });
  return _pending;
}

module.exports = { overview, assemble, SECTIONS, TTL_MS, _reset: () => { _cache = null; } };
