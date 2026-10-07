'use strict';

/**
 * Every panel route is used by the panel's own pages, or listed here as API-only with why (audit 2026-10-06, coh F17;
 * TODO C5). A route nobody calls is either a feature with no button — reachable by curl only, which is how the APK
 * signing key was set — or dead code. Adding one to API_ONLY is a decision; the reason says whose it is.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H = require('./helpers');
test.before(() => H.start());
test.after(() => H.stop());

const API_ONLY = {
  'GET /api/connectors/callback': 'called by the OAuth provider\'s redirect, never by a page',
  'GET /api/harness/settings': 'what the agent may propose and their values (settings.readable(), what settings_read shows) — for a script checking that list',
  'GET /api/chat/status': 'which harness the floating chat talks to and OpenClaw\'s gateway — for a script; the chat finds out by talking',
  'GET /api/models/ollama/running': 'what Ollama holds in memory, for a script; the panel draws it through /api/models/servers',
  'GET /api/ambient/place': 'a place looked up by name (weather.locate), for a client choosing a place; the panel\'s own form passes it to /api/ambient',
  'GET /api/decisions': 'every decision waiting, in one list — for devices and the header badge wave E draws; each page shows its own today',
  // Wanted in the panel (TODO C5b): each is a feature a person can only reach with curl today.
  'POST /api/clients/apps/signing': 'TODO C5b: upload the APK signing key in Field → API keys → DOCA apps',
  'GET /api/harness/contracts': 'TODO C5b: show what each provider was learned to accept, in the Harness ⚙',
  'DELETE /api/harness/contracts/:provider': 'TODO C5b: forget a provider\'s learned contract, beside the above',
};

test('every panel route is called by the panel, or is listed as API-only with why', () => {
  const app = require('../server').createApp();
  const routes = [];
  for (const layer of app._router.stack)
    if (layer.route) for (const m of Object.keys(layer.route.methods)) routes.push([m.toUpperCase(), layer.route.path]);
  const files = [];
  const read = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) read(p); else if (/\.(js|html)$/.test(f)) files.push(fs.readFileSync(p, 'utf8')); } };
  read(path.join(__dirname, '..', 'public'));
  const text = files.join('\n');
  const used = p => {
    const stem = p.split('/:')[0];
    if (text.includes(stem)) return true;
    // Built as `${prefix}/<last>` (the Files tab's fmApi()): the group and the last fixed segment both appear.
    const parts = stem.split('/').filter(Boolean), last = parts[parts.length - 1];
    return parts.length > 2 && text.includes(`/${parts.slice(0, 2).join('/')}`) && text.includes(`/${last}`);
  };
  const missing = routes.filter(([m, p]) => typeof p === 'string' && p.startsWith('/api/') && !p.startsWith('/api/v1')
    && !used(p) && !API_ONLY[`${m} ${p}`]).map(r => r.join(' '));
  assert.deepEqual(missing, [], 'call it from a page, remove it, or list it in API_ONLY with why');
  const stale = Object.keys(API_ONLY).filter(k => !routes.some(([m, p]) => `${m} ${p}` === k));
  assert.deepEqual(stale, [], 'API_ONLY lists a route that no longer exists');
});
