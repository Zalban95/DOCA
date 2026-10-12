'use strict';

/**
 * One interface over the providers, so the everyday tools, the mail reader and undo never ask which one an account
 * is: `of(rec)` → { calendar: {events, event, create, update, remove}, mail: {list, meta, read, around, send, archive,
 * unarchive, label, unlabel, changes} }. The raw `connector_<id>` tool stays beside them (CONSTITUTION W14) for what
 * these do not cover.
 */
const PROVIDERS = { google: () => require('./google'), microsoft: () => require('./microsoft') };

function of(rec) {
  const p = PROVIDERS[rec?.provider];
  if (!p) throw Object.assign(new Error(`No everyday adapter for ${rec?.provider}.`), { status: 400 });
  return p();
}

module.exports = { of, PROVIDERS };
