'use strict';

/**
 * The ways to connect that need no OAuth app, beside OAuth (connectors/oauth.js): each one a module with the same
 * shape — `accept(body, prev)` checks what the card sent and returns what to keep (a secret left out or masked keeps
 * the one kept), `view(rec)` what a browser may see (never a secret), `test(rec)` whether it works (on every save),
 * `def(id, rec, label)` the tool connector_<id>, `run(id, rec, args)` one call of it, and `SECRETS`, the fields that
 * hold one. The tool, who may use it, allotment and audit are the connector's, whatever the way.
 */
const WAYS = { ics: require('./ics'), mail: require('./mail'), dav: require('./dav') };

const get = via => WAYS[via] || null;

module.exports = { get, WAYS, VIAS: Object.keys(WAYS) };
