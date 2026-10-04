'use strict';

/**
 * Which implementation holds the accounts. The database when it is SQLite —
 * synchronous, like every caller of auth/store.js expects — and the JSON files
 * when PostgreSQL is configured (its driver is asynchronous) or
 * DOCA_AUTH_BACKEND=json asks for them (the contract test runs both).
 */
let _impl = null;
function get() {
  if (_impl) return _impl;
  const want = process.env.DOCA_AUTH_BACKEND;
  void want;
  _impl = require('./accounts-json');   // accounts-sql.js arrives in the next commit
  return _impl;
}
module.exports = { get, _reset: () => { _impl = null; } };
