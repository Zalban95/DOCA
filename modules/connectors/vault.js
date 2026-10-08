'use strict';

/**
 * Where connectors keep their secrets (TODO H9.3): `DATA_DIR/keys/connectors.json`, mode 0600, in PROTECTED_FILES so
 * the agent's file tools refuse it, and carried by a backup like the model providers' keys. Each connector's record:
 * the OAuth app (clientId, clientSecret), its addresses when custom, the scopes, and once connected the tokens and
 * the account they belong to. A connection that needs no OAuth app (`via`: a calendar's secret address, a mailbox's
 * app password, CalDAV — connectors/ways/) keeps its secret here too. Nothing here is ever sent to a browser or a
 * device; `view()` is what may be.
 */
const fs = require('fs');
const path = require('path');

const file = () => require('../paths').CONNECTOR_KEYS_FILE;

function all() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
}

function write(data) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file(), 0o600); } catch { /* Windows: the data folder's own permissions */ }
}

const get = id => all()[id] || null;
function patch(id, fields) { const d = all(); d[id] = { ...(d[id] || {}), ...fields }; write(d); return d[id]; }
function forget(id, keys) { const d = all(); if (!d[id]) return; if (keys) for (const k of keys) delete d[id][k]; else delete d[id]; write(d); }

/** Whether a connection is live: an OAuth token, or another way's last test passed. */
const isConnected = rec => !!rec && (rec.via && rec.via !== 'oauth' ? !!rec.connectedAt : !!rec.accessToken);

/** What a browser may see: the shape, never a secret. */
function view(id, rec = get(id)) {
  if (!rec) return { configured: false, connected: false };
  if (rec.via && rec.via !== 'oauth') return { via: rec.via, ...require('./ways').get(rec.via).view(rec), connected: isConnected(rec), who: rec.who === 'everyone' ? 'everyone' : 'host',
    connectedAt: rec.connectedAt || null, testedAt: rec.testedAt || null, lastError: rec.lastError || null };
  return { configured: !!rec.clientId, hasSecret: !!rec.clientSecret, connected: !!rec.accessToken, account: rec.account || null,
    scopes: rec.scopes || null, who: rec.who === 'everyone' ? 'everyone' : 'host', expiresAt: rec.expiresAt || null, refreshable: !!rec.refreshToken, connectedAt: rec.connectedAt || null,
    ...(rec.urls ? { urls: rec.urls } : {}) };
}

module.exports = { all, get, patch, forget, view, isConnected };
